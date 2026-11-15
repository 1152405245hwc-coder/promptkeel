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
  apply(ctx, { enabled: true, adapter: "deepseek" });
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
