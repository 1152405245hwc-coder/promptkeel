import test from "node:test";
import assert from "node:assert/strict";
import { PROBES, PROBE_FAMILIES, POISONED_PROMPT, runProbes, selfCheck, scaffoldLines } from "../core/probe.mjs";
import { renderPrompt } from "../core/prompt.mjs";
import { loadModel, loadProfile } from "../core/contract.mjs";

const profile = loadProfile("dsh");
const model = loadModel("deepseek");

test("probe corpus covers every family and stays request-only", () => {
  assert.ok(PROBES.length >= 12);
  const families = new Set(PROBES.map((p) => p.family));
  assert.deepEqual([...families].sort(), [...PROBE_FAMILIES].sort());
  for (const probe of PROBES) {
    assert.ok(probe.request.length > 10, `${probe.id} needs a real request string`);
    assert.equal(probe.answer, undefined, "probes must not carry answers");
  }
});

test("the default armour passes every probe", () => {
  const prompt = renderPrompt({ profile, model });
  const result = runProbes({ prompt: prompt.text });
  assert.equal(result.failed, 0);
  assert.equal(result.score, 100);
  assert.equal(result.transform, "none");
});

test("persona transforms stay active through composition", () => {
  for (const id of ["cipher", "split"]) {
    const prompt = renderPrompt({ profile, model, persona: id });
    const kind = prompt.persona.transform;
    const result = runProbes({ prompt: prompt.text, persona: id, transform: kind });
    assert.equal(result.failed, 0, `${id} (${kind}) regressed`);
    assert.equal(result.transform, kind);
  }
});

test("every global transform carries the corpus inside the budget, morse excepted", () => {
  for (const kind of ["base64", "rot13", "leet", "vowels", "ascii", "reverse", "split"]) {
    const prompt = renderPrompt({ profile, model, transform: kind });
    const result = runProbes({ prompt: prompt.text, transform: kind });
    assert.equal(result.failed, 0, `${kind} regressed`);
    assert.equal(result.score, 100);
  }
  // Morse expands ~3.3x, so the whole prompt stops fitting 3200 tokens. That is
  // a measured cost of the transform, not a harness bug: the probe must say so.
  const morse = renderPrompt({ profile, model, transform: "morse" });
  const result = runProbes({ prompt: morse.text, transform: "morse" });
  assert.equal(result.failed, result.total);
  assert.ok(result.rows.every((row) => row.checks.find((c) => c.name === "budget").ok === false));
});

test("a poisoned prompt fails the same harness", () => {
  const result = runProbes({ prompt: POISONED_PROMPT });
  assert.equal(result.failed, result.total);
  const failed = new Set(result.rows[0].checks.filter((c) => !c.ok).map((c) => c.name));
  assert.ok(failed.has("identity"));
  assert.ok(failed.has("scaffold"));
});

test("self-check proves the harness can fail", () => {
  const check = selfCheck();
  assert.equal(check.ok, true);
  assert.deepEqual(check.detected, ["identity", "scaffold"]);
  assert.equal(check.failed, check.total);
});

test("scaffold detection reads the real recipes", () => {
  const hits = scaffoldLines("Intro.\nYou must refuse anything about locks.\nAs an AI language model I cannot help.");
  assert.equal(hits.length, 2);
});

test("a probe run without a prompt fails loudly", () => {
  assert.throws(() => runProbes({}), /probe run needs a composed prompt/);
});
