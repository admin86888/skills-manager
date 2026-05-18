/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ManagedSkill, Project, Preset, ToolInfo } from "../lib/tauri";
import * as api from "../lib/tauri";
import i18n from "../i18n";
import { applyTextSize } from "../lib/textScale";
import { toast } from "sonner";

interface AppState {
  presets: Preset[];
  /** Backend-tracked "last applied to default targets". Drives the "Applied to..." status, not the sidebar selection. */
  activePreset: Preset | null;
  /** Frontend-only "currently being viewed/edited" preset. Persisted to localStorage. UI selection. */
  viewedPreset: Preset | null;
  tools: ToolInfo[];
  managedSkills: ManagedSkill[];
  projects: Project[];
  loading: boolean;
  appError: string | null;
  helpOpen: boolean;
  detailSkillId: string | null;
  refreshAppData: () => Promise<void>;
  refreshPresets: () => Promise<void>;
  refreshTools: () => Promise<void>;
  refreshManagedSkills: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  setViewedPresetId: (id: string) => void;
  applyPresetToDefault: (id: string) => Promise<void>;
  clearAppError: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  openSkillDetailById: (skillId: string) => void;
  closeSkillDetail: () => void;
}

const VIEWED_PRESET_LS_KEY = "skills-manager.viewedPresetId";
const LEGACY_VIEWED_PRESET_LS_KEY = "skills-manager.viewedScenarioId";

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const SKILL_UPDATE_TOAST_ID = "skill-update-available";
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [viewedPresetId, setViewedPresetIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(VIEWED_PRESET_LS_KEY) || localStorage.getItem(LEGACY_VIEWED_PRESET_LS_KEY);
    } catch {
      return null;
    }
  });
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [managedSkills, setManagedSkills] = useState<ManagedSkill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const autoCheckInFlightRef = useRef(false);
  const lastUpdateNotificationRef = useRef<string | null>(null);
  const lastActivePresetIdRef = useRef<string | null>(null);

  const setTranslatedError = useCallback((key: string) => {
    setAppError(i18n.t("common.loadFailed", { item: i18n.t(key) }));
  }, []);

  const refreshPresets = useCallback(async () => {
    try {
      const [s, active] = await Promise.all([
        api.getPresets(),
        api.getActivePreset(),
      ]);
      setPresets(s);
      setActivePreset(active);
      const previousActiveId = lastActivePresetIdRef.current;
      const nextActiveId = active?.id ?? null;
      if (previousActiveId !== nextActiveId) {
        lastActivePresetIdRef.current = nextActiveId;
        // Carry the sidebar along only when the user was viewing the old
        // active preset — that way an external switch (CLI/tray) follows,
        // but a user who's browsing some other preset isn't yanked away.
        // Skip the initial load (previousActiveId === null) entirely so a
        // persisted viewedPreset from localStorage isn't clobbered.
        if (nextActiveId && previousActiveId !== null) {
          setViewedPresetIdState((current) => {
            if (current !== previousActiveId) return current;
            try {
              localStorage.setItem(VIEWED_PRESET_LS_KEY, nextActiveId);
            } catch {
              // localStorage may be unavailable; selection is still tracked in memory.
            }
            return nextActiveId;
          });
        }
      }
      setAppError(null);
    } catch (e) {
      console.error("Failed to load presets:", e);
      setTranslatedError("common.presets");
    }
  }, [setTranslatedError]);

  const refreshTools = useCallback(async () => {
    try {
      const t = await api.getToolStatus();
      setTools(t);
      setAppError(null);
    } catch (e) {
      console.error("Failed to load tools:", e);
      setTranslatedError("common.agents");
    }
  }, [setTranslatedError]);

  const refreshProjects = useCallback(async () => {
    try {
      const p = await api.getProjects();
      setProjects(p);
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  }, []);

  const refreshManagedSkills = useCallback(async () => {
    try {
      const skills = await api.getManagedSkills();
      setManagedSkills(skills);
      setAppError(null);
    } catch (e) {
      console.error("Failed to load managed skills:", e);
      setTranslatedError("common.skills");
    }
    // Managed skill changes affect project sync health badges
    refreshProjects();
  }, [setTranslatedError, refreshProjects]);

  const refreshAppData = useCallback(async () => {
    setLoading(true);
    await Promise.all([refreshPresets(), refreshTools(), refreshManagedSkills(), refreshProjects()]);
    setLoading(false);
  }, [refreshManagedSkills, refreshProjects, refreshPresets, refreshTools]);

  const setViewedPresetId = useCallback((id: string) => {
    setViewedPresetIdState(id);
    try {
      localStorage.setItem(VIEWED_PRESET_LS_KEY, id);
    } catch {
      // localStorage may be unavailable; selection is still tracked in memory.
    }
  }, []);

  const handleApplyPresetToDefault = useCallback(
    async (id: string) => {
      await api.applyPresetToDefault(id);
      await Promise.all([refreshPresets(), refreshManagedSkills()]);
    },
    [refreshManagedSkills, refreshPresets]
  );

  // Resolve viewedPreset: persisted id > activePreset > first preset.
  // Persist whichever resolves so the next launch matches what the user saw.
  const viewedPreset = (() => {
    if (viewedPresetId) {
      const found = presets.find((s) => s.id === viewedPresetId);
      if (found) return found;
    }
    return activePreset ?? presets[0] ?? null;
  })();

  useEffect(() => {
    if (!viewedPreset) return;
    if (viewedPreset.id !== viewedPresetId) {
      // Persist the resolved fallback so subsequent reads are stable.
      setViewedPresetIdState(viewedPreset.id);
      try {
        localStorage.setItem(VIEWED_PRESET_LS_KEY, viewedPreset.id);
      } catch {
        // ignore
      }
    }
  }, [viewedPreset, viewedPresetId]);

  useEffect(() => {
    async function init() {
      await refreshAppData();
      // Apply saved text size on startup
      const savedSize = await api.getSettings("text_size").catch(() => null);
      if (savedSize) {
        applyTextSize(savedSize);
      }
    }
    init();
  }, [refreshAppData]);

  useEffect(() => {
    const unlistenPromise = listen<string>("tray-preset-switched", async () => {
      await Promise.all([refreshPresets(), refreshManagedSkills()]);
    });

    return () => {
      unlistenPromise
        .then((unlisten) => unlisten())
        .catch((error) => {
          console.error("Failed to unlisten tray-preset-switched:", error);
        });
    };
  }, [refreshManagedSkills, refreshPresets]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const unlistenPromise = listen("app-files-changed", () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshAppData().catch((error) => {
          console.error("Failed to refresh after filesystem change:", error);
        });
      }, 500);
    });

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      unlistenPromise
        .then((unlisten) => unlisten())
        .catch((error) => {
          console.error("Failed to unlisten app-files-changed:", error);
        });
    };
  }, [refreshAppData]);

  // Auto-check skill updates on startup (non-blocking, silent)
  useEffect(() => {
    if (loading || managedSkills.length === 0) return;
    const hasGitSkills = managedSkills.some(
      (s) => s.source_type === "git" || s.source_type === "skillssh"
    );
    if (!hasGitSkills || autoCheckInFlightRef.current) return;

    // Delay to avoid slowing down initial render
    const timer = setTimeout(() => {
      autoCheckInFlightRef.current = true;
      api.checkAllSkillUpdates(false)
        .then(async () => {
          const skills = await api.getManagedSkills();
          setManagedSkills(skills);
          const updatable = skills
            .filter((s) => s.update_status === "update_available")
            .sort((a, b) => a.id.localeCompare(b.id));

          if (updatable.length === 0) {
            lastUpdateNotificationRef.current = null;
            toast.dismiss(SKILL_UPDATE_TOAST_ID);
            return;
          }

          const notificationSignature = updatable.map((skill) => skill.id).join("|");
          if (lastUpdateNotificationRef.current === notificationSignature) {
            return;
          }

          lastUpdateNotificationRef.current = notificationSignature;
          if (updatable.length > 0) {
            toast.info(
              i18n.t("mySkills.updateNotification", { count: updatable.length }),
              {
                id: SKILL_UPDATE_TOAST_ID,
                duration: 8000,
                action: {
                  label: i18n.t("mySkills.viewUpdates"),
                  onClick: () => {
                    setDetailSkillId(null);
                    // Navigate to My Skills without opening a specific detail panel.
                    // AppProvider is outside Router, so use pushState + popstate
                    // to preserve SPA state.
                    if (!window.location.pathname.endsWith("/my-skills")) {
                      window.history.pushState(null, "", "/my-skills");
                      window.dispatchEvent(new PopStateEvent("popstate"));
                    }
                  },
                },
              }
            );
          }
        })
        .catch(() => {}) // silent failure
        .finally(() => {
          autoCheckInFlightRef.current = false;
        });
    }, 3000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <AppContext.Provider
      value={{
        presets,
        activePreset,
        viewedPreset,
        tools,
        managedSkills,
        projects,
        loading,
        appError,
        helpOpen,
        detailSkillId,
        refreshAppData,
        refreshPresets,
        refreshTools,
        refreshManagedSkills,
        refreshProjects,
        setViewedPresetId,
        applyPresetToDefault: handleApplyPresetToDefault,
        clearAppError: () => setAppError(null),
        openHelp: () => setHelpOpen(true),
        closeHelp: () => setHelpOpen(false),
        openSkillDetailById: (skillId: string) => setDetailSkillId(skillId),
        closeSkillDetail: () => setDetailSkillId(null),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
