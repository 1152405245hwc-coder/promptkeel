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
  const hostDirs = fs.readdirSync(path.join(import.meta.dirname, "..", "profiles")).filter((f) => f.endsWith(".json"));
  assert.equal(profs.profiles.length, hostDirs.length);
  assert.deepEqual(
    profs.profiles.map((profile) => profile.id).sort(),
    hostDirs.map((f) => f.replace(/\.json$/, "")).sort(),
  );
  const modelResult = run(["models", "--json"]);
  assert.doesNotMatch(modelResult.stdout, /\/Users\//);
  const mods = JSON.parse(modelResult.stdout);
  const modelDirs = fs.readdirSync(path.join(import.meta.dirname, "..", "models")).filter((f) => f.endsWith(".json"));
  assert.equal(mods.models.length, modelDirs.length);
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

test("compile propagates an explicit DSH host root to adapter detection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-cli-host-root-"));
  try {
    const result = run(["compile", "dsh", "--host-root", root, "--json"]);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).adapter.detection.root, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI strategies, run --dry-run, and gemini/continue B4 lifecycle succeed", () => {
  const strategiesRes = run(["strategies", "--json"]);
  assert.equal(strategiesRes.status, 0);
  const strategies = JSON.parse(strategiesRes.stdout).strategies;
  assert.ok(strategies.some((s) => s.id === "variable+contract"));

  const runDry = run(["run", "--dry-run", "--gateway", "default", "--strategy", "variable+contract", "--prompt-text", "hello", "--json"]);
  assert.equal(runDry.status, 0, runDry.stderr);
  const runBody = JSON.parse(runDry.stdout);
  assert.equal(runBody.dryRun, true);
  assert.match(runBody.conversation.user, /^UserQuery: variable Z\. Z = \[hello\]/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-cli-gemini-"));
  try {
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const state = path.join(root, "state");
    fs.mkdirSync(project, { recursive: true });
    const applyRes = run(["apply", "--profile", "gemini", "--project", project, "--home", home, "--state", state, "--yes", "--json"]);
    assert.equal(applyRes.status, 0, applyRes.stderr);
    const applied = JSON.parse(applyRes.stdout);
    assert.equal(applied.ok, true);
    assert.equal(fs.existsSync(path.join(project, ".gemini", "system.md")), true);
    assert.equal(fs.existsSync(path.join(project, ".gemini", "dsh-forge-shim.sh")), true);
    const revertRes = run(["revert-plan", applied.id, "--state", state, "--json"]);
    assert.equal(revertRes.status, 0, revertRes.stderr);
    assert.equal(fs.existsSync(path.join(project, ".gemini", "dsh-forge-shim.sh")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI run infers forge model from live model id and compile accepts persona=none", () => {
  const runDry = run(["run", "--dry-run", "--gateway", "default", "--profile", "generic", "--model", "glm-5.3-flash", "--mode", "writing", "--strategy", "narrative", "--prompt-text", "scene", "--json"]);
  assert.equal(runDry.status, 0, runDry.stderr);
  const body = JSON.parse(runDry.stdout);
  assert.equal(body.forgeModel, "glm");
  assert.equal(body.mode, "writing");
  assert.equal(body.strategy.script, "narrative");

  const compileNone = run(["compile", "generic", "--persona", "none", "--json"]);
  assert.equal(compileNone.status, 0, compileNone.stderr);
  assert.equal(JSON.parse(compileNone.stdout).persona, null);
});

test("promptkeel session forwards to promptkeel-session CLI", () => {
  const res = run(["session", "--help"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /promptkeel-session \(compat: dsh-session\) — persistent/);
  assert.match(res.stdout, /promptkeel-session matrix/);
});
