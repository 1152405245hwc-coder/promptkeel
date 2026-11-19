import fs from "node:fs";
import path from "node:path";
import { inspectHostSession } from "./evidence.mjs";

export const id = "dsh";
export const label = "DeepSeek Harness";
export const support = "verified";
export function detect({ home = process.env.HOME || process.env.USERPROFILE, env = {}, sessionDir } = {}) {
  const root = env.hostRoot || process.env.DSH_FORGE_HOST_ROOT || "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh";
  const packed = path.resolve(root, "..", "app.asar");
  const unpacked = fs.existsSync(path.join(root, "package.json")) || fs.existsSync(path.join(root, "node_modules"));
  const dshHome = env.dshHome || process.env.DSH_HOME || (home ? path.join(home, ".dsh") : null);
  const profileName = env.profile || process.env.DSH_FORGE_PROFILE || "desktop";
  const promptFile = dshHome ? path.join(dshHome, "prompt-inject.md") : null;
  const profilePkg = dshHome ? path.join(dshHome, "profiles", profileName, "package.json") : null;
  const configEvidence = [];
  let configured = false;
  if (promptFile && fs.existsSync(promptFile)) {
    try {
      if (fs.readFileSync(promptFile, "utf8").trimStart().startsWith("<!-- dsh-forge ")) {
        configured = true;
        configEvidence.push({ kind: "config", path: promptFile });
      }
    } catch { /* ignore unreadable file */ }
  }
  if (profilePkg && fs.existsSync(profilePkg)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(profilePkg, "utf8"));
      if (Array.isArray(pkg?.dsh?.profile?.bundles) && pkg.dsh.profile.bundles.includes("dsh-forge")) {
        configured = true;
        configEvidence.push({ kind: "config", path: profilePkg });
      }
    } catch { /* ignore invalid profile json */ }
  }
  const session = inspectHostSession("dsh", { home, dshHome, sessionDir });
  const evidence = [...configEvidence, ...session.evidence];
  const status = session.active ? "active" : configured ? "configured" : "installed";
  if (unpacked || fs.existsSync(packed)) {
    return {
      ok: true,
      root,
      mode: unpacked ? "unpacked" : "asar",
      status,
      evidence,
    };
  }
  if (dshHome && fs.existsSync(path.join(dshHome, "profiles"))) {
    return {
      ok: true,
      root,
      note: "profiles only",
      status,
      evidence,
    };
  }
  return { ok: false, root, status: "missing", evidence };
}
export function configTargets() {
  return { patchTable: true, promptChannel: "~/.dsh/prompt-inject.md" };
}
