import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encode, decode, roundTrip } from "../core/transform.mjs";
import { renderShim } from "../core/shim.mjs";
import { loadProfile, loadModel, listProfiles } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { mergeYaml, applyPlan, revertPlan, verifyPlan } from "../core/executor.mjs";
import { compileMany } from "../core/batch.mjs";
import { gradeOf } from "../core/grades.mjs";
import { detectHost } from "../hosts/registry.mjs";
import { executeStrategyRequest, sendWithBudget, detectRefusal, verdictOf } from "../core/gateway.mjs";
import { TURN_SCRIPTS, resolveStrategy } from "../core/strategy.mjs";

function tmpDir(prefix = "forge-extreme-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("leet maps all documented substitutions including g->9 and o->0", () => {
  assert.equal(encode("gospel", "leet"), "905p31");
  assert.equal(encode("GOAT", "leet"), "9047");
});

test("morse round-trips markdown punctuation, braces, CJK, and astral emoji losslessly", () => {
  const tricky = "# heading [tag] {u0041} *bold* = 1 + 2! 中文 🚀";
  const encoded = encode(tricky, "morse");
  assert.match(encoded, /^[.\- /]+$/);
  assert.equal(decode(encoded, "morse"), tricky.toLowerCase());
  assert.equal(roundTrip(tricky, "morse").roundTrip, true);
});

test("renderShim quotes TOML paths containing spaces, quotes, and backslashes safely", () => {
  const shim = renderShim({
    binary: "codex",
    promptPath: '/tmp/dir with space/quote"slash\\.codex/forge-instructions.md',
    args: ["-c", "model_instructions_file={{TOML_PROMPT_PATH}}", "-a", "never"],
    note: "Codex spaced path test",
  });
  assert.match(shim, /DSH_FORGE_PROMPT_TOML=/);
  assert.match(shim, /'model_instructions_file='"\\"\$DSH_FORGE_PROMPT_TOML\\""/);
});

