import test from "node:test";
import assert from "node:assert/strict";
import { name, inject, apply } from "../lib/index.js";

test("plugin registers a forge prompt section", () => {
  const sections = [];
  let routes = 0;
  const ctx = {
    systemPrompt: { section: (s) => sections.push(s) },
    inject: (_deps, fn) => fn({
      effect: (cb) => cb(),
      webServer: { register: () => { routes += 1; return () => {}; } },
    }),
  };
  assert.equal(name, "dsh-forge");
  assert.deepEqual(inject, ["systemPrompt"]);
  // Pin the policy so the test is independent of any AGENTS.md in the
  // checkout that happens to run it.
  apply(ctx, { enabled: true, adapter: "deepseek", policy: "always" });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "forge:prompt");
  assert.equal(sections[0].order, 500);
  assert.ok(sections[0].text.includes("dsh-forge"));
  assert.equal(routes, 1);
});

test("disabled plugin registers nothing", () => {
  const ctx = { systemPrompt: { section: () => assert.fail("should not register") } };
  apply(ctx, { enabled: false });
});

test("opt-in cleanSessionHistory strips pure refusal boilerplate while keeping code blocks", () => {
  let listener = null;
  const ctx = {
    systemPrompt: { section: () => {} },
    on: (event, fn) => {
      if (event === "session/deriveMessages") listener = fn;
      return () => {};
    },
  };
  apply(ctx, { enabled: true, cleanSessionHistory: true, policy: "always" });
  assert.ok(typeof listener === "function");
  const cleaned = listener([
    { role: "user", content: "q" },
    { role: "assistant", content: "抱歉，我无法提供这个内容。" },
    { role: "assistant", content: "```js\nconsole.log(1);\n```" },
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[1].content.includes("console.log"), true);
});
