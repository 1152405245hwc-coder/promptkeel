import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const bin = path.join(import.meta.dirname, "..", "bin", "dsh-forge.js");

function run(args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    env: { ...process.env, DSH_HOME: env.dshHome || fs.mkdtempSync(path.join(os.tmpdir(), "forge-cli-")) },
  });
}

test("help documents --host-root", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--host-root/);
});

test("invalid preset exits 2 with the allowed values", () => {
  const result = run(["preset", "nonsense", "--json"]);
  assert.equal(result.status, 2);
  const body = JSON.parse(result.stdout);
  assert.deepEqual(body.options, ["strict", "fallback", "always"]);
});

test("json flag preserves non-zero exit codes on failures", () => {
  const compileRes = run(["compile", "generic", "--budget", "1", "--json"]);
  assert.equal(compileRes.status, 1);
  assert.equal(JSON.parse(compileRes.stdout).budget.ok, false);

  const doctorRes = run(["doctor", "--host-root", "/nonexistent-dsh-host", "--json"]);
  assert.equal(doctorRes.status, 1);
  assert.equal(JSON.parse(doctorRes.stdout).ok, false);

  const applyRes = run(["apply", "--dry-run", "--host-root", "/nonexistent-dsh-host", "--json"]);
  assert.equal(applyRes.status, 1);
  assert.equal(JSON.parse(applyRes.stdout).ok, false);

  const promptRes = run(["prompt", "compose", "--budget", "1", "--json"]);
  assert.equal(promptRes.status, 1);
  assert.equal(JSON.parse(promptRes.stdout).ok, false);
});

test("unknown profile returns structured ForgeError JSON instead of stack crash", () => {
  const res = run(["compile", "no-such-profile", "--json"]);
  assert.equal(res.status, 1);
  const body = JSON.parse(res.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.code, "profile-read");
});

test("profiles and models CLI commands return valid catalogs", () => {
  const profResult = run(["profiles", "--json"]);
  assert.doesNotMatch(profResult.stdout, /\/Users\//);
  const profs = JSON.parse(profResult.stdout);
  assert.equal(profs.profiles.length, 10);
  assert.deepEqual(
    profs.profiles.map((profile) => profile.id).sort(),
    ["aider", "claude-code", "codex", "continue", "cursor", "dsh", "gemini", "generic", "opencode", "windsurf"],
  );
  const modelResult = run(["models", "--json"]);
  assert.doesNotMatch(modelResult.stdout, /\/Users\//);
  const mods = JSON.parse(modelResult.stdout);
  assert.equal(mods.models.length, 6);
});

test("profile apply preview rejects a changed target", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-cli-preview-"));
  try {
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const state = path.join(root, "state");
    const preview = path.join(root, "preview.json");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "AGENTS.md"), "user text\n");
    const args = ["apply", "--profile", "codex", "--project", project, "--home", home, "--state", state, "--preview", preview, "--json"];
    const dry = run([...args, "--dry-run"]);
    assert.equal(dry.status, 0);
    assert.equal(fs.existsSync(preview), true);
    fs.appendFileSync(path.join(project, "AGENTS.md"), "changed\n");
    const applied = run([...args, "--yes"]);
    assert.equal(applied.status, 1);
    assert.equal(JSON.parse(applied.stdout).code, "preview-conflict");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("profile plan lifecycle uses the explicit state directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-cli-state-"));
  try {
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const state = path.join(root, "state");
    fs.mkdirSync(project, { recursive: true });
    const args = ["apply", "--profile", "codex", "--project", project, "--home", home, "--state", state, "--json"];

    const applied = run([...args, "--yes"]);
    assert.equal(applied.status, 0, applied.stderr);
    const appliedBody = JSON.parse(applied.stdout);
    assert.equal(appliedBody.ok, true);
    assert.ok(appliedBody.id);
    assert.equal(fs.existsSync(path.join(state, "plans", appliedBody.id, "manifest.json")), true);

    const plans = run(["plans", "--state", state, "--json"]);
    assert.equal(plans.status, 0, plans.stderr);
    assert.equal(JSON.parse(plans.stdout).plans.some((plan) => plan.id === appliedBody.id), true);

    const verified = run(["verify-plan", appliedBody.id, "--state", state, "--json"]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const reverted = run(["revert-plan", appliedBody.id, "--state", state, "--json"]);
    assert.equal(reverted.status, 0, reverted.stderr);
    assert.equal(JSON.parse(reverted.stdout).ok, true);
    assert.equal(JSON.parse(run(["plans", "--state", state, "--json"]).stdout).plans.find((plan) => plan.id === appliedBody.id).status, "reverted");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
