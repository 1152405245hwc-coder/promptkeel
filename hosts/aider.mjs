import fs from "node:fs";
import path from "node:path";

export const id = "aider";
export const label = "Aider";
export const support = "experimental";
export const evidence = {
  documentation: [
    "https://aider.chat/docs/usage/conventions.html",
    "https://aider.chat/docs/config/aider_conf.html",
  ],
  targets: ["CONVENTIONS.md", ".aider.conf.yml (read: CONVENTIONS.md)"],
  note: "Aider must read the conventions file explicitly or through config; a file alone is not active-session evidence.",
};

function result(candidates) {
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  return {
    ok: existing.length > 0,
    status: existing.length > 0 ? "configured" : "missing",
    candidates,
    evidence: existing.map((file) => ({ kind: "config", path: file })),
    activation: { status: "unobservable", reason: "Aider process/read-set was not probed" },
    warnings: ["CONVENTIONS.md is active only after /read, --read, or an .aider.conf.yml read entry; file presence alone is not active."],
  };
}

export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  return result([
    path.join(projectRoot, "CONVENTIONS.md"),
    path.join(projectRoot, ".aider.conf.yml"),
    ...(home ? [path.join(home, ".aider.conf.yml")] : []),
  ]);
}

export function configTargets() {
  return {
    promptFile: "CONVENTIONS.md",
    configFile: ".aider.conf.yml",
    readEntry: "read: CONVENTIONS.md",
    activation: "unobservable until Aider's session confirms the conventions file is in its read set",
  };
}