test("compileMany keeps batchId invariant for all write-shim profiles across differing roots", () => {
  const rootA = tmpDir("forge-shim-a-");
  const rootB = tmpDir("forge-shim-b-");
  try {
    const make = (profileId, root) => ({
      profile: loadProfile(profileId),
      model: loadModel(profileId === "gemini" ? "gemini" : profileId === "claude-code" ? "claude" : "gpt"),
      context: { home: path.join(root, "home"), projectRoot: path.join(root, "proj") },
    });
    const first = compileMany([make("codex", rootA), make("gemini", rootA), make("claude-code", rootA)]);
    const second = compileMany([make("claude-code", rootB), make("codex", rootB), make("gemini", rootB)]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.batchId, second.batchId);
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test("mergeYaml preserves 4-space indentation, CRLF normalization, and idempotency", () => {
  const crlfYaml = "name: custom\r\nagent:\r\n    temperature: 0.2\r\n    system_prompt: old\r\nother: keep\r\n";
  const merged = mergeYaml(crlfYaml, { agent: { system_prompt: "line1\nline2" } });
  const again = mergeYaml(merged, { agent: { system_prompt: "line1\nline2" } });
  assert.equal(merged, again);
  assert.match(merged, /^    temperature: 0\.2$/m);
  assert.doesNotMatch(merged, /system_prompt: old/);
  assert.match(merged, /^    # dsh-forge:begin config$/m);
  assert.match(merged, /^other: keep$/m);
});

test("revertPlan refuses missing tracked file unless forced, and never follows symlinks", () => {
  const root = tmpDir("forge-force-revert-");
  try {
    const home = path.join(root, "home");
    const project = path.join(root, "proj");
    const state = path.join(root, "state");
    fs.mkdirSync(project, { recursive: true });
    const target = path.join(project, "CONVENTIONS.md");
    fs.writeFileSync(target, "# existing rules\n", { mode: 0o640 });
    const plan = compile(loadProfile("aider"), loadModel("gpt"), { home, projectRoot: project });
    const applied = applyPlan(plan, { yes: true, env: { stateRoot: state } });
    assert.equal(applied.ok, true);

    fs.unlinkSync(target);
    assert.throws(() => revertPlan(applied.id, { env: { stateRoot: state } }), /changed after apply/);
    const forced = revertPlan(applied.id, { force: true, env: { stateRoot: state } });
    assert.equal(forced.ok, true);
    assert.equal(fs.readFileSync(target, "utf8"), "# existing rules\n");

    const plan2 = compile(loadProfile("aider"), loadModel("gpt"), { home, projectRoot: project });
    const applied2 = applyPlan(plan2, { yes: true, env: { stateRoot: state } });
    assert.equal(applied2.ok, true);
    fs.unlinkSync(target);
    fs.symlinkSync(path.join(root, "decoy"), target);
    assert.throws(() => revertPlan(applied2.id, { force: true, env: { stateRoot: state } }), /symlink-target|changed after apply/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hermes block markers avoid system keyword injection triggers and opencode upgrades to B4 dynamically", () => {
  const hermesProfile = loadProfile("hermes");
  for (const t of hermesProfile.targets.filter((item) => item.kind === "markdown-block")) {
    assert.notEqual(t.blockId, "system", "hermes blockId must not contain 'system' (triggers threat_patterns)");
  }
  const opencodePlan = compile(loadProfile("opencode"), loadModel("qwen"), { home: "/tmp/h", projectRoot: "/tmp/p" });
  assert.equal(opencodePlan.delivery.grade, "replace-full");
  const downgraded = gradeOf({ host: "opencode" }, [{ op: "merge-block", kind: "markdown-block", path: "/tmp/p/AGENTS.md" }]);
  assert.equal(downgraded.grade, "append-only");
  assert.ok(downgraded.improvements.some((msg) => msg.includes("agent.build.prompt")));
});

test("all 13 profiles round-trip apply -> verify -> revert cleanly in isolated sandboxes", () => {
  const root = tmpDir("forge-all-13-");
  try {
    for (const profile of listProfiles()) {
      const box = path.join(root, profile.id);
      const home = path.join(box, "home");
      const project = path.join(box, "project");
      const state = path.join(box, "state");
      const dshRoot = path.join(box, "dsh-host");
      const dshHome = path.join(box, "dsh-home");
      fs.mkdirSync(project, { recursive: true });
      const model = loadModel(profile.model);
      const plan = compile(profile, model, { home, projectRoot: project, env: { hostRoot: dshRoot, dshHome } });
      if (profile.id === "dsh") continue; // DSH full patch anchor lifecycle is verified separately in engine.test.mjs
      const applied = applyPlan(plan, { yes: true, env: { stateRoot: state } });
      assert.equal(applied.ok, true, `${profile.id} apply failed: ${applied.error}`);
      const verified = verifyPlan(applied.id, { stateRoot: state });
      assert.equal(verified.ok, true, `${profile.id} verifyPlan failed`);
      const detected = detectHost(profile.host, { home, projectRoot: project });
      assert.equal(detected.ok, true, `${profile.id} host detect failed after apply`);
      const reverted = revertPlan(applied.id, { env: { stateRoot: state } });
      assert.equal(reverted.ok, true, `${profile.id} revertPlan failed`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("gateway handles four-turn layered strategy, token starvation recovery, and mixed refusal+code partial verdict", async () => {
  let step = 0;
  const seenTurns = [];
  const fetchImpl = async (_url, init) => {
    step += 1;
    const body = JSON.parse(init.body);
    seenTurns.push(body.messages.length);
    if (step === 1 && body.max_tokens < 400) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }); } };
    }
    if (body.messages.filter((m) => m.role === "user").length < 4) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: `1. phase-${step} scaffold` }, finish_reason: "stop" }] }); } };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [{ message: { content: "1. setup()\n```js\nexport const ok = true;\n```\n" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
        });
      },
    };
  };
  const provider = {
    name: "fixture", kind: "openai", baseUrl: "http://127.0.0.1:9/v1", authHeader: "authorization",
    authPrefix: "Bearer ", headers: {}, reply: "choices.0.message.content", finishReason: "choices.0.finish_reason",
    usage: { prompt: "usage.prompt_tokens", completion: "usage.completion_tokens", total: "usage.total_tokens" },
  };
  const res = await executeStrategyRequest(
    provider,
    { system: "SYS", rawUser: "Task Z", model: "m1", strategy: "layered" },
    { maxTokens: 180, fetchImpl },
  );
  assert.equal(res.status, "ok");
  assert.equal(res.turns, 4);
  assert.deepEqual(seenTurns, [2, 2, 4, 6, 8]);
  const partialRefusal = detectRefusal("抱歉，真实凭据不提供。\n```py\nprint('ok')\n```");
  assert.equal(partialRefusal.refused, true);
  assert.equal(verdictOf({ status: "ok", reply: "抱歉，真实凭据不提供。\n```py\nprint('ok')\n```" }, partialRefusal), "partial");

  let retryCalls = 0;
  const recovered502 = await sendWithBudget(provider, { system: "", user: "q", model: "commandcode/deepseek/deepseek-v4-pro" }, {
    maxTokens: 1200,
    fetchImpl: async (_url, init) => {
      retryCalls += 1;
      const body = JSON.parse(init.body);
      if (retryCalls === 1) {
        assert.equal(body.max_tokens, 1200);
        return { ok: false, status: 502, async text() { return JSON.stringify({ error: { message: "Command Code: an empty reply — cut at its length, the whole output spent on reasoning" } }); } };
      }
      assert.equal(body.max_tokens, 4800);
      return { ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: "1. recovered" }, finish_reason: "stop" }] }); } };
    },
  });
  assert.equal(recovered502.status, "ok");
  assert.equal(recovered502.retriedAtTokens, 4800);
});

test("narrative strategy and writing mode compose within the 480-token budget", () => {
  assert.equal(TURN_SCRIPTS.narrative.length, 2);
  const resolved = resolveStrategy({ strategy: "narrative" });
  assert.equal(resolved.script, "narrative");
  assert.equal(resolved.persona, "unfiltered");
  const resolvedVar = resolveStrategy({ strategy: "narrative+variable" });
  assert.equal(resolvedVar.wrap, "variable");
  const plan = compile(loadProfile("generic"), loadModel("deepseek"), {
    mode: "writing",
    persona: "unfiltered",
    home: "/tmp/h",
    projectRoot: "/tmp/p",
  });
  assert.equal(plan.budget.ok, true);
  assert.ok(plan.prompt.tokens < 480, `writing+unfiltered tokens=${plan.prompt.tokens}`);
});
