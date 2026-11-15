import fs from "node:fs";
import path from "node:path";

export const id = "opencode";
export const label = "OpenCode";
export const support = "experimental";
export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  const candidates = [
    ...(home ? [path.join(home, ".config", "opencode")] : []),
    path.join(projectRoot, ".opencode"),
    path.join(projectRoot, "opencode.json"),
  ];
  return { ok: candidates.some((p) => fs.existsSync(p)), candidates };
}
export function configTargets() {
  return { promptFile: "AGENTS.md", settings: "opencode.json" };
}
