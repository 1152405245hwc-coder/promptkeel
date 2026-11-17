import fs from "node:fs";
import path from "node:path";

export const id = "hermes";
export const label = "Hermes";
export const support = "experimental";

/** SOUL.md is the persona file; config.yaml and the project tier are additive.
 * `HERMES_EPHEMERAL_SYSTEM_PROMPT` only changes one process, so it is not a
 * compile target. */
export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  const candidates = [
    ...(home ? [path.join(home, ".hermes", "SOUL.md"), path.join(home, ".hermes", "config.yaml")] : []),
    path.join(projectRoot, ".hermes.md"),
  ];
  return { ok: candidates.some((p) => fs.existsSync(p)), candidates, confidence: "high" };
}

export function configTargets() {
  return { promptFile: ".hermes/SOUL.md", projectFile: ".hermes.md", env: "HERMES_EPHEMERAL_SYSTEM_PROMPT" };
}
