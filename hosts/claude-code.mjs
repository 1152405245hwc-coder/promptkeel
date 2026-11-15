import fs from "node:fs";
import path from "node:path";

export const id = "claude-code";
export const label = "Claude Code";
export const support = "verified";
export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  const candidates = [
    ...(home ? [path.join(home, ".claude")] : []),
    path.join(projectRoot, ".claude"),
    path.join(projectRoot, "CLAUDE.md"),
  ];
  return { ok: candidates.some((p) => fs.existsSync(p)), candidates };
}
export function configTargets() {
  return { promptFile: "CLAUDE.md", settings: ".claude/settings.json" };
}
