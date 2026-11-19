import { assert, fail } from "../core/errors.mjs";
import { normalizeActivation } from "../core/evidence.mjs";

/** Stable interface name for host adapters. The first version is intentionally
 * small: existing host modules only need id/label/support/detect. */
export const ADAPTER_SCHEMA = "forge.host/v1";
export const ADAPTER_VERSION = "1.0.0";
export const DETECTION_STATUSES = ["installed", "configured", "active", "missing", "unknown", "unobservable"];
export const DETECTION_CONFIDENCE = ["high", "medium", "low"];

const METHODS = ["detect", "configTargets", "preflight", "compileTarget", "verifyTarget", "rollbackTarget"];

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function evidenceFrom(result) {
  if (Array.isArray(result.evidence)) return result.evidence;
  if (Array.isArray(result.selected)) return result.selected.map((item) => ({ kind: "config", path: item }));
  if (Array.isArray(result.candidates)) return result.candidates.map((item) => ({ kind: "config", path: item }));
  return [];
}

/** Convert a legacy hosts/*.mjs namespace into the versioned adapter shape. */
export function normalizeAdapter(module) {
  assert(module && typeof module === "object" && !Array.isArray(module), "adapter-invalid", "adapter must be an object");
  assert(nonEmpty(module.id), "adapter-invalid", "adapter id is required");
  assert(typeof module.detect === "function", "adapter-invalid", `adapter ${module.id} must implement detect()`);
  for (const name of METHODS.slice(1)) {
    if (module[name] !== undefined) {
      assert(typeof module[name] === "function", "adapter-invalid", `adapter ${module.id}.${name} must be a function`);
    }
  }
  const adapter = {
    ...module,
    schema: module.schema || ADAPTER_SCHEMA,
    adapterVersion: module.adapterVersion || ADAPTER_VERSION,
    label: module.label || module.id,
    support: module.support || "experimental",
  };
  assert(typeof adapter.adapterVersion === "string", "adapter-invalid", `adapter ${module.id} adapterVersion must be a string`);
  return adapter;
}

/** Normalize legacy `{ok, candidates}` results without claiming runtime
 * activation that the old detector cannot observe. */
export function normalizeDetection(result, { id, adapter, context = {} } = {}) {
  const raw = result && typeof result === "object" ? result : {};
  const evidence = evidenceFrom(raw);
  const activation = normalizeActivation({ ...raw, evidence }, { id });
  let status = activation.status;
  if (!DETECTION_STATUSES.includes(status)) status = "unknown";
  const confidence = DETECTION_CONFIDENCE.includes(raw.confidence)
    ? raw.confidence
    : raw.ok === true || raw.ok === false ? "high" : "low";
  const warnings = activation.warnings;
  const targets = raw.targets !== undefined
    ? raw.targets
    : typeof adapter?.configTargets === "function" ? adapter.configTargets(context) : undefined;
  return {
    ...raw,
    id: raw.id || id,
    status,
    ok: raw.ok === undefined ? status !== "missing" : Boolean(raw.ok),
    confidence,
    evidence: activation.evidence,
    warnings,
    activation,
    ...(targets === undefined ? {} : { targets }),
  };
}

export function detectWithAdapter(adapter, context = {}) {
  const normalized = normalizeAdapter(adapter);
  return normalizeDetection(normalized.detect(context), { id: normalized.id, adapter: normalized, context });
}
