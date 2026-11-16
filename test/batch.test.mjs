import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadModel, loadProfile } from "../core/contract.mjs";
import { compileMany, applyBatch } from "../core/batch.mjs";
import { revertPlan } from "../core/executor.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "forge-batch-"));

function entry(profileId, projectRoot, mode = null) {
  return {
    profile: loadProfile(profileId),
    model: loadModel("gpt"),
    mode,
    context: { home: path.join(projectRoot, "home"), projectRoot },
  };
}

test("compileMany produces a stable batch id across machine paths", () => {
  const a = tmp();
  const b = tmp();
  const first = compileMany([entry("codex", a), entry("cursor", a)]);
  const second = compileMany([entry("cursor", b), entry("codex", b)]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.batchId, second.batchId);
  assert.equal(first.conflicts.length, 0);
});

test("compileMany rejects conflicting writes to the same target", () => {
  const project = tmp();
  const result = compileMany([entry("codex", project), entry("codex", project, "coding")]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "batch-target-conflict");
  assert.ok(result.conflicts.length > 0);
});

test("serialized batch apply is explicit and preserves target actions", () => {
  const root = tmp();
  const project = path.join(root, "project");
  const state = path.join(root, "state");
  fs.mkdirSync(project, { recursive: true });
  const batch = compileMany([entry("codex", project)]);
  const serialized = JSON.parse(JSON.stringify(batch));
  const preview = applyBatch(serialized, { dryRun: true, env: { stateRoot: state } });
  assert.equal(preview.ok, true);
  const blocked = applyBatch(serialized, { yes: true, env: { stateRoot: state }, preview: preview.preview });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "experimental-disabled");
  const applied = applyBatch(serialized, { yes: true, allowExperimental: true, env: { stateRoot: state }, preview: preview.preview });
  assert.equal(applied.ok, true);
  assert.equal(fs.existsSync(path.join(project, "AGENTS.md")), true);
  for (const plan of applied.plans) assert.equal(revertPlan(plan.id, { env: { stateRoot: state } }).ok, true);
});

test("applyBatch refuses a file changed after its batch preview", () => {
  const root = tmp();
  const project = path.join(root, "project");
  const state = path.join(root, "state");
  fs.mkdirSync(project, { recursive: true });
  const target = path.join(project, "AGENTS.md");
  fs.writeFileSync(target, "user text\n");
  const batch = compileMany([entry("codex", project)]);
  const preview = applyBatch(batch, { dryRun: true, env: { stateRoot: state } });
  assert.equal(preview.ok, true);
  fs.appendFileSync(target, "changed\n");
  const applied = applyBatch(batch, { yes: true, allowExperimental: true, env: { stateRoot: state }, preview: preview.preview });
  assert.equal(applied.ok, false);
  assert.equal(applied.code, "preview-conflict");
  assert.match(fs.readFileSync(target, "utf8"), /changed/);
});

test("applyBatch writes a manifest and per-plan rollback restores bytes", () => {
  const root = tmp();
  const project = path.join(root, "project");
  const state = path.join(root, "state");
  fs.mkdirSync(project, { recursive: true });
  const batch = compileMany([entry("codex", project), entry("cursor", project)]);
  const preview = applyBatch(batch, { dryRun: true, env: { stateRoot: state } });
  assert.equal(preview.ok, true);
  const applied = applyBatch(batch, { yes: true, allowExperimental: true, env: { stateRoot: state }, preview: preview.preview });
  assert.equal(applied.ok, true);
  assert.equal(fs.existsSync(path.join(applied.dir, "manifest.json")), true);
  for (const plan of applied.plans) assert.equal(revertPlan(plan.id, { env: { stateRoot: state } }).ok, true);
  assert.equal(fs.existsSync(path.join(project, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(project, ".cursorrules")), false);
});

