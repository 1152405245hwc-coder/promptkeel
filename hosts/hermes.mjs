import fs from "node:fs";
import path from "node:path";
import { inspectHostSession } from "./evidence.mjs";

export const id = "hermes";
export const label = "Hermes";
export const support = "experimental";

/** SOUL.md is the persona file; config.yaml and the project tier are additive.
 * `HERMES_EPHEMERAL_SYSTEM_PROMPT` only changes one process, so it is not a
 * compile target. */
export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd(), sessionDir } = {}) {
  const candidates = [
    ...(home ? [path.join(home, ".hermes", "SOUL.md"), path.join(home, ".hermes", "config.yaml")] : []),
    path.join(projectRoot, ".hermes.md"),
  ];
  const found = candidates.filter((p) => fs.existsSync(p));
  const session = inspectHostSession("hermes", { home, projectRoot, sessionDir });
  const evidence = [...found.map((file) => ({ kind: "config", path: file })), ...session.evidence];
  const status = session.active ? "active" : found.length > 0 ? "configured" : "missing";
  return { ok: found.length > 0 || session.active, status, candidates, evidence, confidence: "high" };
}

export function configTargets() {
  return {
    promptFile: ".hermes/SOUL.md",
    configYaml: ".hermes/config.yaml",
    yamlKey: "agent.system_prompt",
    projectFile: ".hermes.md",
    env: "HERMES_EPHEMERAL_SYSTEM_PROMPT",
  };
}
