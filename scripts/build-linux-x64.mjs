#!/usr/bin/env node
// One-shot build for the Linux x64 desktop app.
//
// Detects the toolchain (node, npm, cargo, rustc, the x86_64 target, and the
// system libraries Tauri needs), installs whatever is missing *idempotently*,
// then runs the release bundle for `deb` and `rpm`. Skips AppImage by default
// since it pulls linuxdeploy at bundle time and tends to fail in sandboxes.
//
// Mirrors the style of run-rust-cli.mjs: spawnSync + stdio: 'inherit', explicit
// exit codes, no shell glue.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_TRIPLE = 'x86_64-unknown-linux-gnu';
const BUNDLES = 'deb,rpm';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const log = (msg) => console.log(msg);
const step = (msg) => console.log(`${GREEN}✓${RESET} ${msg}`);
const warn = (msg) => console.log(`${YELLOW}!${RESET} ${msg}`);
const fail = (msg) => console.error(`${RED}✗${RESET} ${msg}`);

function run(command, args, opts = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...opts });
}

function canRun(command, args = ['--version']) {
  return run(command, args, { stdio: 'ignore' }).status === 0;
}

// ── preflight: node + npm ──────────────────────────────────────────────────
function ensureNode() {
  if (!canRun('node')) {
    fail('node not found on PATH. Install Node.js (https://nodejs.org) first.');
    process.exit(127);
  }
  if (!canRun('npm')) {
    fail('npm not found on PATH. It ships with Node.js — reinstall or fix PATH.');
    process.exit(127);
  }
  step(`node ${run('node', ['--version']).stdout.trim()}, npm ${run('npm', ['--version']).stdout.trim()}`);
}

// ── preflight: rust toolchain + target ─────────────────────────────────────
function resolveCargo() {
  if (process.env.CARGO && existsSync(process.env.CARGO)) return process.env.CARGO;
  if (canRun('cargo')) return 'cargo';
  // rustup-managed install: derive cargo from rustc's neighbor.
  const rustupCheck = run('rustup', ['which', 'rustc']);
  if (rustupCheck.status === 0) {
    const rustcPath = rustupCheck.stdout.trim();
    const cargoPath = join(dirname(rustcPath), 'cargo');
    if (existsSync(cargoPath)) return cargoPath;
  }
  fail('cargo not found. Install Rust via https://rustup.rs or ensure cargo is on PATH.');
  process.exit(127);
}

function ensureRust() {
  const cargo = resolveCargo();
  const rustcVersion = run('rustc', ['--version']).stdout.trim() || 'rustc';
  step(`${cargo} (${rustcVersion})`);

  // Target triple must be installed even on a matching host, since rustup
  // treats "host" as explicit only when listed.
  const installed = run('rustup', ['target', 'list', '--installed']).stdout ?? '';
  if (!installed.split('\n').includes(TARGET_TRIPLE)) {
    log(`${DIM}  adding rust target ${TARGET_TRIPLE}…${RESET}`);
    const add = run('rustup', ['target', 'add', TARGET_TRIPLE], { stdio: 'inherit' });
    if (add.status !== 0) {
      fail(`failed to install rust target ${TARGET_TRIPLE}`);
      process.exit(1);
    }
  } else {
    step(`rust target ${TARGET_TRIPLE} present`);
  }
  return cargo;
}

// ── preflight: system libraries (webkit/gtk/soup) ──────────────────────────
// Tauri links against these at build time. We only detect + advise — never
// auto-sudo — so the user stays in control of privileged installs.
const REQUIRED_LIBS = ['webkit2gtk-4.1', 'gtk+-3.0', 'libsoup-3.0'];

function detectDistro() {
  const osRelease = (() => {
    try {
      return Object.fromEntries(
        run('sh', ['-c', 'cat /etc/os-release 2>/dev/null']).stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [k, ...v] = line.split('=');
            return [k, v.join('=').replace(/^"|"$/g, '')];
          }),
      );
    } catch {
      return {};
    }
  })();
  return osRelease.ID || osRelease.ID_LIKE || '';
}

function installHint(distro) {
  const d = distro.toLowerCase();
  if (d.includes('fedora') || d.includes('rhel') || d.includes('centos')) {
    return `sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libsoup3-devel`;
  }
  if (d.includes('arch')) {
    return `sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3`;
  }
  if (d.includes('opensuse') || d.includes('suse')) {
    // openSUSE names the GTK3-compatible 4.1 API package "webkit2gtk3-devel".
    return `sudo zypper install webkit2gtk3-devel gtk3-devel libsoup3-devel`;
  }
  // Default: Debian/Ubuntu family. pkg-config names don't map 1:1 to apt
  // packages, so we hand users the canonical Tauri apt line instead.
  return `sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev`;
}

