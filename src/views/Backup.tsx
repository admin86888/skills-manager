import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  Github,
  History,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Unlink,
  Upload,
  Wrench,
  XCircle,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GitRecoveryDialog } from "../components/GitRecoveryDialog";
import { GitSetupDialog } from "../components/GitSetupDialog";
import { useApp } from "../context/AppContext";
import { getErrorKind, getErrorMessage } from "../lib/error";
import { mapGitErrorMessage } from "../lib/gitErrors";
import * as api from "../lib/tauri";
import type {
  GitBackupSizeReport,
  GitBackupStatus,
  GitBackupVersion,
  GitUpstreamHealth,
} from "../lib/tauri";

type BackupMode =
  | "loading"
  | "uninitialized"
  | "needs_remote"
  | "needs_fix"
  | "up_to_date"
  | "pending_changes";

type LoadingAction = "start" | "sync" | "recovery" | "save" | "disconnect" | "github" | null;

const DEFAULT_GITHUB_REPO = "skills-manager-backup";
const GITHUB_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=Skills%20Manager%20Backup";
type RecoveryReason = GitUpstreamHealth | "conflict";

function displaySnapshotLabel(tag: string) {
  const raw = tag.startsWith("sm-v-") ? tag.slice("sm-v-".length) : tag;
  const parts = raw.split("-");
  if (parts.length < 3) return raw;
  return `${parts[0]}-${parts[1]}`;
}

function formatSnapshotWhen(tag: string | null) {
  if (!tag) return null;
  const label = displaySnapshotLabel(tag);
  const match = label.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) return label;
  const [, year, month, day, hour, min] = match;
  return `${year}-${month}-${day} ${hour}:${min}`;
}

