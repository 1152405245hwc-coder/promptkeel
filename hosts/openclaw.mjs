import fs from "node:fs";
import path from "node:path";

export const id = "openclaw";
export const label = "OpenClaw / AutoClaw";
export const support = "experimental";

/** The workspace rule files are plain Markdown, so they take an appended block.
 * The packaged main.cjs can only be replaced by breaking the app signature,
 * which this adapter never does. */
export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  const candidates = [
    ...(home ? [path.join(home, ".openclaw"), path.join(home, ".kimi_openclaw", "workspace", "AGENTS.md")] : []),
    path.join(projectRoot, "AGENTS.md"),
    "/Applications/AutoClaw2.app/Contents/Resources/app/dist/main.cjs",
  ];
  const found = candidates.filter((p) => fs.existsSync(p));
  return {
    ok: found.length > 0,
    status: found.length > 0 ? "configured" : "missing",
    candidates,
    evidence: found.map((file) => ({ kind: "config", path: file })),
    confidence: "high",
  };
}

export function configTargets() {
  return { promptFile: ".kimi_openclaw/workspace/AGENTS.md", projectFile: "AGENTS.md", packaged: "AutoClaw2.app/Contents/Resources/app/dist/main.cjs" };
}
