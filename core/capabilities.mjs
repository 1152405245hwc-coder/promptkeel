import { assert } from "./errors.mjs";

/** Capability names are about observable effects, not implementation details. */
export const CAPABILITY_NAMES = [
  "prompt",      // injects a system/developer prompt
  "approval",    // removes interactive approval gates
  "sandbox",     // widens filesystem/command sandbox
  "tools",       // exposes shell/file tools without gating
  "rollback",    // byte-exact apply/revert
];

const RANK = { verified: 3, experimental: 2, unsupported: 1 };

export function capabilityRows(profile) {
  return CAPABILITY_NAMES.map((name) => ({
    name,
    level: profile.capabilities[name] || "unsupported",
  }));
}

export function weakest(profile) {
  return capabilityRows(profile).reduce((min, row) => RANK[row.level] < RANK[min] ? row.level : min, "verified");
}

/** A profile whose every target only prints text mutates nothing, so a
 * byte-exact rollback path cannot exist and is not required. */
export function mutatingTargets(profile) {
  return (profile.targets || []).filter((target) => target.kind !== "prompt-only");
}

export function preflight(profile, { host, model }) {
  const problems = [];
  if (host && host !== profile.host) {
    problems.push({ code: "host-mismatch", message: `profile targets ${profile.host}, selected ${host}` });
  }
  if (model && Array.isArray(model.hosts) && !model.hosts.includes("*") && !model.hosts.includes(profile.host)) {
    problems.push({ code: "model-host-unsupported", message: `model ${model.id} does not list ${profile.host}` });
  }
  if (profile.capabilities.rollback === "unsupported" && mutatingTargets(profile).length > 0) {
    problems.push({ code: "rollback-unsupported", message: "profile has no byte-exact rollback path" });
  }
  return {
    ok: problems.length === 0,
    problems,
    rows: capabilityRows(profile),
    support: profile.support || weakest(profile),
    risk: profile.risk || "medium",
  };
}
