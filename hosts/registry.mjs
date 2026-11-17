import * as dsh from "./dsh.mjs";
import * as claude from "./claude-code.mjs";
import * as codex from "./codex.mjs";
import * as gemini from "./gemini.mjs";
import * as opencode from "./opencode.mjs";
import * as generic from "./generic.mjs";
import * as cursor from "./cursor.mjs";
import * as windsurf from "./windsurf.mjs";
import * as aider from "./aider.mjs";
import * as continuation from "./continue.mjs";
import * as hermes from "./hermes.mjs";
import * as openclaw from "./openclaw.mjs";
import * as muse from "./muse.mjs";
import { detectWithAdapter, normalizeAdapter } from "./adapter.mjs";
import { fail } from "../core/errors.mjs";

export { detectWithAdapter, normalizeAdapter };

export const HOSTS = {
  dsh,
  "claude-code": claude,
  codex,
  gemini,
  opencode,
  generic,
  cursor,
  windsurf,
  aider,
  continue: continuation,
  hermes,
  openclaw,
  muse,
};
export const HOST_IDS = Object.keys(HOSTS);

const ADAPTERS = new Map(Object.entries(HOSTS).map(([id, module]) => [id, normalizeAdapter(module)]));

export function registerAdapter(adapter) {
  const normalized = normalizeAdapter(adapter);
  if (ADAPTERS.has(normalized.id)) fail("adapter-duplicate", `adapter already registered: ${normalized.id}`, { id: normalized.id });
  ADAPTERS.set(normalized.id, normalized);
  return normalized;
}

export function getAdapter(id) {
  if (typeof id !== "string" || !ADAPTERS.has(id)) {
    fail("adapter-unknown", `unknown adapter ${JSON.stringify(id)}`, { id });
  }
  return ADAPTERS.get(id);
}

export function listAdapters() {
  return [...ADAPTERS.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function detectHost(id, context = {}) {
  const adapter = getAdapter(id);
  return { id, ...detectWithAdapter(adapter, context) };
}

export function detectAll(context = {}) {
  const ids = [...HOST_IDS, ...listAdapters().map((adapter) => adapter.id).filter((id) => !HOST_IDS.includes(id))];
  return ids.map((id) => getAdapter(id)).map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    support: adapter.support,
    ...detectWithAdapter(adapter, context),
  }));
}
