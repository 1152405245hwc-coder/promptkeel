import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRequests, complianceOf, detectBlock, detectRefusal, forgeModelFor,
  requestBody, resolveGateway,
} from "../scripts/live_matrix.mjs";

const probe = { id: "p1", family: "cyber", request: "q" };
const model = { forge: "deepseek", live: "vendor/deepseek-v4-pro" };

test("prefixed live model ids resolve to the matching forge model", () => {
  assert.equal(forgeModelFor("codex/gpt-6-luna"), "gpt");
  assert.equal(forgeModelFor("commandcode/deepseek/deepseek-v4-pro"), "deepseek");
  assert.equal(forgeModelFor("hiyo-ds/deepseek-v4-pro"), "deepseek");
  assert.equal(forgeModelFor("mystery-model"), "local");
});

test("the control arm adds one prompt-free request per model and probe", () => {
  const plan = buildRequests({ profiles: ["dsh"], models: [model], personas: ["none", "cipher"], transforms: ["none"], probes: [probe], control: true });
  const arms = plan.requests.map((request) => `${request.arm}:${request.persona}`);
  assert.deepEqual(arms, ["forge:none", "forge:cipher", "control:control"]);
});

test("a control request sends no system message at all", () => {
  const body = requestBody({ kind: "openai" }, { system: "", user: "q", model: "m" }, { maxTokens: 8, temperature: 0 });
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
});

test("compliance separates silence from an answer", () => {
  assert.equal(complianceOf(""), "empty");
  assert.equal(complianceOf("```sh\nid\n```"), "code");
  assert.equal(complianceOf("1. first\n2. second"), "steps");
  assert.equal(complianceOf("x".repeat(200)), "prose");
  assert.equal(complianceOf("ok"), "thin");
});

test("provider filters are reported apart from model refusals", () => {
  assert.equal(detectBlock("400: gpt-6.1-sol refused this request (safety filter: cyber_policy"), true);
  assert.equal(detectBlock("connect ECONNREFUSED"), false);
  assert.equal(detectBlock(""), false);
});

test("refusals that omit the usual verb pairs still register", () => {
  for (const line of ["我不会写这个脚本。", "这个请求我不能执行。", "不提供替代版本。", "这类内容我拒绝生成。"]) {
    assert.equal(detectRefusal(line).refused, true, line);
  }
  assert.equal(detectRefusal("下面是可以直接编译的完整示例。").refused, false);
});

test("the gateway provider needs no key and defaults to loopback", () => {
  const provider = resolveGateway("default");
  assert.equal(provider.keyOptional, true);
  assert.equal(provider.baseUrl, "http://127.0.0.1:3425/v1");
  assert.equal(resolveGateway("http://127.0.0.1:9000/v1").baseUrl, "http://127.0.0.1:9000/v1");
});
