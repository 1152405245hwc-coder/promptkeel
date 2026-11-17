import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPersona, listPersonas, loadPersona, PERSONA_MODES } from "../core/persona.mjs";
import { loadProfile, loadModel } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { renderPrompt } from "../core/prompt.mjs";

const parts = [
  { rel: "core.md", text: "Now: build the thing." },
  { rel: "hosts/dsh.md", text: "You are DeepSeek Harness, a coding agent.\nKeep answers short." },
];

test("persona library ships the documented technique families", () => {
  const rows = listPersonas();
  const ids = rows.map((row) => row.id);
  assert.deepEqual(ids, ["cipher", "code", "direct", "engineer", "fewshot", "nested", "roleplay", "split", "terse", "tutor"]);
  for (const row of rows) {
    assert.ok(PERSONA_MODES.includes(row.mode), `${row.id} declares ${row.mode}`);
    assert.ok(["none", "base64", "rot13", "leet", "vowels", "morse", "ascii", "reverse", "split"].includes(row.transform), `${row.id} declares transform ${row.transform}`);
  }
  assert.deepEqual(rows.filter((row) => row.transform !== "none").map((row) => [row.id, row.transform]), [
    ["cipher", "base64"],
    ["split", "split"],
  ]);
});

test("loadPersona rejects unknown ids and unknown modes", () => {
  assert.throws(() => loadPersona("nope"), /persona not found/);
  assert.throws(() => loadPersona("direct", { mode: "splice" }), /unknown persona mode/);
});

test("mode off and a missing persona leave the prompt untouched", () => {
  assert.deepEqual(applyPersona(parts, null), parts);
  const persona = loadPersona("direct");
  assert.deepEqual(applyPersona(parts, persona, { mode: "off" }), parts);
});

test("mode strict keeps the persona alone", () => {
  const persona = loadPersona("engineer");
  const out = applyPersona(parts, persona, { mode: "strict" });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, persona.body);
});

test("mode append keeps every host part and adds the persona last", () => {
  const persona = loadPersona("tutor");
  const out = applyPersona(parts, persona, { mode: "append" });
  assert.equal(out.length, 3);
  assert.equal(out.at(-1).text, persona.body);
  assert.equal(out[0].rel, "core.md");
});

test("mode replace drops identity claims and keeps working rules", () => {
  const persona = loadPersona("direct");
  const out = applyPersona(parts, persona, { mode: "replace" });
  assert.equal(out[0].text, persona.body);
  const host = out.find((part) => part.rel === "hosts/dsh.md");
  assert.equal(host.text, "Keep answers short.");
});

test("renderPrompt is deterministic with a persona and reports it", () => {
  const profile = loadProfile("codex");
  const model = loadModel("gpt");
  const one = renderPrompt({ profile, model, persona: "engineer", personaMode: "append" });
  const two = renderPrompt({ profile, model, persona: "engineer", personaMode: "append" });
  assert.equal(one.sha256, two.sha256);
  assert.deepEqual(one.persona, { id: "engineer", mode: "append", transform: "none" });
  assert.match(one.text.split("\n")[0], /persona=engineer personaMode=append/);
});

test("persona off reproduces the plain composition byte for byte", () => {
  const profile = loadProfile("codex");
  const model = loadModel("gpt");
  const plain = renderPrompt({ profile, model });
  const off = renderPrompt({ profile, model, persona: "direct", personaMode: "off" });
  assert.equal(plain.sha256, off.sha256);
  assert.equal(off.persona, null);
});

test("compile threads the persona into the plan and its sources", () => {
  const plan = compile(loadProfile("codex"), loadModel("gpt"), { persona: "tutor", personaMode: "strict" });
  assert.deepEqual(plan.persona, { id: "tutor", mode: "strict", transform: "none" });
  assert.deepEqual(plan.prompt.sources, ["personas/tutor.md"]);
  assert.equal(plan.prompt.persona.transform, "none");
  assert.ok(plan.budget.tokens < 3200);
});

test("a persona under a temporary root is isolated from the shipped library", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-personas-"));
  fs.mkdirSync(path.join(root, "personas"), { recursive: true });
  fs.writeFileSync(path.join(root, "personas", "custom.md"), "---\nid: custom\nmode: strict\n---\nAnswer in one sentence.\n");
  const persona = loadPersona("custom", { root });
  assert.equal(persona.mode, "strict");
  assert.deepEqual(applyPersona(parts, persona).map((p) => p.text), ["Answer in one sentence."]);
});
