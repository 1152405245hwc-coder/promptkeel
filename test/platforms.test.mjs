import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadModel, loadProfile } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { HOST_TABLE, hostModule } from "../hosts/table.mjs";
const byId = (id) => hostModule(HOST_TABLE.find((d) => d.id === id));
const cursor = byId("cursor");

const platforms = [
  { module: cursor, profile: "cursor", fixture: (root) => fs.writeFileSync(path.join(root, ".cursorrules"), "# cursor rules\n") },
  { module: byId("windsurf"), profile: "windsurf", fixture: (root) => fs.writeFileSync(path.join(root, ".windsurfrules"), "# windsurf rules\n") },
  { module: byId("aider"), profile: "aider", fixture: (root) => fs.writeFileSync(path.join(root, "CONVENTIONS.md"), "# conventions\n") },
  { module: byId("continue"), profile: "continue", fixture: (root) => fs.mkdirSync(path.join(root, ".continue", "rules"), { recursive: true }) },
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

test("experimental markdown-only profiles compile to scoped markdown rule targets", () => {
  const model = loadModel("gpt");
  for (const { module, profile: profileId } of platforms.filter((entry) => entry.profile !== "continue")) {
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

test("continue compiles a B4 yaml-merge targeting chatOptions.baseAgentSystemMessage", () => {
  const home = tempRoot();
  const projectRoot = tempRoot();
  const plan = compile(loadProfile("continue"), loadModel("gpt"), { home, projectRoot });
  const yamlAction = plan.actions.find((a) => a.kind === "yaml-merge");
  assert.ok(yamlAction);
  assert.equal(yamlAction.path, path.join(projectRoot, ".continue", "config.yaml"));
  assert.equal(yamlAction.value.chatOptions.baseAgentSystemMessage, plan.prompt.text);
  assert.equal(plan.delivery.grade, "replace-full");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
});
