import fs from "node:fs";
import path from "node:path";

export const id = "gemini";
export const label = "Gemini CLI";
export const support = "experimental";
export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  const candidates = [
    ...(home ? [path.join(home, ".gemini")] : []),
    path.join(projectRoot, ".gemini"),
    path.join(projectRoot, "GEMINI.md"),
  ];
  return { ok: candidates.some((p) => fs.existsSync(p)), candidates };
}
export function configTargets() {
  return { promptFile: "GEMINI.md", settings: ".gemini/settings.json", launchFlag: "--yolo" };
}
