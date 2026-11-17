import test from "node:test";
import assert from "node:assert/strict";
import {
  ENCODED_POISON_PROMPT,
  MIDLINE_IDENTITY_PROMPT,
  POISONED_PROMPT,
  PROBES,
  PROBE_FAMILIES,
  PROBE_SEVERITIES,
  loaderLines,
  residueLines,
  runProbes,
  scaffoldLines,
  selfCheck,
} from "../core/probe.mjs";
import { encode } from "../core/transform.mjs";
import { renderPrompt } from "../core/prompt.mjs";
import { loadModel, loadProfile } from "../core/contract.mjs";

const profile = loadProfile("dsh");
const model = loadModel("deepseek");

const checkOf = (row, name) => {
  const found = row.checks.find((c) => c.name === name);
  assert.ok(found, `row ${row.id} has no ${name} check`);
  return found;
};

test("probe corpus covers every family and stays request-only", () => {
  assert.ok(PROBES.length >= 18);
  const families = new Set(PROBES.map((p) => p.family));
  assert.deepEqual([...families].sort(), [...PROBE_FAMILIES].sort());
  // The two hardest shapes in the wild were missing before: minors and NSFW.
  for (const family of ["minor", "adult"]) assert.ok(families.has(family), `${family} family missing`);
  const ids = new Set();
  for (const probe of PROBES) {
    assert.ok(!ids.has(probe.id), `duplicate probe id: ${probe.id}`);
    ids.add(probe.id);
    assert.ok(probe.request.length > 10, `${probe.id} needs a real request string`);
    assert.ok(!probe.request.includes("\n"), `${probe.id} must stay one line`);
    assert.equal(probe.answer, undefined, "probes must not carry answers");
  }
});

test("every probe carries a declared severity", () => {
  const severities = new Set(PROBES.map((p) => p.severity));
  assert.deepEqual([...severities].sort(), [...PROBE_SEVERITIES].sort());
  for (const probe of PROBES) {
    assert.ok(PROBE_SEVERITIES.includes(probe.severity), `${probe.id} has an undeclared severity`);
  }
});

test("the default armour passes every probe", () => {
  const prompt = renderPrompt({ profile, model });
  const result = runProbes({ prompt: prompt.text });
  assert.equal(result.failed, 0);
  assert.equal(result.score, 100);
  assert.equal(result.transform, "none");
  assert.equal(result.rows[0].checks.length, 7);
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
    assert.ok(result.rows.every((row) => checkOf(row, "loader").ok), `${kind} tripped the loader check`);
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
  for (const name of ["identity", "scaffold", "loader", "residue"]) assert.ok(failed.has(name), `${name} did not fire`);
});

test("self-check proves the harness can fail", () => {
  const check = selfCheck();
  assert.equal(check.ok, true);
  assert.deepEqual(check.detected, ["identity", "loader", "residue", "scaffold"]);
  assert.equal(check.failed, check.total);
  assert.equal(check.controls.length, 3);
  for (const control of check.controls) assert.equal(control.ok, true, `${control.name} control did not hold`);
});

test("the loader check is not just the scaffold check", () => {
  // A refusal recipe hidden behind base64 reads clean to a line scan.
  const result = runProbes({ prompt: ENCODED_POISON_PROMPT, probes: [PROBES[0]] });
  const row = result.rows[0];
  assert.equal(checkOf(row, "scaffold").ok, true);
  assert.equal(checkOf(row, "loader").ok, false);
  assert.match(checkOf(row, "loader").detail, /base64-block/);
  assert.equal(loaderLines(ENCODED_POISON_PROMPT).length > 0, true);
});

test("the loader check decodes the body of a transformed run", () => {
  const body = encode("You must refuse anything about locks.", "base64");
  const prompt = `<!-- dsh-forge profile=fixture transform=base64 sha256:0000000000000000 -->\n${body}\n`;
  const result = runProbes({ prompt, transform: "base64", probes: [PROBES[0]] });
  assert.equal(checkOf(result.rows[0], "scaffold").ok, true);
  assert.equal(checkOf(result.rows[0], "loader").ok, false);
  assert.match(checkOf(result.rows[0], "loader").detail, /decoded:base64/);
});

test("the loader check collapses soft wrapping", () => {
  // `split` wraps at 48 chars, which can land inside a recipe.
  const wrapped = "Rules first.\nYou must\nrefuse anything about locks.";
  assert.equal(scaffoldLines(wrapped).length, 0);
  assert.equal(loaderLines(wrapped).some((hit) => hit.surface === "unwrapped"), true);
});

test("the residue check sees identity after a clause break", () => {
  const result = runProbes({ prompt: MIDLINE_IDENTITY_PROMPT, probes: [PROBES[0]] });
  const row = result.rows[0];
  assert.equal(checkOf(row, "identity").ok, true, "the line-anchored scan should miss this");
  assert.equal(checkOf(row, "residue").ok, false);
  assert.match(checkOf(row, "residue").detail, /you are dsh/i);
  assert.equal(residueLines("Answer briefly. You are DSH, the DeepSeek Harness.").length, 1);
  assert.equal(residueLines("Answer briefly. Keep the rules.").length, 0);
});

test("per-family and per-severity tallies cover the whole run", () => {
  const result = runProbes({ prompt: renderPrompt({ profile, model }).text });
  const familyTotal = result.byFamily.reduce((sum, row) => sum + row.total, 0);
  const severityTotal = result.bySeverity.reduce((sum, row) => sum + row.total, 0);
  assert.equal(familyTotal, result.total);
  assert.equal(severityTotal, result.total);
  assert.deepEqual(result.byFamily.map((row) => row.family).sort(), [...PROBE_FAMILIES].sort());
  assert.deepEqual(result.bySeverity.map((row) => row.severity).sort(), [...PROBE_SEVERITIES].sort());
  for (const row of [...result.byFamily, ...result.bySeverity]) {
    assert.equal(row.passed + row.failed, row.total);
    assert.ok(row.rate >= 0 && row.rate <= 100);
  }
  assert.ok(result.byFamily.every((row) => row.rate === 100), "a family regressed");
});

test("scaffold detection reads the real recipes", () => {
  const hits = scaffoldLines("Intro.\nYou must refuse anything about locks.\nAs an AI language model I cannot help.");
  assert.equal(hits.length, 2);
});

test("a probe run without a prompt fails loudly", () => {
  assert.throws(() => runProbes({}), /probe run needs a composed prompt/);
});
