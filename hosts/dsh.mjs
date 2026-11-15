import fs from "node:fs";
import path from "node:path";
import { hostRoot, dshHome } from "../lib/paths.mjs";
import { hostStorageState } from "../lib/asar.mjs";

export const id = "dsh";
export const label = "DeepSeek Harness";
export const support = "verified";
export function detect({ home = process.env.HOME || process.env.USERPROFILE, env = {} } = {}) {
  const root = hostRoot(env);
  const storage = hostStorageState(root);
  if (storage.mode !== "missing" || fs.existsSync(path.join(root, "package.json"))) return { ok: true, root, mode: storage.mode };
  if (home && fs.existsSync(path.join(dshHome(env), "profiles"))) return { ok: true, root, note: "profiles only" };
  return { ok: false, root };
}
export function configTargets() {
  return { patchTable: true, promptChannel: "~/.dsh/prompt-inject.md" };
}
