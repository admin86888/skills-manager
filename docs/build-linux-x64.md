# Build for Linux x64 (`build-linux-x64`)

One-shot script that produces **release binaries** of the Skills Manager desktop
app for **`x86_64-unknown-linux-gnu`**, with environment detection and idempotent
dependency bootstrap.

```bash
npm run build:linux:x64
```

It wraps `tauri build` so you don't have to remember the prerequisites, the
target, or the bundle flags — running it on a fresh checkout is enough to get
installable packages.

---

## What it produces

| Artifact | Path |
|----------|------|
| Executable | `src-tauri/target/release/skills-manager` |
| Debian package | `src-tauri/target/release/bundle/deb/skills-manager_<version>_amd64.deb` |
| RPM package | `src-tauri/target/release/bundle/rpm/skills-manager-<version>-1.x86_64.rpm` |

The script prints the absolute path and size of each artifact at the end of a
successful run. **AppImage is intentionally skipped** (see
[Why no AppImage](#why-no-appimage)).

---

## What it checks before building

The script runs a preflight and exits early (code `127`) with an actionable
message if something is missing — it never silently `sudo`-installs anything.

1. **Node.js + npm** — required to run the script and build the frontend.
2. **Rust toolchain** — `cargo` / `rustc`. If the `x86_64-unknown-linux-gnu`
   target is not installed, it runs `rustup target add` for you.
3. **System libraries** — Tauri links against WebKit/GTK at build time. The
   script verifies them via `pkg-config`:

   | pkg-config name | Purpose |
   |------------------|---------|
   | `webkit2gtk-4.1` | Web view shell |
   | `gtk+-3.0`       | Windowing / widgets |
   | `libsoup-3.0`    | HTTP for the web view |

   If any are missing, the script detects your distro from `/etc/os-release`
   and prints the matching install command:

   ```bash
   # Debian / Ubuntu
   sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev
   # Fedora / RHEL
   sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libsoup3-devel
   # Arch
   sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3
   # openSUSE
   sudo zypper install webkit2gtk3-devel gtk3-devel libsoup3-devel
   ```

4. **npm dependencies** — `npm install` runs only when `node_modules/` is absent.
   If it already exists the script trusts it (run `npm install` yourself after
   pulling dependency changes). This keeps repeat runs fast.

> Also see the official [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/).

---

## The build step

Preflight passes control to:

```bash
tauri build --bundles deb,rpm
```

`tauri build` itself first runs `npm run build` (`tsc -b && vite build`) for the
frontend via `beforeBuildCommand`, then compiles the Rust backend in `release`
profile and bundles the installers.

### Updater signing

`tauri.conf.json` enables update signing (`bundle.createUpdaterArtifacts: true`
plus an updater public key). A release build therefore wants to sign the bundle —
which fails without `TAURI_SIGNING_PRIVATE_KEY`, and exits with status `1` even
though the `.deb`/`.rpm` are already written.

To keep local builds working out of the box, the script **transparently disables
updater signing when no key is present** by passing:

```bash
--config {"bundle":{"createUpdaterArtifacts":false}}
```

You'll see this warning:

```
! TAURI_SIGNING_PRIVATE_KEY unset — skipping updater signing (deb/rpm still built)
```

This is expected for local test builds. The `.deb`/`.rpm` installers are
unaffected; only the `.sig` / `latest.json` updater artifacts are skipped.

To produce signed updater artifacts (for an actual release), export the key
before running:

```bash
export TAURI_SIGNING_PRIVATE_KEY="..."
npm run build:linux:x64
```

With the key present, the script passes through unchanged and Tauri signs
normally.

---

## Expected timings

| Scenario | Typical duration |
|----------|------------------|
| First build (cold cargo cache) | ~6 minutes |
| Incremental (sources changed, deps cached) | ~2 minutes |
| No source changes, only `--config` re-injection | ~2 minutes |

> Note: passing `--config` causes Tauri to treat the config as modified, which
> recompiles the project crate even when sources are unchanged. This is inherent
> to how the signing override is applied.

---

## Why no AppImage

AppImage bundling requires `linuxdeploy` and several helper binaries to be
downloaded from GitHub at bundle time, then executed via FUSE. That frequently
fails in sandboxed / offline / restricted environments. Since `.deb` and `.rpm`
cover the common Linux distributions, AppImage is excluded by default.

If you need an AppImage and have network access + a working FUSE setup, build it
manually:

```bash
npm run tauri:build -- --bundles appimage
```

---

## Running the result

Pick whichever fits your distribution:

```bash
# Run the binary directly
./src-tauri/target/release/skills-manager

# Install on Debian / Ubuntu
sudo dpkg -i src-tauri/target/release/bundle/deb/skills-manager_*.deb

# Install on Fedora / RHEL / openSUSE
sudo rpm -i src-tauri/target/release/bundle/rpm/skills-manager-*.x86_64.rpm
```

---

## How it relates to the other build commands

| Command | When to use |
|---------|-------------|
| `npm run tauri:dev` | Live development with HMR (debug profile, unsigned) |
| `npm run build:linux:x64` | **One-shot release build for Linux x64** (this script) |
| `npm run tauri:build` | Manual full bundle (all targets, including AppImage; will fail on missing signing key unless you handle it) |

This script is a convenience wrapper: same release output as `tauri:build`, but
with prerequisites verified, npm bootstrap, the signing footgun removed, and the
output paths printed for you.
