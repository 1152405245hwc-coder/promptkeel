import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { forgeDir, profileDir, displayPath, ensureDir, writeFileAtomic } from "./paths.mjs";

export const POLICIES = ["strict", "fallback", "always"];
export const PLUGIN_ID = "dsh-forge-kit";
const LEGACY_PLUGIN_ID = "dsh-forge";
const FILE = (env = {}) => path.join(forgeDir(env), "preset.json");

export function readPolicy(env = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(env), "utf8"));
    return POLICIES.includes(data.workspacePolicy) ? data.workspacePolicy : "fallback";
  } catch {
    return "fallback";
  }
}

export function setPolicy(policy, env = {}) {
  if (!POLICIES.includes(policy)) throw new Error(`unknown workspace policy: ${policy}`);
  ensureDir(forgeDir(env));
  writeFileAtomic(FILE(env), JSON.stringify({ workspacePolicy: policy, updatedAt: new Date().toISOString() }, null, 2));
  return policy;
}

/**
 * strict   — always override the host workspace baseline with Forge
 * fallback — override only when a prompt-inject.md or workspace instruction file exists (default)
 * always   — keep the host workspace baseline alongside Forge
 */
export function shouldStripWorkspace(policy = readPolicy(), { hasUserInject = false, hasWorkspaceInject = false } = {}) {
  if (policy === "strict") return true;
  if (policy === "always") return false;
  return Boolean(hasUserInject || hasWorkspaceInject);
}

export function profileStatus(env = {}) {
  const dir = profileDir(env);
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, exists: false, dir: displayPath(dir), enabled: false, bundles: [], orderOk: true };
  }
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); }
  catch { return { ok: false, exists: true, reason: "invalid-package-json", dir: displayPath(dir), enabled: false, bundles: [], orderOk: true }; }
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
  const forgeIdx = bundles.indexOf(PLUGIN_ID);
  const purgeIdx = bundles.findLastIndex((b) => /dsh-purge/.test(b));
  const orderOk = forgeIdx === -1 || purgeIdx === -1 || forgeIdx > purgeIdx;
  const dep = pkg?.dependencies?.[PLUGIN_ID] || pkg?.dependencies?.[LEGACY_PLUGIN_ID] || null;
  return {
    ok: true,
    exists: true,
    dir: displayPath(dir),
    enabled: forgeIdx !== -1,
    dependency: dep,
    bundles,
    orderOk,
  };
}

export function enableProfile(env = {}) {
  const dir = profileDir(env);
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return { ok: false, reason: "profile-not-found", path: displayPath(pkgPath) };
  const raw = fs.readFileSync(pkgPath, "utf8");
  let pkg;
  try { pkg = JSON.parse(raw); } catch { return { ok: false, reason: "invalid-package-json", path: displayPath(pkgPath) }; }
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? [...pkg.dsh.profile.bundles] : [];
  const filtered = bundles.filter((b) => b !== PLUGIN_ID && b !== LEGACY_PLUGIN_ID);
  filtered.push(PLUGIN_ID);
  pkg.dsh.profile.bundles = filtered;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${pkgPath}.bak-${stamp}-${crypto.randomBytes(2).toString("hex")}`;
  fs.writeFileSync(backup, raw);
  writeFileAtomic(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return { ok: true, enabled: true, path: displayPath(pkgPath), backup: displayPath(backup), bundles: filtered };
}

export function disableProfile(env = {}) {
  const dir = profileDir(env);
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return { ok: false, reason: "profile-not-found", path: displayPath(pkgPath) };
  const raw = fs.readFileSync(pkgPath, "utf8");
  let pkg;
  try { pkg = JSON.parse(raw); } catch { return { ok: false, reason: "invalid-package-json", path: displayPath(pkgPath) }; }
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
  if (!bundles.includes(PLUGIN_ID) && !bundles.includes(LEGACY_PLUGIN_ID)) {
    return { ok: true, enabled: false, path: displayPath(pkgPath), backup: null, bundles };
  }
  pkg.dsh.profile.bundles = bundles.filter((b) => b !== PLUGIN_ID && b !== LEGACY_PLUGIN_ID);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${pkgPath}.bak-${stamp}-${crypto.randomBytes(2).toString("hex")}`;
  fs.writeFileSync(backup, raw);
  writeFileAtomic(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return { ok: true, enabled: false, path: displayPath(pkgPath), backup: displayPath(backup), bundles: pkg.dsh.profile.bundles };
}
