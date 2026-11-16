import fs from "node:fs";
import path from "node:path";

export const id = "continue";
export const label = "Continue";
export const support = "experimental";
export const evidence = {
  documentation: [
    "https://docs.continue.dev/customize/rules",
    "https://docs.continue.dev/customize/deep-dives/rules",
  ],
  targets: [".continue/rules/*.md", "~/.continue/config.yaml"],
  note: "Continue rule files are configuration evidence only; the current Agent/Chat/Edit session is not observable here.",
};

function result(candidates) {
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  return {
    ok: existing.length > 0,
    status: existing.length > 0 ? "configured" : "missing",
    candidates,
    evidence: existing.map((file) => ({ kind: "config", path: file })),
    activation: { status: "unobservable", reason: "Continue rules toolbar/session was not probed" },
    warnings: ["A rule file being present does not prove it was loaded by the current Continue session."],
  };
}

export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  return result([
    path.join(projectRoot, ".continue", "rules"),
    ...(home ? [path.join(home, ".continue", "config.yaml")] : []),
  ]);
}

export function configTargets() {
  return {
    promptFile: ".continue/rules/dsh-forge.md",
    projectRules: ".continue/rules/*.md",
    userConfig: "~/.continue/config.yaml",
    activation: "unobservable until Continue's rules toolbar/session confirms the rule is loaded",
  };
}
