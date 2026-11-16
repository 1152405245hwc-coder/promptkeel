import path from "node:path";
import { PATCHES } from "./table.mjs";
import { dryRun, apply as applyPatches, revert as revertPatches, verifyApplied } from "./engine.mjs";
import { restorePackedAsar } from "./asar.mjs";

export const id = "dsh.patches";
export const version = "1.0.0";
export const patches = PATCHES;

function select(actions = []) {
  const wanted = new Set();
  for (const action of actions) {
    if (action.op !== "dsh-patches") continue;
    if (action.patches === "all") for (const patch of PATCHES) wanted.add(patch.id);
    else for (const patchId of action.patches || []) wanted.add(patchId);
  }
  return PATCHES.filter((patch) => wanted.has(patch.id));
}

export function validateTarget(target) {
  if (target.patches === "all") return { ok: true };
  const valid = Array.isArray(target.patches) && target.patches.length > 0 && target.patches.every((id) => PATCHES.some((patch) => patch.id === id));
  return valid ? { ok: true } : { ok: false, code: "target-patches", message: "unknown or empty DSH patch list" };
}

export function preview(actions, env = {}) {
  const selected = select(actions);
  return { ...dryRun(selected, env), patches: selected.map((patch) => patch.id) };
}

export function apply(actions, env = {}) {
  const selected = select(actions);
  return { ...applyPatches(selected, env, { dryRun: false }), patches: selected.map((patch) => patch.id) };
}

export function revert(record, env = {}, force = false) {
  if (!record?.backupDir) return { ok: true, patches: [] };
  const dshEnv = { ...env, hostRoot: env.hostRoot || record.hostRoot || undefined, dshHome: env.dshHome || record.dshHome || undefined };
  const result = revertPatches(dshEnv, path.basename(record.backupDir), path.dirname(record.backupDir), { force });
  if (result.ok && record.unpackedAsar) return restorePackedAsar(record.unpackedAsar, env);
  return result;
}

export function verify(record, env = {}) {
  const selected = PATCHES.filter((patch) => (record?.patches || []).includes(patch.id));
  const dshEnv = { ...env, hostRoot: env.hostRoot || record?.hostRoot || undefined, dshHome: env.dshHome || record?.dshHome || undefined };
  return verifyApplied(selected, dshEnv);
}
