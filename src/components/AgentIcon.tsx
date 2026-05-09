import { useState, type ReactNode } from "react";
import { Globe } from "lucide-react";
import { cn } from "../utils";

const AGENT_ICON_FILES: Record<string, string> = {
  adal: "adal.png",
  amp: "amp.svg",
  antigravity: "antigravity.png",
  augment: "augment.svg",
  bob: "bob.png",
  claude_code: "claude_code.svg",
  cline: "cline.png",
  codebuddy: "codebuddy.svg",
  codex: "codex.svg",
  command_code: "command_code.svg",
  continue: "continue.png",
  cortex: "cortex.png",
  crush: "crush.png",
  cursor: "cursor.png",
  deepagents: "deepagents.png",
  droid: "droid.svg",
  firebender: "firebender.svg",
  gemini_cli: "gemini_cli.svg",
  github_copilot: "github_copilot.png",
  goose: "goose.png",
  hermes: "hermes.png",
  iflow: "iflow.png",
  junie: "junie.png",
  kilo_code: "kilo_code.svg",
  kimi: "kimi.svg",
  kiro: "kiro.svg",
  kode: "kode.png",
  mcpjam: "mcpjam.png",
  mistral_vibe: "mistral_vibe.svg",
  mux: "mux.png",
  neovate: "neovate.png",
  openclaw: "openclaw.svg",
  opencode: "opencode.png",
  openhands: "openhands.png",
  pi: "pi.svg",
  pochi: "pochi.png",
  qoder: "qoder.svg",
  qwen_code: "qwen_code.png",
  replit: "replit.png",
  roo_code: "roo_code.svg",
  trae: "trae.svg",
  trae_cn: "trae_cn.svg",
  warp: "warp.svg",
  windsurf: "windsurf.svg",
  zencoder: "zencoder.png",
};

function getAgentIconSrc(agentKey: string): string | null {
  const file = AGENT_ICON_FILES[agentKey];
  return file ? `/agent-icons/${file}` : null;
}

interface AgentIconProps {
  agentKey: string;
  displayName?: string;
  className?: string;
  imageClassName?: string;
  fallback?: ReactNode;
}

export function AgentIcon({
  agentKey,
  displayName,
  className,
  imageClassName,
  fallback,
}: AgentIconProps) {
  const src = getAgentIconSrc(agentKey);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasFailed = src === failedSrc;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-border-subtle bg-surface",
        className
      )}
      title={displayName}
      aria-hidden="true"
    >
      {src && !hasFailed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className={cn("h-full w-full object-contain", imageClassName)}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        fallback ?? <Globe className="h-1/2 w-1/2 text-muted" />
      )}
    </span>
  );
}
