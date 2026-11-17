import { fail } from "./errors.mjs";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Render a POSIX shim: a small wrapper that exports the environment a host
 * reads its system prompt from, then hands every argument to the real binary.
 * The output is deterministic so a recompile can be diffed byte for byte.
 */
export function renderShim({ binary, promptPath = null, env = {}, args = [], note = null } = {}) {
  if (!binary || typeof binary !== "string") fail("shim-binary", "a shim needs the host binary it wraps");
  if (/[\n\r]/.test(binary)) fail("shim-binary", "the host binary must be a single line");
  if (promptPath !== null && /[\n\r]/.test(String(promptPath))) fail("shim-prompt", "the prompt path must be a single line");
  const entries = Object.entries(env);
  for (const [key, value] of entries) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) fail("shim-env", `invalid environment name: ${key}`);
    if (/[\n\r]/.test(String(value))) fail("shim-env", `environment ${key} must be a single line`);
  }
  const argList = Array.isArray(args) ? args : [];
  for (const arg of argList) {
    if (typeof arg !== "string" || /[\n\r]/.test(arg)) fail("shim-args", "every shim argument must be a single-line string");
  }
  const lines = [
    "#!/bin/sh",
    `# dsh-forge shim${note ? `: ${String(note).replace(/[\n\r]/g, " ")}` : ""}`,
    "# Generated file. Recompile to refresh it; local edits are overwritten.",
    "set -eu",
  ];
  if (promptPath !== null) {
    lines.push(`DSH_FORGE_PROMPT=${shellQuote(promptPath)}`);
    lines.push('[ -f "$DSH_FORGE_PROMPT" ] || { echo "dsh-forge: missing prompt file $DSH_FORGE_PROMPT" >&2; exit 78; }');
    lines.push('export DSH_FORGE_PROMPT');
  }
  for (const [key, value] of entries) {
    if (promptPath !== null && value === "{{PROMPT_PATH}}") {
      lines.push(`export ${key}="$DSH_FORGE_PROMPT"`);
    } else {
      lines.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  const renderedArgs = argList.map((arg) => (promptPath !== null && arg === "{{PROMPT_PATH}}" ? '"$DSH_FORGE_PROMPT"' : shellQuote(arg)));
  lines.push(`exec ${shellQuote(binary)}${renderedArgs.length ? ` ${renderedArgs.join(" ")}` : ""} "$@"`);
  return `${lines.join("\n")}\n`;
}
