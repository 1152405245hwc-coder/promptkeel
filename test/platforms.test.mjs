import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadModel, loadProfile } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import * as cursor from "../hosts/cursor.mjs";
import * as windsurf from "../hosts/windsurf.mjs";
import * as aider from "../hosts/aider.mjs";
import * as continuation from "../hosts/continue.mjs";

const platforms = [
  { module: cursor, profile: "cursor", fixture: (root) => fs.writeFileSync(path.join(root, ".cursorrules"), "# cursor rules\n") },
  { module: windsurf, profile: "windsurf", fixture: (root) => fs.writeFileSync(path.join(root, ".windsurfrules"), "# windsurf rules\n") },
  { module: aider, profile: "aider", fixture: (root) => fs.writeFileSync(path.join(root, "CONVENTIONS.md"), "# conventions\n") },
  { module: continuation, profile: "continue", fixture: (root) => fs.mkdirSync(path.join(root, ".continue", "rules"), { recursive: true }) },
];

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "forge-platform-"));
}

test("experimental platform adapters expose evidence and keep activation unobservable", () => {
  for (const { module, profile: profileId, fixture } of platforms) {
    const root = tempRoot();
    fixture(root);
    const detected = module.detect({ home: root, projectRoot: root });
    assert.equal(module.support, "experimental", module.id);
    assert.equal(detected.status, "configured", module.id);
    assert.equal(detected.activation.status, "unobservable", module.id);
    assert.notEqual(detected.status, "active", module.id);
    assert.ok(detected.evidence.length > 0, module.id);
    assert.ok(module.evidence.documentation, module.id);
    assert.match(module.evidence.note, /configuration evidence|not active|not observable/i, module.id);
    fs.rmSync(root, { recursive: true, force: true });

    const missing = module.detect({ home: path.join(root, "home"), projectRoot: root });
    assert.equal(missing.status, "missing", module.id);
    assert.equal(missing.activation.status, "unobservable", module.id);
  }
});

test("experimental profiles compile to scoped markdown rule targets only", () => {
  const model = loadModel("gpt");
  for (const { module, profile: profileId } of platforms) {
    const home = tempRoot();
    const projectRoot = tempRoot();
    const profile = loadProfile(profileId);
    assert.equal(profile.host, module.id);
    assert.equal(profile.support, "experimental");
    assert.equal(profile.risk, "medium");
    assert.deepEqual(profile.activationEvidence, ["config", "session"]);
    assert.ok(profile.targets.every((target) => ["markdown-block", "file", "prompt-only"].includes(target.kind)));
    const plan = compile(profile, model, { home, projectRoot });
    assert.equal(plan.adapter.id, module.id);
    assert.equal(plan.adapter.detection.activation.status, "unobservable");
    assert.notEqual(plan.adapter.detection.status, "active");
    assert.ok(plan.actions.every((action) => action.kind === "markdown-block" || action.kind === "file" || action.kind === "prompt-only"));
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
