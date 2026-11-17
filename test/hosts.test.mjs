import test from "node:test";
import assert from "node:assert/strict";
import { loadProfile, loadModel, listProfiles, listModels, PROFILE_SCHEMA } from "../core/contract.mjs";
import { compile, resolveTargetPath } from "../core/compile.mjs";
import { preflight } from "../core/capabilities.mjs";
import { HOST_IDS, listAdapters } from "../hosts/registry.mjs";

const expected = [...HOST_IDS].sort();
const expectedAdapters = [...HOST_IDS].sort();

test("all shipped profiles validate and compile within budget", () => {
  assert.deepEqual(listProfiles().map((p) => p.id), expected);
  assert.deepEqual(listAdapters().map((adapter) => adapter.id), expectedAdapters);
  for (const profile of listProfiles()) {
    const model = listModels().find((m) => m.id === profile.model);
    assert.ok(model, `${profile.id} has default model`);
    const plan = compile(profile, model, { home: "/tmp/forge-home", projectRoot: "/tmp/forge-project" });
    assert.equal(plan.schema, "forge.plan/v1");
    assert.equal(plan.budget.ok, true, `${profile.id} budget`);
    assert.ok(plan.actions.length >= 1);
    assert.ok(preflight(profile, { host: profile.host, model }).ok);
    assert.ok(["low", "medium", "high"].includes(plan.profile.risk), `${profile.id} risk`);
    assert.equal(typeof plan.profile.mutatesHost, "boolean");
    assert.equal(typeof plan.profile.requiresRestart, "boolean");
    assert.ok(Array.isArray(plan.profile.activationEvidence));
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

test("fixture-backed session evidence detectors distinguish config-only from active sessions", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { detectHost } = await import("../hosts/registry.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-session-"));
  try {
    const claudeDir = path.join(root, ".claude", "projects", "p1");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "<!-- dsh-forge:begin system -->\n");
    assert.equal(detectHost("claude-code", { home: root, projectRoot: root }).status, "configured");
    fs.writeFileSync(
      path.join(claudeDir, "session.jsonl"),
      JSON.stringify({ role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude.\n<!-- dsh-forge -->" }) + "\n",
    );
    const active = detectHost("claude-code", { home: root, projectRoot: root });
    assert.equal(active.status, "active");
    assert.equal(active.identityPrefixPresent, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
