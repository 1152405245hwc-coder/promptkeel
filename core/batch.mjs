import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compile } from "./compile.mjs";
import { verifyCompiled } from "./verify.mjs";
import { previewPlan, applyPlan, revertPlan } from "./executor.mjs";
import { sha256 } from "./prompt.mjs";
import { PATCHES } from "../lib/table.mjs";

const FILE_OPS = new Set(["write-file", "merge-block", "merge-json", "merge-toml"]);
const DSH_PATCH_IDS = new Set(PATCHES.map((patch) => patch.id));
const BATCH_SCHEMA = "forge.batch/v1";
const PREVIEW_SCHEMA = "forge.preview/v1";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorRecord(error) {
  return {
    code: error?.code || "compile-failed",
    error: error?.message || String(error),
    details: error?.details || {},
  };
}

function entryKey(entry) {
  const profile = entry?.profile || {};
  const model = entry?.model || {};
  return `${profile.id || ""}\u0000${model.id || ""}\u0000${entry?.mode || ""}`;
}

function canonicalPath(action, target = {}) {
  const scope = target.scope || action.scope || "project";
  const declared = target.path ?? action.path ?? null;
  // User/project paths are already machine-independent declarations. Absolute
  // paths are represented by a digest so they do not leak into batch IDs.
  const value = scope === "absolute" && declared !== null
    ? `sha256:${sha256(String(declared))}`
    : declared;
  return { scope, path: value };
}

function targetForAction(profile, action, index) {
  const targets = Array.isArray(profile?.targets)
    ? profile.targets
    : Array.isArray(profile?.__batchTargets) ? profile.__batchTargets : [];
  const candidates = targets.filter((target) => target.kind === action.kind);
  const target = candidates.find((candidate) => {
    const scope = candidate.scope || "project";
    if (scope !== (action.scope || "project")) return false;
    if (candidate.path === action.path || candidate.path === action.pathDeclared) return true;
    // compile() resolves project/user paths, while profile metadata retains
    // the declaration. A suffix match recovers that metadata without making
    // absolute paths part of the canonical batch identity.
    return typeof candidate.path === "string" && typeof action.path === "string"
      && action.path.endsWith(`${path.sep}${candidate.path.replace(/^[/\\]+/, "")}`);
  }) || targets[index] || {};
  return target;
}

function actionSignature(action, target = {}) {
  const base = {
    op: action.op || null,
    kind: action.kind || null,
    owner: target.owner || action.owner || "dsh-forge",
    blockId: target.blockId || action.blockId || null,
    provider: action.provider || (action.op === "dsh-patches" ? "dsh.patches" : "core.files"),
  };
  if (action.op === "write-file" || action.op === "merge-block") base.content = action.content ?? null;
  if (action.op === "merge-json" || action.op === "merge-toml") base.value = action.value ?? null;
  if (action.op === "dsh-patches") base.patches = action.patches === "all" ? "all" : [...(action.patches || [])].sort();
  return stableJson(base);
}

function actionTarget(plan, action, index) {
  const target = targetForAction(plan, action, index);
  const loc = canonicalPath(action, target);
  const isPromptOnly = action.op === "prompt-only" || action.kind === "prompt-only";
  const key = isPromptOnly
    ? null
    : `${loc.scope}:${loc.path ?? action.kind ?? action.op}`;
  const owner = target.owner || action.owner || "dsh-forge";
  const blockId = target.blockId || action.blockId || null;
  return {
    key,
    scope: loc.scope,
    path: loc.path,
    kind: action.kind || null,
    op: action.op || null,
    owner,
    blockId,
    provider: action.provider || (action.op === "dsh-patches" ? "dsh.patches" : "core.files"),
    signature: actionSignature(action, target),
    actionIndex: index,
  };
}

