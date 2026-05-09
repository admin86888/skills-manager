import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Square, SquareCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import type { ManagedSkill, Scenario } from "../lib/tauri";
import { getScenarioIconOption } from "../lib/scenarioIcons";
import { computePresetStatus } from "../lib/presetStatus";
import { getErrorMessage } from "../lib/error";

export interface PresetWorkspaceAgent {
  key: string;
  display_name: string;
  enabled: boolean;
  installed: boolean;
}

export interface PresetWorkspaceActionResult {
  added: number;
  removed: number;
  skipped: number;
  failed: number;
}

interface Props {
  open: boolean;
  title: string;
  presets: Scenario[];
  managedSkills: ManagedSkill[];
  agents: PresetWorkspaceAgent[];
  initialSelectedAgents?: string[];
  onClose: () => void;
  existsInWorkspace: (skill: ManagedSkill, agentKey: string) => boolean;
  onAddSkill: (skill: ManagedSkill, agentKey: string) => Promise<void>;
  onRemoveSkill: (skill: ManagedSkill, agentKey: string) => Promise<void>;
  onComplete: (result: PresetWorkspaceActionResult) => Promise<void> | void;
}

export function PresetWorkspaceActionDialog({
  open,
  title,
  presets,
  managedSkills,
  agents,
  initialSelectedAgents,
  onClose,
  existsInWorkspace,
  onAddSkill,
  onRemoveSkill,
  onComplete,
}: Props) {
  const { t } = useTranslation();
  const [selectedAgentsOverride, setSelectedAgentsOverride] = useState<string[] | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.installed),
    [agents]
  );

  const defaultAgentKeys = useMemo(() => {
    const valid = new Set(availableAgents.map((a) => a.key));
    const fromInitial = (initialSelectedAgents ?? []).filter((key) => valid.has(key));
    if (fromInitial.length > 0) return Array.from(new Set(fromInitial));
    const enabled = availableAgents.filter((a) => a.enabled).map((a) => a.key);
    return enabled.length > 0 ? enabled : availableAgents.map((a) => a.key);
  }, [availableAgents, initialSelectedAgents]);

  const selectedAgents = selectedAgentsOverride ?? defaultAgentKeys;

  const selectedAgentSet = useMemo(() => new Set(selectedAgents), [selectedAgents]);

  const toggleAgent = (key: string) => {
    setSelectedAgentsOverride((current) => {
      const prev = current ?? defaultAgentKeys;
      return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    });
  };

  const handleActivate = async (preset: Scenario) => {
    const key = `${preset.id}-add`;
    setLoadingKey(key);
    try {
      const presetSkills = managedSkills.filter((s) => s.scenario_ids.includes(preset.id));
      const result: PresetWorkspaceActionResult = { added: 0, removed: 0, skipped: 0, failed: 0 };
      for (const skill of presetSkills) {
        for (const agentKey of selectedAgents) {
          if (existsInWorkspace(skill, agentKey)) { result.skipped++; continue; }
          try {
            await onAddSkill(skill, agentKey);
            result.added++;
          } catch {
            result.failed++;
          }
        }
      }
      if (result.added > 0) {
        toast.success(t("presetActions.addedToast", { added: result.added, skipped: result.skipped }));
      } else if (result.failed === 0) {
        toast.info(t("presetActions.nothingToAdd"));
      }
      if (result.failed > 0) toast.error(t("presetActions.partialFailedToast", { count: result.failed }));
      await onComplete(result);
    } catch (error) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDeactivate = async (preset: Scenario) => {
    const key = `${preset.id}-remove`;
    setLoadingKey(key);
    try {
      const presetSkills = managedSkills.filter((s) => s.scenario_ids.includes(preset.id));
      const result: PresetWorkspaceActionResult = { added: 0, removed: 0, skipped: 0, failed: 0 };
      for (const skill of presetSkills) {
        for (const agentKey of selectedAgents) {
          if (!existsInWorkspace(skill, agentKey)) continue;
          try {
            await onRemoveSkill(skill, agentKey);
            result.removed++;
          } catch {
            result.failed++;
          }
        }
      }
      if (result.removed > 0) {
        toast.success(t("presetActions.removedToast", { removed: result.removed }));
      } else if (result.failed === 0) {
        toast.info(t("presetActions.nothingToRemove"));
      }
      if (result.failed > 0) toast.error(t("presetActions.partialFailedToast", { count: result.failed }));
      await onComplete(result);
    } catch (error) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      setLoadingKey(null);
    }
  };

  if (!open) return null;

  const busy = loadingKey !== null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-secondary shadow-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="text-[14px] font-semibold text-primary">{title}</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-[4px] p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Agent selector */}
        {availableAgents.length > 1 && (
          <div className="shrink-0 border-b border-border-subtle px-5 py-3">
            <div className="mb-2 text-[12px] font-medium text-muted">{t("presetActions.agents")}</div>
            <div className="flex flex-wrap gap-1.5">
              {availableAgents.map((agent) => {
                const active = selectedAgentSet.has(agent.key);
                return (
                  <button
                    key={agent.key}
                    onClick={() => toggleAgent(agent.key)}
                    disabled={busy}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                      active
                        ? "border-accent-border bg-accent-bg text-accent-light"
                        : "border-border-subtle text-muted hover:border-border hover:text-secondary"
                    )}
                  >
                    {active
                      ? <SquareCheck className="h-3 w-3" />
                      : <Square className="h-3 w-3" />}
                    {agent.display_name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Preset list */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
          {presets.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-muted">{t("presetActions.noPresets")}</div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {presets.map((preset) => {
                const { status, installed, total } = computePresetStatus(
                  preset, managedSkills, selectedAgents, existsInWorkspace
                );
                const scenarioIcon = getScenarioIconOption(preset);
                const ScenarioIcon = scenarioIcon.icon;
                const addKey = `${preset.id}-add`;
                const rmKey = `${preset.id}-remove`;
                const addLoading = loadingKey === addKey;
                const rmLoading = loadingKey === rmKey;

                return (
                  <div key={preset.id} className="flex items-center gap-3 px-5 py-3">
                    {/* Icon */}
                    <span className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                      status === "active"
                        ? `${scenarioIcon.activeClass} ${scenarioIcon.colorClass}`
                        : "border-border bg-surface text-muted"
                    )}>
                      <ScenarioIcon className="h-3.5 w-3.5" />
                    </span>

                    {/* Name + skill count */}
                    <div className="min-w-0 flex-1">
                      <span className="truncate text-[13px] font-medium text-primary">{preset.name}</span>
                      <span className="ml-2 text-[12px] text-muted">{preset.skill_count}</span>
                    </div>

                    {/* Status badge */}
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      status === "active" && "bg-emerald-500/10 text-emerald-500",
                      status === "partial" && "bg-amber-500/10 text-amber-500",
                      (status === "inactive" || status === "empty") && "bg-surface-hover text-muted"
                    )}>
                      {status === "active" && t("presetActions.statusActive")}
                      {status === "partial" && t("presetActions.statusPartial", { installed, total })}
                      {status === "inactive" && t("presetActions.statusInactive")}
                      {status === "empty" && t("presetActions.noPresetSkills")}
                    </span>

                    {/* Action buttons */}
                    {status !== "empty" && selectedAgents.length > 0 && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {(status === "inactive" || status === "partial") && (
                          <button
                            onClick={() => handleActivate(preset)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                          >
                            {addLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                            {t("presetActions.activate")}
                          </button>
                        )}
                        {(status === "active" || status === "partial") && (
                          <button
                            onClick={() => handleDeactivate(preset)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:border-red-400 hover:text-red-400 disabled:opacity-50"
                          >
                            {rmLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                            {t("presetActions.deactivate")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end border-t border-border-subtle px-5 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border-subtle px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:border-border hover:text-secondary disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
