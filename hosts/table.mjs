// Declarative host table. A host is a descriptor; the adapter factory turns it into the same
// { id, label, support, evidence, detect, configTargets } shape the registry expects.
// Only hosts that need real probing logic (dsh, hermes, openclaw, muse) stay as modules.
import fs from "node:fs";
import path from "node:path";
import { inspectHostSession } from "./evidence.mjs";

const project = (projectRoot, ...parts) => path.join(projectRoot, ...parts);
const homeDir = (home, ...parts) => (home ? [path.join(home, ...parts)] : []);

function existing(candidates) {
  return candidates.filter((candidate) => fs.existsSync(candidate));
}

const RULES = (reason, warning) => ({ activation: { status: "unobservable", reason }, warnings: [warning] });

export const HOST_TABLE = [
  {
    id: "claude-code",
    label: "Claude Code",
    support: "verified",
    candidates: ({ home, projectRoot }) => [
      project(projectRoot, ".claude"),
      project(projectRoot, "CLAUDE.md"),
      project(projectRoot, ".claude", "dsh-forge-shim.sh"),
      ...homeDir(home, ".claude"),
    ],
    configTargets: { promptFile: "CLAUDE.md", settings: ".claude/settings.json", slash: ".claude/commands/dsh-forge.md", shim: ".claude/dsh-forge-shim.sh" },
  },
  {
    id: "codex",
    label: "Codex CLI",
    support: "verified",
    candidates: ({ home, projectRoot }) => [
      project(projectRoot, "AGENTS.md"),
      project(projectRoot, ".codex", "forge-instructions.md"),
      project(projectRoot, ".codex", "config.toml"),
      ...homeDir(home, ".codex"),
    ],
    configTargets: { promptFile: "AGENTS.md", instructionsFile: ".codex/forge-instructions.md", settings: ".codex/config.toml", userSettings: "~/.codex/config.toml" },
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    support: "experimental",
    candidates: ({ home, projectRoot }) => [
      project(projectRoot, ".gemini"),
      project(projectRoot, ".gemini", "system.md"),
      project(projectRoot, ".gemini", "dsh-forge-shim.sh"),
      project(projectRoot, "GEMINI.md"),
      ...homeDir(home, ".gemini"),
    ],
    configTargets: { promptFile: "GEMINI.md", systemFile: ".gemini/system.md", shim: ".gemini/dsh-forge-shim.sh", settings: ".gemini/settings.json", env: "GEMINI_SYSTEM_MD", launchFlag: "--yolo" },
  },
  {
    id: "opencode",
    label: "OpenCode",
    support: "experimental",
    candidates: ({ home, projectRoot }) => [project(projectRoot, "opencode.json"), project(projectRoot, "AGENTS.md"), ...homeDir(home, ".config/opencode")],
    configTargets: { promptFile: "AGENTS.md", settings: "opencode.json" },
  },
  {
    id: "generic",
    label: "Generic chat / API",
    support: "experimental",
    promptOnly: true,
    configTargets: { promptChannel: "system message" },
  },
  {
    id: "cursor",
    label: "Cursor",
    support: "experimental",
    evidence: {
      documentation: "https://docs.cursor.com/context/rules-for-ai",
      targets: [".cursor/rules/*.mdc", ".cursorrules (legacy)"],
      note: "A discovered rule file proves configuration only; the active Cursor session is not observable here.",
    },
    candidates: ({ projectRoot }) => [project(projectRoot, ".cursor", "rules"), project(projectRoot, ".cursorrules")],
    ...RULES("Cursor session/rule sidebar was not probed", "File presence is configuration evidence only; it does not prove an active Cursor session."),
    configTargets: {
      promptFile: ".cursor/rules/dsh-forge.mdc",
      projectRules: ".cursor/rules/*.mdc",
      legacyProjectRules: ".cursorrules",
      activation: "unobservable until a Cursor Agent session shows the rule as applied",
    },
  },
  {
    id: "windsurf",
    label: "Windsurf",
    support: "experimental",
    evidence: {
      documentation: "https://docs.windsurf.com/windsurf/cascade/memories",
      targets: [".windsurf/rules/*.md", ".windsurfrules (legacy)", "~/.codeium/windsurf/memories/global_rules.md"],
      note: "Workspace/global rule files are configuration evidence only; active Cascade/Devin Local loading is not observable here.",
    },
    candidates: ({ home, projectRoot }) => [
      project(projectRoot, ".windsurf", "rules"),
      project(projectRoot, ".windsurfrules"),
      ...homeDir(home, ".codeium", "windsurf", "memories", "global_rules.md"),
    ],
    ...RULES("Windsurf session/rules panel was not probed", "File presence is configuration evidence only; it does not prove an active Windsurf session."),
    configTargets: {
      promptFile: ".windsurf/rules/dsh-forge.md",
      projectRules: ".windsurf/rules/*.md",
      legacyProjectRules: ".windsurfrules",
      globalRules: "~/.codeium/windsurf/memories/global_rules.md",
      activation: "unobservable until a Windsurf/Cascade session reports the rule as applied",
    },
  },
  {
    id: "aider",
    label: "Aider",
    support: "experimental",
    evidence: {
      documentation: ["https://aider.chat/docs/usage/conventions.html", "https://aider.chat/docs/config/aider_conf.html"],
      targets: ["CONVENTIONS.md", ".aider.conf.yml (read: CONVENTIONS.md)"],
      note: "Aider must read the conventions file explicitly or through config; a file alone is not active-session evidence.",
    },
    candidates: ({ home, projectRoot }) => [
      project(projectRoot, "CONVENTIONS.md"),
      project(projectRoot, ".aider.conf.yml"),
      ...homeDir(home, ".aider.conf.yml"),
    ],
    ...RULES("Aider process/read-set was not probed", "CONVENTIONS.md is active only after /read, --read, or an .aider.conf.yml read entry; file presence alone is not active."),
    configTargets: {
      promptFile: "CONVENTIONS.md",
      configFile: ".aider.conf.yml",
      readEntry: "read: CONVENTIONS.md",
      activation: "unobservable until Aider's session confirms the conventions file is in its read set",
    },
  },
  {
    id: "continue",
    label: "Continue",
    support: "experimental",
    evidence: {
      documentation: ["https://docs.continue.dev/customize/rules", "https://docs.continue.dev/customize/deep-dives/rules"],
      targets: [".continue/rules/*.md", "~/.continue/config.yaml"],
      note: "Continue rule files are configuration evidence only; the current Agent/Chat/Edit session is not observable here.",
    },
    candidates: ({ home, projectRoot }) => [
      project(projectRoot, ".continue", "config.yaml"),
      project(projectRoot, ".continue", "rules"),
      ...homeDir(home, ".continue", "config.yaml"),
    ],
    ...RULES("Continue rules toolbar/session was not probed", "A rule file being present does not prove it was loaded by the current Continue session."),
    configTargets: {
      promptFile: ".continue/rules/dsh-forge.md",
      configYaml: ".continue/config.yaml",
      yamlKey: "chatOptions.baseAgentSystemMessage",
      projectRules: ".continue/rules/*.md",
      userConfig: "~/.continue/config.yaml",
      activation: "unobservable until Continue's rules toolbar/session confirms the rule is loaded",
    },
  },
];

