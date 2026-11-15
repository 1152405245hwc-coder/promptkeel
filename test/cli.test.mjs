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
  assert.equal(profs.profiles.length, 6);
  const modelResult = run(["models", "--json"]);
  assert.doesNotMatch(modelResult.stdout, /\/Users\//);
  const mods = JSON.parse(modelResult.stdout);
  assert.equal(mods.models.length, 6);
});