function validateAction(action) {
  if (!action || typeof action !== "object") return { code: "action-invalid", message: "plan action must be an object" };
  if (FILE_OPS.has(action.op) || action.op === "prompt-only") return null;
  if (action.op === "dsh-patches") {
    if (action.provider && action.provider !== "dsh.patches") {
      return { code: "provider-unsupported", message: `unsupported provider ${action.provider}` };
    }
    if (action.patches !== "all" && (!Array.isArray(action.patches) || action.patches.some((id) => !DSH_PATCH_IDS.has(id)))) {
      return { code: "provider-unsupported", message: "DSH patch action contains an unknown patch" };
    }
    return null;
  }
  return { code: "provider-unsupported", message: `unsupported plan action ${action.op || "(missing)"}` };
}

function normalisePlans(batch) {
  if (!batch || typeof batch !== "object" || batch.schema !== BATCH_SCHEMA || !Array.isArray(batch.plans)) {
    return { error: { code: "batch-schema", message: `batch must have schema ${BATCH_SCHEMA} and plans[]` } };
  }
  const errors = [];
  for (const plan of batch.plans) {
    if (!plan || plan.schema !== "forge.plan/v1" || !Array.isArray(plan.actions)) {
      errors.push({ code: "plan-schema", message: "batch contains an unsupported plan" });
      continue;
    }
    const verify = verifyCompiled(plan);
    if (!verify.ok) errors.push({ code: "plan-invalid", message: "compiled plan failed verification", details: verify });
    for (const action of plan.actions) {
      const invalid = validateAction(action);
      if (invalid) errors.push(invalid);
    }
  }
  return { plans: batch.plans, errors };
}

function makeTargetEntries(plans, existingTargets = []) {
  const entries = [];
  const serialized = new Map(existingTargets
    .filter((target) => target && target.planId !== undefined && target.actionIndex !== undefined)
    .map((target) => [`${target.planId}\u0000${target.actionIndex}`, target]));
  for (let planOrdinal = 0; planOrdinal < plans.length; planOrdinal += 1) {
    const plan = plans[planOrdinal];
    for (let index = 0; index < plan.actions.length; index += 1) {
      const action = plan.actions[index];
      const target = actionTarget(plan, action, index);
      const persisted = serialized.get(`${plan.planId}\u0000${index}`);
      const canonical = persisted
        ? { ...target, key: persisted.key || target.key, scope: persisted.scope || target.scope, path: persisted.path ?? target.path, kind: persisted.kind || target.kind, op: persisted.op || target.op, owner: persisted.owner || target.owner, blockId: persisted.blockId ?? target.blockId, provider: persisted.provider || target.provider, signature: persisted.signature || target.signature }
        : target;
      if (!canonical.key) continue;
      entries.push({ ...canonical, planId: plan.planId, planOrdinal, plan, action });
    }
  }
  // A caller-provided target list is useful for a serialized batch where
  // profile target metadata is no longer present. It is advisory only.
  if (existingTargets.length && entries.length === 0) {
    for (const target of existingTargets) {
      if (target?.key) entries.push({ ...target, planId: target.planId });
    }
  }
  return entries;
}

function resolveConflicts(entries) {
  const byKey = new Map();
  const conflicts = [];
  for (const entry of entries) {
    const prior = byKey.get(entry.key);
    if (!prior) {
      byKey.set(entry.key, entry);
      continue;
    }
    if (prior.signature !== entry.signature) {
      conflicts.push({
        code: "batch-target-conflict",
        key: entry.key,
        target: { scope: entry.scope, path: entry.path, owner: entry.owner, blockId: entry.blockId },
        first: { planId: prior.planId, op: prior.op, signature: prior.signature },
        second: { planId: entry.planId, op: entry.op, signature: entry.signature },
      });
    }
  }
  return { byKey, conflicts };
}

function sortPlans(plans) {
  return [...plans].sort((a, b) => String(a.planId || "").localeCompare(String(b.planId || "")));
}

