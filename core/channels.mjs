import { fail } from "./errors.mjs";
import { TARGET_KINDS } from "./contract.mjs";

/**
 * Delivery channels. `project` and `install` write host-readable files,
 * `shim` wraps a host binary, `slash` registers a command the host exposes
 * inside a session. `none` is the honest answer for a prompt that is composed
 * but never delivered.
 */
export const CHANNELS = ["project", "install", "shim", "slash", "none"];

/** When a channel's effect becomes visible to the model. */
export const TIMINGS = ["next-turn", "next-session", "host-restart", "shell-restart"];

const FILE_CHANNELS = {
  "dsh-patches": { channel: "install", timing: "host-restart" },
  command: { channel: "slash", timing: "next-session" },
  file: null,
  "markdown-block": { channel: "project", timing: "next-turn" },
  "json-merge": { channel: "project", timing: "next-turn" },
  "toml-merge": { channel: "project", timing: "next-turn" },
  "prompt-only": { channel: "none", timing: "next-turn" },
};

const missing = TARGET_KINDS.filter((kind) => !(kind in FILE_CHANNELS));
if (missing.length) fail("channel-kind", `channel table missing target kinds: ${missing.join(", ")}`);

function projectScoped(pathValue, projectRoot) {
  if (!projectRoot) return true;
  const root = String(projectRoot).replace(/[\\/]+$/, "");
  return !pathValue || String(pathValue).startsWith(root + "/") || String(pathValue).startsWith(root + "\\");
}

/**
 * Classify one compiled action. A `file` target is a project file unless its
 * scope says otherwise, which keeps the classification independent of how the
 * adapter happened to name the path.
 */
export function channelOf(action, { projectRoot } = {}) {
  const kind = action?.kind;
  const known = FILE_CHANNELS[kind];
  if (known === undefined) fail("channel-kind", `unknown action kind: ${kind}`);
  if (known) return { kind, ...known, id: action.targetId ?? null };
  const scope = action.scope || "project";
  if (scope === "user") return { kind, channel: "install", timing: "next-session", id: action.targetId ?? null };
  if (scope === "absolute" && !projectScoped(action.path, projectRoot)) {
    return { kind, channel: "install", timing: "next-session", id: action.targetId ?? null };
  }
  return { kind, channel: "project", timing: "next-turn", id: action.targetId ?? null };
}

export function summarizeChannels(actions = [], options = {}) {
  const rows = actions.map((action) => ({ ...channelOf(action, options), op: action.op, path: action.path ?? null }));
  const counts = CHANNELS.reduce((acc, channel) => ((acc[channel] = 0), acc), {});
  const timings = {};
  for (const row of rows) {
    counts[row.channel] += 1;
    const current = timings[row.channel];
    const rank = (name) => TIMINGS.indexOf(name);
    if (current === undefined || rank(row.timing) > rank(current)) timings[row.channel] = row.timing;
  }
  return {
    counts,
    timings,
    rows,
    channels: CHANNELS.filter((channel) => counts[channel] > 0),
  };
}