export function hostModule(descriptor) {
  const { id, label, support, evidence, candidates, configTargets, activation, warnings, promptOnly } = descriptor;
  const detect = (context = {}) => {
    if (promptOnly) return { ok: true, note: "prompt-only adapter" };
    const home = context.home ?? process.env.HOME ?? process.env.USERPROFILE;
    const projectRoot = context.projectRoot ?? process.cwd();
    const list = candidates({ home, projectRoot });
    const found = existing(list);
    const session = inspectHostSession(id, { home, projectRoot, sessionDir: context.sessionDir });
    const configEvidence = found.map((file) => ({ kind: "config", path: file }));
    if (session.active) {
      return {
        ok: true,
        status: "active",
        candidates: list,
        evidence: [...configEvidence, ...session.evidence],
        ...(session.identityPrefixPresent !== null ? { identityPrefixPresent: session.identityPrefixPresent } : {}),
        ...(warnings ? { warnings } : {}),
      };
    }
    if (!activation) {
      return {
        ok: found.length > 0,
        status: found.length > 0 ? "configured" : "missing",
        candidates: list,
        evidence: [...configEvidence, ...session.evidence],
        ...(session.identityPrefixPresent !== null ? { identityPrefixPresent: session.identityPrefixPresent } : {}),
      };
    }
    return {
      ok: found.length > 0,
      status: found.length > 0 ? "configured" : "missing",
      candidates: list,
      evidence: [...configEvidence, ...session.evidence],
      activation,
      warnings,
    };
  };
  return {
    id,
    label,
    support,
    ...(evidence ? { evidence } : {}),
    detect,
    configTargets: () => configTargets,
  };
}
