/**
 * Delivery grades describe how much of the host's own system prompt a profile
 * can displace. The vocabulary is deliberately about residue: a host that
 * accepts a full replacement earns `replace-full`; one that keeps its built-in
 * block above whatever you inject can only ever reach `append-only`.
 *
 * Every row names the mechanism that decides the grade. `source: "research"`
 * means the mechanism was read from host documentation and issue threads, not
 * observed in this repository's test suite.
 */
export const GRADES = ["replace-full", "replace-with-residue", "append-only", "shim-only", "unobservable"];

export const HOST_GRADES = {
  gemini: {
    grade: "replace-full",
    mechanism: "GEMINI_SYSTEM_MD replaces the built-in system prompt wholesale",
    source: "research",
  },
  codex: {
    grade: "replace-full",
    mechanism: "model_instructions_file replaces the built-in instruction block",
    source: "research",
  },
  continue: {
    grade: "replace-full",
    mechanism: "chatOptions.baseAgentSystemMessage replaces the base agent message",
    source: "research",
  },
  dsh: {
    grade: "replace-with-residue",
    mechanism: "patched prompt tables plus ~/.dsh/prompt-inject.md; patched text can leave traces of the original wording",
    source: "measured",
  },
  "claude-code": {
    grade: "append-only",
    mechanism: "--system-prompt appends after a fixed 57-character identity block",
    source: "research",
  },
  cursor: { grade: "append-only", mechanism: "rule files add to the built-in prompt", source: "research" },
  windsurf: { grade: "append-only", mechanism: "rule files add to the built-in prompt", source: "research" },
  opencode: {
    grade: "replace-full",
    mechanism: "agent.build.prompt in opencode.json overrides the built-in build agent system prompt (AGENTS.md appends project context)",
    source: "measured",
  },
  aider: { grade: "append-only", mechanism: "CONVENTIONS.md adds to the built-in prompt", source: "research" },
  hermes: {
    grade: "replace-with-residue",
    mechanism: "SOUL.md + config.yaml agent.system_prompt replace persona/system slots with forge block markers that clear threat_patterns; framework guidance blocks remain",
    source: "measured",
  },
  openclaw: {
    grade: "append-only",
    mechanism: "workspace AGENTS.md and SOUL.md add to a packaged prompt that cannot be patched without breaking the signature",
    source: "measured",
  },
  muse: {
    grade: "unobservable",
    mechanism: "the system prompt is delivered by the service; the bundle carries feature gates only",
    source: "measured",
  },
  generic: {
    grade: "unobservable",
    mechanism: "protocol-level system message; nothing in the host can be observed or graded from here",
    source: "measured",
  },
};

function verifyFullReplacementRequirement(host, items = []) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const hasOp = (op, kind) => items.some((item) => item?.op === op || item?.kind === kind);
  if (host === "codex") {
    const toml = items.find((item) => (item?.op === "merge-toml" || item?.kind === "toml-merge") && String(item?.path || "").endsWith(".codex/config.toml"));
    const setsField = Boolean(toml?.value && typeof toml.value.model_instructions_file === "string" && toml.value.model_instructions_file.trim());
    if (!setsField) {
      return {
        grade: "append-only",
        mechanism: "AGENTS.md appends project instructions without overriding built-in Codex system instructions",
        source: "compiled",
        improvement: "add a .codex/config.toml toml-merge setting model_instructions_file to forge-instructions.md (matching .codex/forge-instructions.md)",
      };
    }
    return { source: "verified-config" };
  }
  if (host === "gemini") {
    const hasPromptFile = items.some((item) => (item?.op === "write-file" || item?.kind === "file") && String(item?.path || "").endsWith(".gemini/system.md"));
    const hasShim = items.some((item) => {
      if (item?.op !== "write-shim" && item?.kind !== "write-shim") return false;
      if (item?.env?.GEMINI_SYSTEM_MD) return true;
      return typeof item?.content === "string" && item.content.includes("export GEMINI_SYSTEM_MD=");
    });
    if (!hasPromptFile || !hasShim) {
      return {
        grade: "append-only",
        mechanism: "GEMINI.md and settings autoAccept operate without GEMINI_SYSTEM_MD full replacement",
        source: "compiled",
        improvement: "emit .gemini/system.md plus a write-shim setting GEMINI_SYSTEM_MD",
      };
    }
    return { source: "verified-config" };
  }
  if (host === "continue") {
    const yaml = items.find((item) => (item?.op === "merge-yaml" || item?.kind === "yaml-merge") && /config\.yaml$/.test(String(item?.path || "")));
    const setsBase = Boolean(yaml?.value?.chatOptions?.baseAgentSystemMessage || yaml?.value?.systemMessage);
    if (!setsBase) {
      return {
        grade: "append-only",
        mechanism: "Continue rules append after the base agent message unless config.yaml sets chatOptions.baseAgentSystemMessage",
        source: "compiled",
        improvement: "emit a yaml-merge on .continue/config.yaml setting chatOptions.baseAgentSystemMessage",
      };
    }
    return { source: "verified-config" };
  }
  if (host === "opencode") {
    const json = items.find((item) => (item?.op === "merge-json" || item?.kind === "json-merge") && String(item?.path || "").endsWith("opencode.json"));
    const setsBuildPrompt = Boolean(json?.value?.agent?.build?.prompt && String(json.value.agent.build.prompt).trim());
    if (!setsBuildPrompt) {
      return {
        grade: "append-only",
        mechanism: "AGENTS.md adds project context after the built-in OpenCode prompt unless opencode.json sets agent.build.prompt",
        source: "compiled",
        improvement: "emit a json-merge on opencode.json setting agent.build.prompt to {{PROMPT}}",
      };
    }
    return { source: "verified-config" };
  }
  if (hasOp("dsh-patches", "dsh-patches") || hasOp("write-shim", "write-shim")) return null;
  return null;
}

export function gradeOf(profile = {}, actions = null) {
  const row = HOST_GRADES[profile.host];
  if (!row) {
    return {
      grade: "unobservable",
      mechanism: `no grading recorded for host ${profile.host || "(unknown)"}`,
      source: "none",
      improvements: [],
    };
  }
  const channels = profile.__channels || null;
  const inspected = Array.isArray(actions)
    ? actions
    : Array.isArray(profile.__actions)
      ? profile.__actions
      : Array.isArray(profile.targets)
        ? profile.targets
        : [];
  const check = verifyFullReplacementRequirement(profile.host, inspected);
  const improvements = [];
  if (check?.improvement) improvements.push(check.improvement);
  const effectiveGrade = check?.grade || row.grade;
  if (effectiveGrade === "append-only" && channels && channels.shim === 0) {
    improvements.push("a shim channel can bypass or extend startup invocation where the host reads system prompts from the environment or CLI flags");
  }
  return {
    grade: effectiveGrade,
    mechanism: check?.mechanism || row.mechanism,
    source: check?.source || row.source,
    improvements,
  };
}

export function gradeTable(profiles = []) {
  return profiles.map((profile) => ({ id: profile.id, host: profile.host, support: profile.support, ...gradeOf(profile) }));
}