function formatDateTime(iso: string) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function Backup() {
  const { t } = useTranslation();
  const { managedSkills, refreshManagedSkills } = useApp();
  const [gitStatus, setGitStatus] = useState<GitBackupStatus | null>(null);
  const [remoteInput, setRemoteInput] = useState("");
  const [remoteConfig, setRemoteConfig] = useState("");
  const [versions, setVersions] = useState<GitBackupVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [loading, setLoading] = useState<LoadingAction>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryReason, setRecoveryReason] = useState<RecoveryReason>("unrelated_histories");
  const [restoreVersionTag, setRestoreVersionTag] = useState<string | null>(null);
  const [restoringVersionTag, setRestoringVersionTag] = useState<string | null>(null);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [sizeReport, setSizeReport] = useState<GitBackupSizeReport | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [githubRepoName, setGithubRepoName] = useState(DEFAULT_GITHUB_REPO);
  const [githubError, setGithubError] = useState<string | null>(null);

  const mapGitError = useCallback(
    (error: unknown) => mapGitErrorMessage(error, t),
    [t],
  );

  const isSyncConflictError = (error: unknown) => {
    const message = getErrorMessage(error, "");
    return message.includes("SYNC_CONFLICT") || message.includes("CONFLICT");
  };

  const isRecoverableSetupError = (error: unknown) => {
    const message = getErrorMessage(error, "");
    return (
      message.includes("unrelated histories")
      || message.includes("refusing to merge")
      || message.includes("[rejected]")
      || message.includes("non-fast-forward")
      || message.includes("fetch first")
      || message.includes("failed to push some refs")
      || message.includes("no upstream")
      || isSyncConflictError(error)
    );
  };

  const refreshGitStatus = useCallback(async (fetchRemote = false) => {
    try {
      if (fetchRemote) {
        await api.gitBackupFetch().catch(() => {});
      }
      const status = await api.gitBackupStatus();
      setGitStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  const refreshVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const items = await api.gitBackupListVersions(50);
      setVersions(items);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // §3.7: move any token embedded in the remote URL into the OS keychain
      // before the URL is read or displayed. Idempotent and best-effort —
      // offline machines simply retry on the next visit.
      const migrated = await api.gitBackupMigrateCredentials().catch(() => null);
      if (migrated) {
        toast.info(t("backup.credentialsMigrated"));
      }
      const savedRemote = (await api.getSettings("git_backup_remote_url").catch(() => null))?.trim() || "";
      setRemoteInput(savedRemote);
      setRemoteConfig(savedRemote);
      const status = await refreshGitStatus(true);
      if (status?.is_repo) {
        await refreshVersions();
        api.gitBackupSizeReport().then(setSizeReport).catch(() => setSizeReport(null));
      }
    })();
  }, [refreshGitStatus, refreshVersions, t]);

  useEffect(() => {
    if (gitStatus?.is_repo) {
      void refreshVersions();
    } else {
      setVersions([]);
    }
  }, [gitStatus?.is_repo, refreshVersions]);

  const mode: BackupMode = useMemo(() => {
    if (!gitStatus) return "loading";
    if (!gitStatus.is_repo) return "uninitialized";
    if (!gitStatus.remote_url && !remoteConfig) return "needs_remote";
    if (
      gitStatus.upstream_health === "unrelated_histories"
      || gitStatus.upstream_health === "detached"
    ) {
      return "needs_fix";
    }
    if (gitStatus.upstream_health === "no_upstream") return "pending_changes";
    if (gitStatus.has_changes || gitStatus.ahead > 0 || gitStatus.behind > 0) return "pending_changes";
    return "up_to_date";
  }, [gitStatus, remoteConfig]);

  const statusMeta = useMemo(() => {
    // A failed backup stays visible (with a plain-language reason and a retry
    // action) instead of vanishing with the toast — §3.4 three-state language.
    if (backupError) {
      return {
        icon: XCircle,
        title: t("backup.status.failed"),
        description: backupError,
        className: "border-red-500/40 bg-red-500/10",
        iconClassName: "text-red-500",
      };
    }
    switch (mode) {
      case "loading":
        return {
          icon: Loader2,
          title: t("backup.status.loading"),
          description: t("backup.status.loadingDesc"),
          className: "border-border bg-surface",
          iconClassName: "text-muted animate-spin",
        };
      case "uninitialized":
      case "needs_remote":
        return {
          icon: Cloud,
          title: t("backup.status.notConnected"),
          description: t("backup.status.notConnectedDesc"),
          className: "border-border bg-surface",
          iconClassName: "text-muted",
        };
      case "needs_fix":
        return {
          icon: AlertTriangle,
          title: t("backup.status.needsFix"),
          description: t("backup.status.needsFixDesc"),
          className: "border-red-500/40 bg-red-500/10",
          iconClassName: "text-red-500",
        };
      case "pending_changes":
        return {
          icon: Upload,
          title: t("backup.status.pending"),
          description:
            (gitStatus?.changed_skill_count ?? 0) > 0
              ? t("backup.status.pendingSkills", { count: gitStatus?.changed_skill_count })
              : t("backup.status.pendingDesc", {
                  local: Math.max(gitStatus?.ahead ?? 0, gitStatus?.has_changes ? 1 : 0),
                  remote: gitStatus?.behind ?? 0,
                }),
          className: "border-amber-500/40 bg-amber-500/10",
          iconClassName: "text-amber-600 dark:text-amber-400",
        };
      case "up_to_date":
        return {
          icon: CheckCircle2,
          title: t("backup.status.synced"),
          description: t("backup.status.syncedDesc", {
            when: formatSnapshotWhen(gitStatus?.current_snapshot_tag ?? null) ?? t("backup.status.noSnapshot"),
          }),
          className: "border-emerald-500/30 bg-emerald-500/10",
          iconClassName: "text-emerald-600 dark:text-emerald-400",
        };
    }
  }, [backupError, gitStatus, mode, t]);

  const handleSaveRemote = async () => {
    const trimmed = remoteInput.trim();
    setLoading("save");
    try {
      // Never persist credentials embedded in the URL: they go to the OS
      // keychain and only the sanitized URL is saved and shown (§3.7).
      const effective = trimmed ? await api.gitBackupSanitizeRemoteUrl(trimmed) : "";
      await api.setSettings("git_backup_remote_url", effective);
      if (effective && gitStatus?.is_repo) {
        await api.gitBackupSetRemote(effective);
      }
      setRemoteInput(effective);
      setRemoteConfig(effective);
      toast.success(t("settings.gitConfigSaved"));
      await refreshGitStatus();
    } catch (error) {
      toast.error(mapGitError(error));
    } finally {
      setLoading(null);
    }
  };

  const handleSetupClone = async () => {
    setLoading("start");
    try {
      await api.gitBackupClone(remoteConfig);
      toast.success(t("settings.gitCloneSuccess"));
      await Promise.all([refreshGitStatus(true), refreshManagedSkills(), refreshVersions()]);
    } catch (error) {
      toast.error(mapGitError(error));
      throw error;
    } finally {
      setLoading(null);
    }
  };

  const handleSetupInit = async () => {
    setLoading("start");
    try {
      await api.gitBackupInit();
      if (remoteConfig) {
        await api.gitBackupSetRemote(remoteConfig);
      }
      toast.success(t("settings.gitInitSuccess"));
      await Promise.all([refreshGitStatus(true), refreshVersions()]);
    } catch (error) {
      toast.error(mapGitError(error));
      throw error;
    } finally {
      setLoading(null);
    }
  };

  const handleRecoveryReclone = async () => {
    if (!remoteConfig) {
      toast.info(t("settings.gitNeedRemoteSetup"));
      return;
    }
    setLoading("recovery");
    try {
      await api.gitBackupReclone(remoteConfig);
      toast.success(t("settings.gitRecoveryRecloneSuccess"));
      await Promise.all([refreshGitStatus(true), refreshManagedSkills(), refreshVersions()]);
    } catch (error) {
      toast.error(mapGitError(error));
      throw error;
    } finally {
      setLoading(null);
    }
  };

  const handleBackupNow = async () => {
    setLoading("sync");
    try {
      let status = await api.gitBackupStatus();
      if (!status.is_repo) {
        setSetupOpen(true);
        return;
      }
      if (!status.remote_url && remoteConfig) {
        await api.gitBackupSetRemote(remoteConfig);
        status = await api.gitBackupStatus();
      }
      if (!status.remote_url) {
        toast.info(t("settings.gitNeedRemoteSetup"));
        return;
      }
      if (
        status.upstream_health === "unrelated_histories"
        || status.upstream_health === "detached"
      ) {
        setRecoveryReason(status.upstream_health);
        setRecoveryOpen(true);
        return;
      }
      let committed = false;
      if (status.has_changes) {
        await api.gitBackupCommit(t("settings.gitCommitPlaceholder"));
        committed = true;
        status = await api.gitBackupStatus();
      }
      if (status.behind > 0) {
        await api.gitBackupPull();
        status = await api.gitBackupStatus();
        toast.success(t("settings.gitPullSuccess"));
      }
      const needsPush = committed || status.ahead > 0 || status.upstream_health === "no_upstream";
      if (needsPush) {
        const snapshotTag = await api.gitBackupCreateSnapshot();
        await api.gitBackupPush();
        toast.success(t("mySkills.gitSyncSuccessWithVersion", { tag: displaySnapshotLabel(snapshotTag) }));
      } else {
        toast.success(t("settings.gitUpToDate"));
      }
      setBackupError(null);
      await Promise.all([refreshGitStatus(true), refreshVersions()]);
    } catch (error) {
      setBackupError(mapGitError(error));
      if (isRecoverableSetupError(error)) {
        toast.error(mapGitError(error));
        const latest = await refreshGitStatus();
        setRecoveryReason(isSyncConflictError(error) ? "conflict" : (latest?.upstream_health ?? "unrelated_histories"));
        setRecoveryOpen(true);
      } else {
        toast.error(mapGitError(error));
      }
    } finally {
      setLoading(null);
    }
  };

  const mapGithubError = (error: unknown) => {
    const message = getErrorMessage(error, "");
    if (message.includes("GITHUB_TOKEN_INVALID")) return t("backup.github.errorToken");
    if (message.includes("GITHUB_SCOPE")) return t("backup.github.errorScope");
    if (message.includes("KEYCHAIN_UNAVAILABLE")) return t("backup.github.errorKeychain");
    if (message.includes("GITHUB_NETWORK") || getErrorKind(error) === "network") {
      return t("settings.gitErrorNetwork");
    }
    return mapGitError(error);
  };

  const handleGithubConnect = async () => {
    const token = githubToken.trim();
    if (!token) return;
    setLoading("github");
    setGithubError(null);
    try {
      const res = await api.githubBackupConnect(
        token,
        githubRepoName.trim() || DEFAULT_GITHUB_REPO,
      );
      // Token is in the OS keychain now; drop it from component state.
      setGithubToken("");
      setRemoteInput(res.url);
      setRemoteConfig(res.url);
      if (res.repo_created) {
        const repo = res.url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
        toast.success(t("backup.github.repoCreated", { repo }));
      }
      const status = await api.gitBackupStatus();
      if (res.remote_has_content) {
        // Existing backup: restore it (or just rewire when a repo already exists).
        if (!status.is_repo) {
          await api.gitBackupClone(res.url);
        } else {
          await api.gitBackupSetRemote(res.url);
        }
        toast.success(t("backup.github.connectedRestored"));
        await Promise.all([refreshGitStatus(true), refreshManagedSkills(), refreshVersions()]);
      } else {
        // Fresh backup: initialize if needed, wire the remote, run the first backup.
        if (!status.is_repo) {
          await api.gitBackupInit();
        }
        await api.gitBackupSetRemote(res.url);
        await refreshGitStatus();
        await handleBackupNow();
      }
    } catch (error) {
      setGithubError(mapGithubError(error));
    } finally {
      setLoading(null);
    }
  };

  const handleRestoreVersion = async () => {
    if (!restoreVersionTag) return;
    setRestoringVersionTag(restoreVersionTag);
    try {
      const safetyTag = await api.gitBackupRestoreVersion(restoreVersionTag);
      toast.success(t("mySkills.gitVersionRestoreSuccess", { tag: displaySnapshotLabel(restoreVersionTag) }));
      toast.info(t("backup.restoreSafetyPoint", { tag: displaySnapshotLabel(safetyTag) }));
      await Promise.all([refreshGitStatus(), refreshVersions(), refreshManagedSkills()]);
      setRestoreVersionTag(null);
    } catch (error) {
      toast.error(mapGitError(error));
    } finally {
      setRestoringVersionTag(null);
    }
  };

  const handleDisconnect = async () => {
    setLoading("disconnect");
    try {
      await api.gitBackupRemoveRemote();
      setRemoteInput("");
      setRemoteConfig("");
      toast.success(t("settings.gitDisconnected"));
      await refreshGitStatus();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setDisconnectConfirmOpen(false);
      setLoading(null);
    }
  };

  const StatusIcon = statusMeta.icon;
  const canBackupNow = mode === "pending_changes" || mode === "up_to_date";
  const remoteLabel = gitStatus?.remote_url || remoteConfig || t("backup.connection.none");
  const branchLabel = gitStatus?.branch || t("backup.connection.unknown");

  return (
    <div className="app-page">
      <div className="app-page-header pr-2 pb-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="app-page-title">{t("backup.title")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("backup.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => refreshGitStatus(true)}
          disabled={!!loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-border bg-surface px-2.5 text-[13px] font-medium text-tertiary transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("settings.refresh")}
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className={cn("app-panel border p-4", statusMeta.className)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-border-subtle bg-surface">
                  <StatusIcon className={cn("h-5 w-5", statusMeta.iconClassName)} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-primary">{statusMeta.title}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-muted">{statusMeta.description}</p>
                  <div className="mt-3 grid gap-2 text-[12px] text-tertiary sm:grid-cols-2">
                    <div className="min-w-0">
                      <div className="text-faint">{t("backup.connection.repository")}</div>
                      <div className="truncate font-mono text-secondary" title={remoteLabel}>{remoteLabel}</div>
                    </div>
                    <div>
                      <div className="text-faint">{t("backup.connection.branch")}</div>
                      <div className="font-mono text-secondary">{branchLabel}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {mode === "needs_fix" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryReason(gitStatus?.upstream_health ?? "unrelated_histories");
                      setRecoveryOpen(true);
                    }}
                    disabled={!!loading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-red-500/40 bg-red-500/10 px-3 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-500/15 disabled:opacity-50 dark:text-red-300"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    {t("settings.gitRecoveryTitle")}
                  </button>
                ) : mode === "uninitialized" || mode === "needs_remote" ? (
                  <button
                    type="button"
                    onClick={() => setSetupOpen(true)}
                    disabled={!!loading || !remoteConfig}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-accent-border bg-accent-dark px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {loading === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                    {t("settings.gitStartBackup")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleBackupNow}
                    disabled={!!loading || !canBackupNow}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-accent-border bg-accent-dark px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {loading === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {backupError
                      ? t("backup.actions.retry")
                      : mode === "up_to_date"
                        ? t("backup.actions.backupAgain")
                        : t("backup.actions.backupNow")}
                  </button>
                )}
              </div>
            </div>
          </section>

          {!gitStatus?.remote_url && !remoteConfig && (
            <section className="app-panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <Github className="h-4 w-4 text-muted" />
                <h2 className="text-[14px] font-semibold text-secondary">{t("backup.github.title")}</h2>
              </div>
              <p className="mb-3 text-[13px] leading-5 text-muted">{t("backup.github.desc")}</p>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(event) => {
                      setGithubToken(event.target.value);
                      setGithubError(null);
                    }}
                    placeholder={t("backup.github.tokenPlaceholder")}
                    disabled={loading === "github"}
                    className="h-8 min-w-0 flex-1 rounded-[4px] border border-border-subtle bg-background px-2.5 font-mono text-[13px] text-secondary outline-none transition-colors focus:border-border disabled:opacity-50"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <input
                    type="text"
                    value={githubRepoName}
                    onChange={(event) => setGithubRepoName(event.target.value)}
                    disabled={loading === "github"}
                    title={t("backup.github.repoLabel")}
                    className="h-8 w-52 rounded-[4px] border border-border-subtle bg-background px-2.5 font-mono text-[13px] text-secondary outline-none transition-colors focus:border-border disabled:opacity-50"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={handleGithubConnect}
                    disabled={!!loading || !githubToken.trim()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-accent-border bg-accent-dark px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading === "github" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
                    {loading === "github" ? t("backup.github.connecting") : t("backup.github.connect")}
                  </button>
                </div>
                {githubError && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-600 dark:text-red-300">
                    {githubError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void openUrl(GITHUB_TOKEN_URL)}
                  className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-secondary"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("backup.github.tokenHint")}
                </button>
              </div>
            </section>
          )}

          <section className="app-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <Cloud className="h-4 w-4 text-muted" />
              <h2 className="text-[14px] font-semibold text-secondary">{t("backup.connection.title")}</h2>
            </div>
            <p className="mb-3 text-[13px] leading-5 text-muted">{t("backup.connection.desc")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={remoteInput}
                onChange={(event) => setRemoteInput(event.target.value)}
                placeholder={t("settings.gitRemoteUrlPlaceholder")}
                className="h-8 min-w-0 flex-1 rounded-[4px] border border-border-subtle bg-background px-2.5 font-mono text-[13px] text-secondary outline-none transition-colors focus:border-border"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={handleSaveRemote}
                disabled={loading === "save"}
                className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-border bg-surface-hover px-2.5 text-[13px] font-medium text-tertiary transition-colors hover:bg-surface-active disabled:opacity-50"
              >
                {loading === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t("common.save")}
              </button>
            </div>
          </section>

          <section className="app-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted" />
                <h2 className="text-[14px] font-semibold text-secondary">{t("backup.history.title")}</h2>
              </div>
              <button
                type="button"
                onClick={refreshVersions}
                disabled={versionsLoading || !gitStatus?.is_repo}
                className="inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3 w-3", versionsLoading && "animate-spin")} />
                {t("settings.refresh")}
              </button>
            </div>

            {versionsLoading ? (
              <div className="py-6 text-center text-[13px] text-muted">{t("mySkills.gitVersionLoading")}</div>
            ) : versions.length === 0 ? (
              <div className="rounded-[6px] border border-dashed border-border-subtle py-6 text-center text-[13px] text-muted">
                {t("backup.history.empty")}
              </div>
            ) : (
              <div className="max-h-[360px] space-y-1.5 overflow-auto pr-1">
                {versions.map((version) => (
                  <div
                    key={version.tag}
                    className="flex items-center justify-between gap-3 rounded-[6px] border border-border-subtle bg-bg-secondary px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-secondary">
                        {displaySnapshotLabel(version.tag)}
                      </div>
                      <div className="truncate text-[12px] text-muted">{version.message || version.commit}</div>
                      <div className="text-[11px] text-faint">
                        {version.commit} · {formatDateTime(version.committed_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRestoreVersionTag(version.tag)}
                      disabled={!!restoringVersionTag}
                      className="shrink-0 rounded-[4px] border border-border-subtle px-2 py-1 text-[12px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      {restoringVersionTag === version.tag
                        ? t("mySkills.gitVersionRestoring")
                        : t("mySkills.gitVersionRestore")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="app-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted" />
              <h2 className="text-[14px] font-semibold text-secondary">{t("backup.scope.title")}</h2>
            </div>
            <div className="space-y-2 text-[13px]">
              {["skills", "metadata"].map((key) => (
                <div key={key} className="flex items-start gap-2 text-tertiary">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span>{t(`backup.scope.included.${key}`)}</span>
                </div>
              ))}
              {["secrets", "local"].map((key) => (
                <div key={key} className="flex items-start gap-2 text-muted">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                  <span>{t(`backup.scope.excluded.${key}`)}</span>
                </div>
              ))}
            </div>
            {sizeReport && (sizeReport.oversized.length > 0 || sizeReport.total_bytes > sizeReport.repo_warn_bytes) ? (
              <div className="mt-3 space-y-1 rounded-[6px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-300">
                {sizeReport.total_bytes > sizeReport.repo_warn_bytes && (
                  <div>{t("backup.scope.repoTooLarge", { size: formatBytes(sizeReport.total_bytes) })}</div>
                )}
                {sizeReport.oversized.map((skill) => (
                  <div key={skill.name}>
                    {t("backup.scope.oversizedSkill", { name: skill.name, size: formatBytes(skill.bytes) })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[6px] border border-border-subtle bg-bg-secondary px-3 py-2 text-[12px] leading-5 text-muted">
                {t("backup.scope.sizeHint")}
              </div>
            )}
          </section>

          <section className="app-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <Unlink className="h-4 w-4 text-muted" />
              <h2 className="text-[14px] font-semibold text-secondary">{t("backup.disconnect.title")}</h2>
            </div>
            <p className="text-[13px] leading-5 text-muted">{t("backup.disconnect.desc")}</p>
            <button
              type="button"
              onClick={() => setDisconnectConfirmOpen(true)}
              disabled={loading === "disconnect" || (!remoteConfig && !gitStatus?.remote_url)}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-border bg-surface-hover px-2.5 text-[13px] font-medium text-tertiary transition-colors hover:bg-surface-active disabled:opacity-50"
            >
              {loading === "disconnect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
              {t("settings.gitDisconnect")}
            </button>
          </section>

          <section className="app-panel p-4">
            <h2 className="text-[14px] font-semibold text-secondary">{t("backup.summary.title")}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-[6px] border border-border-subtle bg-bg-secondary px-3 py-2">
                <div className="text-faint">{t("backup.summary.skills")}</div>
                <div className="mt-1 text-[18px] font-semibold text-primary">{managedSkills.length}</div>
              </div>
              <div className="rounded-[6px] border border-border-subtle bg-bg-secondary px-3 py-2">
                <div className="text-faint">{t("backup.summary.snapshots")}</div>
                <div className="mt-1 text-[18px] font-semibold text-primary">{versions.length}</div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={restoreVersionTag !== null}
        title={t("mySkills.gitVersionRestoreTitle")}
        message={t("mySkills.gitVersionRestoreConfirm", { tag: displaySnapshotLabel(restoreVersionTag || "") })}
        tone="warning"
        confirmLabel={t("mySkills.gitVersionRestore")}
        onClose={() => setRestoreVersionTag(null)}
        onConfirm={handleRestoreVersion}
      />
      <ConfirmDialog
        open={disconnectConfirmOpen}
        title={t("backup.disconnect.confirmTitle")}
        message={t("backup.disconnect.confirmMessage")}
        tone="warning"
        confirmLabel={t("settings.gitDisconnect")}
        onClose={() => setDisconnectConfirmOpen(false)}
        onConfirm={handleDisconnect}
      />
      <GitSetupDialog
        open={setupOpen}
        hasRemote={!!remoteConfig}
        onClose={() => setSetupOpen(false)}
        onClone={handleSetupClone}
        onInit={handleSetupInit}
      />
      <GitRecoveryDialog
        open={recoveryOpen}
        reason={recoveryReason}
        onClose={() => setRecoveryOpen(false)}
        onReclone={handleRecoveryReclone}
      />
    </div>
  );
}
