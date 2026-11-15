import fs from "node:fs";
import path from "node:path";

export const id = "codex";
export const label = "Codex CLI";
export const support = "verified";
export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  const candidates = [
    ...(home ? [path.join(home, ".codex")] : []),
    path.join(projectRoot, "AGENTS.md"),
  ];
  return { ok: candidates.some((p) => fs.existsSync(p)), candidates };
}
export function configTargets() {
  return { promptFile: "AGENTS.md", settings: "~/.codex/config.toml" };
}