function ensureSystemLibs() {
  const missing = REQUIRED_LIBS.filter((lib) => {
    if (!canRun('pkg-config', ['--exists', lib])) return true;
    return false;
  });
  if (missing.length === 0) {
    step(`system libs present (${REQUIRED_LIBS.join(', ')})`);
    return;
  }
  fail(`missing system libraries: ${missing.join(', ')}`);
  const distro = detectDistro();
  const hint = installHint(distro);
  console.error(`${DIM}Tauri needs these to link the WebKit/GTK shell.${RESET}`);
  console.error(`${DIM}Install them, then re-run this script:${RESET}`);
  console.error(`  ${YELLOW}${hint}${RESET}`);
  process.exit(127);
}

// ── dependencies: npm install only when node_modules is missing ────────────
// We don't try to second-guess lock staleness (mtime comparisons are flaky and
// tend to over-trigger). If node_modules exists we trust it; the user reruns
// `npm install` themselves after pulling dep changes. tauri's beforeBuildCommand
// will surface a genuinely missing dep as a clear build error anyway.
function ensureNpmDeps() {
  const nodeModules = join(ROOT, 'node_modules');
  if (existsSync(nodeModules)) {
    step('node_modules present — skipping npm install');
    return;
  }
  log(`${DIM}  installing npm dependencies…${RESET}`);
  const result = run('npm', ['install'], { stdio: 'inherit', cwd: ROOT });
  if (result.status !== 0) {
    fail('npm install failed');
    process.exit(1);
  }
  step('npm dependencies installed');
}

// ── the build itself ───────────────────────────────────────────────────────
function runBuild() {
  // tauri.conf.json ships an updater pubkey + createUpdaterArtifacts:true,
  // so a release build tries to sign the artifacts. Without a signing key the
  // bundle step exits 1 even though deb/rpm are already written. For a local
  // build we transparently disable updater signing unless the user provides a
  // key, keeping deb/rpm intact. (CI sets the key and signs properly.)
  const hasSigningKey = !!process.env.TAURI_SIGNING_PRIVATE_KEY;
  const configOverride = hasSigningKey
    ? null
    : JSON.stringify({ bundle: { createUpdaterArtifacts: false } });

  const tauriArgs = ['run', 'tauri:build', '--', '--bundles', BUNDLES];
  if (configOverride) {
    tauriArgs.push('--config', configOverride);
    warn('TAURI_SIGNING_PRIVATE_KEY unset — skipping updater signing (deb/rpm still built)');
  }

  log(`${DIM}▶ tauri build (--bundles ${BUNDLES})${RESET}`);
  // `npm run tauri:build` runs `tauri build`, whose beforeBuildCommand already
  // runs `npm run build` (tsc + vite).
  const result = spawnSync('npm', tauriArgs, {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  if (result.error) {
    fail(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    fail(`tauri build exited with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// ── artifact report ────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reportArtifacts() {
  const releaseDir = join(ROOT, 'src-tauri', 'target', 'release');
  const bundleDir = join(releaseDir, 'bundle');

  const artifacts = [];
  const exe = join(releaseDir, 'skills-manager');
  if (existsSync(exe)) artifacts.push({ label: 'executable', path: exe });

  for (const kind of ['deb', 'rpm']) {
    const dir = join(bundleDir, kind);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(`.${kind}`))
      .map((f) => join(dir, f));
    for (const f of files) artifacts.push({ label: kind, path: f });
  }

  if (artifacts.length === 0) {
    warn('build reported success but no artifacts were found');
    return;
  }

  console.log('');
  log(`${GREEN}Build artifacts:${RESET}`);
  for (const a of artifacts) {
    const size = fmtSize(statSync(a.path).size);
    console.log(`  ${YELLOW}${a.label.padEnd(11)}${RESET} ${a.path} ${DIM}(${size})${RESET}`);
  }
  console.log('');
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  console.log(`${DIM}Building Skills Manager for ${TARGET_TRIPLE}…${RESET}`);
  ensureNode();
  ensureRust();
  ensureSystemLibs();
  ensureNpmDeps();
  runBuild();
  reportArtifacts();
  step('done');
}

main();
