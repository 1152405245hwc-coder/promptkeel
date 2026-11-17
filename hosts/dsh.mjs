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
  const session = inspectHostSession("dsh", { home, dshHome, sessionDir });
  if (unpacked || fs.existsSync(packed)) {
    return {
      ok: true,
      root,
      mode: unpacked ? "unpacked" : "asar",
      ...(session.active ? { status: "active", evidence: session.evidence } : { evidence: session.evidence }),
    };
  }
  if (dshHome && fs.existsSync(path.join(dshHome, "profiles"))) {
    return {
      ok: true,
      root,
      note: "profiles only",
      ...(session.active ? { status: "active", evidence: session.evidence } : { evidence: session.evidence }),
    };
  }
  return { ok: false, root, evidence: session.evidence };
}
export function configTargets() {
  return { patchTable: true, promptChannel: "~/.dsh/prompt-inject.md" };
}
