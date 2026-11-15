import * as dsh from "./dsh.mjs";
import * as claude from "./claude-code.mjs";
import * as codex from "./codex.mjs";
import * as gemini from "./gemini.mjs";
import * as opencode from "./opencode.mjs";
import * as generic from "./generic.mjs";

export const HOSTS = { dsh, "claude-code": claude, codex, gemini, opencode, generic };
export const HOST_IDS = Object.keys(HOSTS);

export function detectHost(id, context = {}) {
  if (!HOSTS[id]) throw new Error(`unknown host ${id}`);
  return { id, ...HOSTS[id].detect(context) };
}

export function detectAll(context = {}) {
  return HOST_IDS.map((id) => ({ id, label: HOSTS[id].label, support: HOSTS[id].support, ...HOSTS[id].detect(context) }));
}