function clonePlansForApply(plans, winnerByKey) {
  const ordinalByPlan = new Map(plans.map((plan, index) => [plan, index]));
  return sortPlans(plans).map((plan) => {
    const planOrdinal = ordinalByPlan.get(plan);
    const actions = plan.actions.filter((action, index) => {
      const target = actionTarget(plan, action, index);
      const winner = winnerByKey.get(target.key);
      return !target.key || winner?.plan === plan && winner?.action === action;
    });
    return { ...plan, actions };
  });
}

function readCurrent(file) {
  try {
    const bytes = fs.readFileSync(file);
    return { exists: true, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, sha256: null };
    throw error;
  }
}

function previewFilesFromPlans(plans, env) {
  const files = [];
  const planPreviews = [];
  for (const plan of plans) {
    const result = previewPlan(plan, { env });
    const listed = result.preview?.files || [];
    planPreviews.push({ planId: plan.planId, files: listed });
    for (const item of listed) files.push({ ...item, planId: plan.planId });
  }
  return {
    schema: PREVIEW_SCHEMA,
    batchId: null,
    createdAt: new Date().toISOString(),
    plans: planPreviews,
    files,
  };
}

function checkBatchPreview(batch, plans, preview) {
  if (!preview) return { ok: true, conflicts: [] };
  if (preview.schema !== PREVIEW_SCHEMA) return { ok: false, code: "preview-schema", message: `unsupported preview ${preview.schema || "(missing)"}`, conflicts: [] };
  if (preview.batchId && preview.batchId !== batch.batchId) return { ok: false, code: "preview-batch-mismatch", message: `preview belongs to batch ${preview.batchId}, received ${batch.batchId}`, conflicts: [] };
  const expected = new Map();
  for (const group of preview.plans || []) {
    for (const file of group.files || []) expected.set(`${group.planId}\u0000${file.path}`, file);
  }
  // Also accept the flattened extension used by early callers.
  for (const file of preview.files || []) expected.set(`${file.planId || ""}\u0000${file.path}`, file);
  const conflicts = [];
  const seen = new Set();
  for (const plan of plans) {
    for (const action of plan.actions) {
      if (!FILE_OPS.has(action.op)) continue;
      const key = `${plan.planId}\u0000${action.path}`;
      const item = expected.get(key) || expected.get(`\u0000${action.path}`);
      if (!item) {
        conflicts.push({ path: action.path, planId: plan.planId, reason: "missing-preview" });
        continue;
      }
      seen.add(key);
      const current = readCurrent(action.path);
      if (current.exists !== Boolean(item.existed) || current.sha256 !== (item.beforeSha || null)) {
        conflicts.push({ path: action.path, planId: plan.planId, reason: "modified-after-preview", expected: { exists: Boolean(item.existed), beforeSha: item.beforeSha || null }, current });
      }
    }
  }
  for (const key of expected.keys()) {
    if (!seen.has(key) && key.includes("\u0000")) {
      // Extra entries do not authorize writes and are kept as a visible conflict.
      const [planId, file] = key.split("\u0000");
      if (planId) conflicts.push({ path: file, planId, reason: "unexpected-preview-target" });
    }
  }
  return conflicts.length ? { ok: false, code: "preview-conflict", message: "refusing to overwrite files changed after batch preview", conflicts } : { ok: true, conflicts: [] };
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function acquireLock(root, batchId) {
  const dir = path.join(root, "batches");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${batchId}.lock`);
  let fd;
  try {
    fd = fs.openSync(file, "wx");
    fs.writeFileSync(fd, `${JSON.stringify({ batchId, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    fs.closeSync(fd);
    return file;
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (error.code === "EEXIST") return null;
    throw error;
  }
}

function targetManifest(entries, planResults) {
  const resultByPlan = new Map(planResults.map((result) => [result.planId, result]));
  return [...new Map(entries.map((entry) => [entry.key, entry])).values()].sort((a, b) => a.key.localeCompare(b.key)).map((entry) => {
    const plan = resultByPlan.get(entry.planId);
    const record = plan?.files?.find((file) => file.path === entry.action.path);
    return {
      scope: entry.scope,
      path: entry.action.path,
      kind: entry.kind,
      owner: entry.owner,
      blockId: entry.blockId,
      planId: entry.planId,
      beforeSha: record?.beforeSha || null,
      afterSha: record?.afterSha || null,
    };
  });
}

/** Compile deterministic, conflict-checked plans for several profiles. */
export function compileMany(inputs, options = {}) {
  if (!Array.isArray(inputs)) return { schema: BATCH_SCHEMA, ok: false, code: "batch-input", error: "compileMany expects an array", plans: [], targets: [], conflicts: [] };
  const ordered = inputs.map((entry, index) => ({ entry: entry || {}, index })).sort((a, b) => entryKey(a.entry).localeCompare(entryKey(b.entry)) || a.index - b.index);
  const plans = [];
  const errors = [];
  for (const { entry } of ordered) {
    const required = entry.required !== false;
    try {
      const context = entry.context && typeof entry.context === "object" ? entry.context : {};
      const plan = compile(entry.profile, entry.model, { ...options, ...context, mode: entry.mode ?? context.mode ?? options.mode ?? null });
      // Keep source target metadata available to this in-memory batch without
      // changing the serialized forge.plan/v1 shape.
      Object.defineProperty(plan, "__batchTargets", { value: entry.profile?.targets || [], enumerable: false });
      plans.push(plan);
    } catch (error) {
      const record = { ...errorRecord(error), profile: entry.profile?.id || null, model: entry.model?.id || null, required };
      errors.push(record);
      if (required) {
        return { schema: BATCH_SCHEMA, ok: false, code: record.code, error: record.error, errors, plans, targets: [], conflicts: [] };
      }
    }
  }
  const entries = makeTargetEntries(plans);
  const { byKey, conflicts } = resolveConflicts(entries);
  const canonicalTargets = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)).map((target) => ({
    key: target.key,
    scope: target.scope,
    path: target.path,
    kind: target.kind,
    op: target.op,
    owner: target.owner,
    blockId: target.blockId,
    provider: target.provider,
    planId: target.planId,
    actionIndex: target.actionIndex,
    signature: target.signature,
  }));
  const batchId = sha256(stableJson({
    schema: BATCH_SCHEMA,
    plans: plans.map((plan) => plan.planId).sort(),
    targets: canonicalTargets.map(({ key, scope, path: targetPath, kind, op, owner, blockId, provider, signature }) => ({ key, scope, path: targetPath, kind, op, owner, blockId, provider, signature })),
  })).slice(0, 16);
  if (conflicts.length) {
    return { schema: BATCH_SCHEMA, batchId, ok: false, code: "batch-target-conflict", error: "batch contains conflicting targets", errors, plans, targets: canonicalTargets, conflicts };
  }
  return { schema: BATCH_SCHEMA, batchId, ok: errors.length === 0, errors, plans, targets: canonicalTargets, conflicts };
}

/** Apply a batch through existing per-plan transaction and rollback primitives. */
export function applyBatch(batch, { dryRun = false, yes = false, env = {}, preview = null } = {}) {
  const normalised = normalisePlans(batch);
  if (normalised.error) return { ok: false, ...normalised.error, rollbackErrors: [] };
  if (normalised.errors.length) return { ok: false, code: normalised.errors[0].code, error: normalised.errors[0].message, errors: normalised.errors, rollbackErrors: [] };
  if (batch.ok === false || batch.conflicts?.length) return { ok: false, code: batch.code || "batch-target-conflict", error: batch.error || "batch contains conflicts", conflicts: batch.conflicts || [], rollbackErrors: [] };
  if (!batch.batchId || typeof batch.batchId !== "string") return { ok: false, code: "batch-id", error: "batchId is required", rollbackErrors: [] };
  const entries = makeTargetEntries(batch.plans, batch.targets || []);
  const { byKey, conflicts } = resolveConflicts(entries);
  if (conflicts.length) return { ok: false, code: "batch-target-conflict", error: "batch contains conflicting targets", conflicts, rollbackErrors: [] };
  const plans = clonePlansForApply(batch.plans, byKey);
  const root = path.resolve(env.stateRoot || process.env.DSH_FORGE_STATE || path.join(process.env.HOME || process.env.USERPROFILE || ".", ".dsh-forge"));
  let lock = null;
  if (!dryRun && yes) {
    try { lock = acquireLock(root, batch.batchId); }
    catch (error) { return { ok: false, code: error.code || "batch-lock", error: error.message, rollbackErrors: [] }; }
    if (!lock) return { ok: false, code: "batch-locked", error: `batch ${batch.batchId} is already active`, rollbackErrors: [] };
  }
  const batchDir = path.join(root, "batches", batch.batchId);
  const manifestPath = path.join(batchDir, "manifest.json");
  const manifest = {
    schema: "forge.batch-manifest/v1",
    batchId: batch.batchId,
    status: "preview",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plans: plans.map((plan) => ({ planId: plan.planId, profile: plan.profile?.id || null, host: plan.profile?.host || null })),
    targets: [],
    rollback: { attempted: false, errors: [] },
  };
  try {
    if (dryRun || !yes) {
      const generated = previewFilesFromPlans(plans, env);
      generated.batchId = batch.batchId;
      const checked = checkBatchPreview(batch, plans, preview);
      if (!checked.ok) return { ok: false, planId: null, ...checked, rollbackErrors: [] };
      return { ok: true, dryRun: true, batchId: batch.batchId, plans: plans.map((plan) => ({ planId: plan.planId })), preview: generated, changes: generated.files, conflicts: [] };
    }
    const generated = previewFilesFromPlans(plans, env);
    generated.batchId = batch.batchId;
    const checked = checkBatchPreview(batch, plans, preview);
    if (!checked.ok) return { ok: false, batchId: batch.batchId, ...checked, rollbackErrors: [] };
    manifest.status = "applying";
    manifest.updatedAt = new Date().toISOString();
    writeJsonAtomic(manifestPath, manifest);
    const applied = [];
    for (const plan of plans) {
      const result = applyPlan(plan, { yes: true, env });
      if (!result.ok) {
        const rollbackErrors = [];
        for (const done of [...applied].reverse()) {
          try {
            const reverted = revertPlan(done.id, { env });
            if (!reverted.ok) rollbackErrors.push(reverted);
          } catch (error) { rollbackErrors.push({ code: error.code || "rollback-failed", error: error.message }); }
        }
        manifest.rollback = { attempted: true, errors: rollbackErrors };
        manifest.status = rollbackErrors.length ? "rollback-failed" : "reverted";
        manifest.updatedAt = new Date().toISOString();
        writeJsonAtomic(manifestPath, manifest);
        return { ok: false, code: result.code || "batch-apply-failed", error: result.error || "batch plan failed", details: result.details || {}, batchId: batch.batchId, rollbackErrors };
      }
      applied.push(result);
      manifest.targets = targetManifest(entries, applied);
      manifest.updatedAt = new Date().toISOString();
      writeJsonAtomic(manifestPath, manifest);
    }
    manifest.status = "applied";
    manifest.targets = targetManifest(entries, applied);
    manifest.updatedAt = new Date().toISOString();
    writeJsonAtomic(manifestPath, manifest);
    return { ok: true, dryRun: false, batchId: batch.batchId, id: batch.batchId, dir: batchDir, plans: applied, targets: manifest.targets };
  } finally {
    if (lock) {
      try { fs.unlinkSync(lock); } catch {}
    }
  }
}
