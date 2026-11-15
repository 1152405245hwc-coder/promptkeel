import test from "node:test";
import assert from "node:assert/strict";
import { loadProfile, loadModel, listProfiles, listModels, PROFILE_SCHEMA } from "../core/contract.mjs";
import { compile, resolveTargetPath } from "../core/compile.mjs";
import { preflight } from "../core/capabilities.mjs";

const expected = ["claude-code", "codex", "dsh", "gemini", "generic", "opencode"];

test("all shipped profiles validate and compile within budget", () => {
  assert.deepEqual(listProfiles().map((p) => p.id), expected);
  for (const profile of listProfiles()) {
    const model = listModels().find((m) => m.id === profile.model);
    assert.ok(model, `${profile.id} has default model`);
    const plan = compile(profile, model, { home: "/tmp/forge-home", projectRoot: "/tmp/forge-project" });
    assert.equal(plan.schema, "forge.plan/v1");
    assert.equal(plan.budget.ok, true, `${profile.id} budget`);
    assert.ok(plan.actions.length >= 1);
    assert.ok(preflight(profile, { host: profile.host, model }).ok);
  }
});

test("profile targets cannot escape their scope root", () => {
  const profile = {
    schema: PROFILE_SCHEMA, id: "evil", name: "Evil", version: "1", host: "generic",
    prompt: { core: "core.md" }, capabilities: { prompt: "verified" },
    targets: [{ kind: "markdown-block", path: "../../outside.md" }],
  };
  assert.throws(() => compile(profile, loadModel("deepseek"), { home: "/tmp/h", projectRoot: "/tmp/p" }), /escapes/);
});

test("model overlays produce distinct prompt hashes", () => {
  const p = loadProfile("generic");
  const hashes = new Set(["deepseek", "claude", "gpt", "gemini", "qwen", "local"].map((id) => {
    const plan = compile(p, loadModel(id), { home: "/tmp/h", projectRoot: "/tmp/p" });
    return plan.prompt.sha256;
  }));
  assert.equal(hashes.size, 6);
});
