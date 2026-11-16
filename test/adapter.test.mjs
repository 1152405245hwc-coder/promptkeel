import test from "node:test";
import assert from "node:assert/strict";
import { loadModel, normalizeProfile, PROFILE_SCHEMA, validateProfile } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { detectHost, getAdapter, listAdapters, normalizeAdapter, registerAdapter } from "../hosts/registry.mjs";
import { normalizeActivation } from "../core/evidence.mjs";

test("legacy host modules normalize to the adapter contract and expose detection evidence", () => {
  const adapter = getAdapter("codex");
  assert.equal(adapter.id, "codex");
  assert.equal(adapter.adapterVersion, "1.0.0");
  assert.equal(typeof adapter.detect, "function");
  const result = detectHost("generic");
  assert.equal(result.id, "generic");
  assert.equal(result.status, "unobservable");
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.evidence));
  assert.ok(Array.isArray(result.warnings));
});

test("activation never becomes active without runtime evidence", () => {
  const downgraded = normalizeActivation({ status: "active", evidence: [] }, { id: "codex" });
  assert.equal(downgraded.status, "configured");
  assert.ok(downgraded.warnings.length > 0);
  assert.equal(normalizeActivation({ ok: true }, { id: "generic" }).status, "unobservable");
  assert.equal(normalizeActivation({ status: "active", evidence: [{ kind: "session", id: "s1" }] }, { id: "codex" }).status, "active");
});

test("registry rejects malformed and duplicate adapters", () => {
  assert.throws(() => normalizeAdapter({ id: "missing-detect" }), (error) => error.code === "adapter-invalid");
  assert.throws(() => registerAdapter({ id: "generic", detect() { return { ok: true }; } }), (error) => error.code === "adapter-duplicate");
  assert.throws(() => getAdapter("does-not-exist"), (error) => error.code === "adapter-unknown");
  assert.ok(listAdapters().some((adapter) => adapter.id === "codex"));
});

test("v1 optional adapter metadata normalizes targets and compiles through adapter hooks", () => {
  const id = "adapter-test";
  registerAdapter({
    id,
    label: "Adapter test",
    detect() { return { status: "unknown", confidence: "low", evidence: [], warnings: ["fixture"] }; },
    preflight(profile, detection) {
      assert.equal(profile.adapter, id);
      assert.equal(detection.status, "unknown");
      return { ok: true, warnings: ["fixture"] };
    },
    compileTarget(target, context) {
      assert.equal(context.path, null);
      return { op: "adapter-action", kind: target.kind, marker: "fixture" };
    },
  });
  const profile = {
    schema: PROFILE_SCHEMA,
    id: "adapter-profile",
    name: "Adapter profile",
    version: "1",
    host: "generic",
    adapter: id,
    platform: { os: ["darwin"], version: { min: null, max: null }, configSchema: null },
    activation: { evidence: ["config"], restart: "optional" },
    prompt: { core: "core.md" },
    capabilities: { prompt: "verified" },
    targets: [{ id: "prompt", kind: "prompt-only", required: false, owner: "fixture", conflict: "abort" }],
  };
  validateProfile(profile);
  const normalized = normalizeProfile(profile);
  assert.equal(normalized.targets[0].id, "prompt");
  assert.equal(normalized.targets[0].required, false);
  const plan = compile(profile, loadModel("deepseek"));
  assert.equal(plan.adapter.id, id);
  assert.equal(plan.adapter.detection.status, "unknown");
  assert.deepEqual(plan.actions, [{ op: "adapter-action", kind: "prompt-only", marker: "fixture", targetId: "prompt", required: false, owner: "fixture", conflict: "abort" }]);
});

