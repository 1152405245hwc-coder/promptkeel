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
  opencode: { grade: "append-only", mechanism: "project instructions add to the built-in prompt", source: "research" },
  aider: { grade: "append-only", mechanism: "CONVENTIONS.md adds to the built-in prompt", source: "research" },
  hermes: {
    grade: "replace-with-residue",
    mechanism: "SOUL.md replaces the persona file; config.yaml still appends its own bootstrap section",
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

export function gradeOf(profile = {}) {
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
  const improvements = [];
  if (row.grade === "append-only" && channels && channels.shim === 0) {
    improvements.push("a shim channel can bypass the fixed prefix where the host reads a system prompt from the environment");
  }
  return { ...row, improvements };
}

export function gradeTable(profiles = []) {
  return profiles.map((profile) => ({ id: profile.id, host: profile.host, support: profile.support, ...gradeOf(profile) }));
}
