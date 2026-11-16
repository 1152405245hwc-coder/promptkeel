import fs from "node:fs";
import path from "node:path";

export const id = "cursor";
export const label = "Cursor";
export const support = "experimental";
export const evidence = {
  documentation: "https://docs.cursor.com/context/rules-for-ai",
  targets: [".cursor/rules/*.mdc", ".cursorrules (legacy)"],
  note: "A discovered rule file proves configuration only; the active Cursor session is not observable here.",
};

function result(candidates) {
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  return {
    ok: existing.length > 0,
    status: existing.length > 0 ? "configured" : "missing",
    candidates,
    evidence: existing.map((file) => ({ kind: "config", path: file })),
    activation: { status: "unobservable", reason: "Cursor session/rule sidebar was not probed" },
    warnings: ["File presence is configuration evidence only; it does not prove an active Cursor session."],
  };
}

export function detect({ projectRoot = process.cwd() } = {}) {
  return result([
    path.join(projectRoot, ".cursor", "rules"),
    path.join(projectRoot, ".cursorrules"),
  ]);
}

export function configTargets() {
  return {
    promptFile: ".cursor/rules/dsh-forge.mdc",
    projectRules: ".cursor/rules/*.mdc",
    legacyProjectRules: ".cursorrules",
    activation: "unobservable until a Cursor Agent session shows the rule as applied",
  };
}
