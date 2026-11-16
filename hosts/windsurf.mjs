import fs from "node:fs";
import path from "node:path";

export const id = "windsurf";
export const label = "Windsurf";
export const support = "experimental";
export const evidence = {
  documentation: "https://docs.windsurf.com/windsurf/cascade/memories",
  targets: [".windsurf/rules/*.md", ".windsurfrules (legacy)", "~/.codeium/windsurf/memories/global_rules.md"],
  note: "Workspace/global rule files are configuration evidence only; active Cascade/Devin Local loading is not observable here.",
};

function result(candidates) {
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  return {
    ok: existing.length > 0,
    status: existing.length > 0 ? "configured" : "missing",
    candidates,
    evidence: existing.map((file) => ({ kind: "config", path: file })),
    activation: { status: "unobservable", reason: "Windsurf session/rules panel was not probed" },
    warnings: ["File presence is configuration evidence only; it does not prove an active Windsurf session."],
  };
}

export function detect({ home = process.env.HOME || process.env.USERPROFILE, projectRoot = process.cwd() } = {}) {
  return result([
    path.join(projectRoot, ".windsurf", "rules"),
    path.join(projectRoot, ".windsurfrules"),
    ...(home ? [path.join(home, ".codeium", "windsurf", "memories", "global_rules.md")] : []),
  ]);
}

export function configTargets() {
  return {
    promptFile: ".windsurf/rules/dsh-forge.md",
    projectRules: ".windsurf/rules/*.md",
    legacyProjectRules: ".windsurfrules",
    globalRules: "~/.codeium/windsurf/memories/global_rules.md",
    activation: "unobservable until a Windsurf/Cascade session reports the rule as applied",
  };
}
