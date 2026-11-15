import { sha256 } from "./prompt.mjs";
import { verifyPlan as verifyPlanManifest } from "./executor.mjs";

/** Verify a compiled plan's internal hashes without touching the host. */
export function verifyCompiled(plan) {
  const rows = [];
  if (!plan?.prompt?.text) rows.push({ ok: false, check: "prompt", reason: "missing prompt text" });
  else rows.push({ ok: sha256(plan.prompt.text) === plan.prompt.sha256, check: "prompt-sha256" });
  if (!plan?.planId) rows.push({ ok: false, check: "plan-id", reason: "missing" });
  if (!Array.isArray(plan?.actions) || plan.actions.length === 0) rows.push({ ok: false, check: "actions", reason: "empty plan" });
  return { ok: rows.every((row) => row.ok), planId: plan?.planId || null, rows };
}

/** Verify an applied plan by reading current target bytes. */
export function verifyApplied(planId, env = {}) {
  return verifyPlanManifest(planId, env);
}
