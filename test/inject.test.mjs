import test from "node:test";
import assert from "node:assert/strict";

const PROMPT_CEILING = 480;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composePrompt, resolvePrompt, estimateTokens, checkBudget, writeInject, verifyProofs, injectionSource } from "../lib/inject.mjs";
import { setPolicy, readPolicy, shouldStripWorkspace, enableProfile, disableProfile, profileStatus } from "../lib/preset.mjs";
import { doctor } from "../lib/doctor.mjs";

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("core prompt composes within the default budget", () => {
  const composed = composePrompt();
  const budget = checkBudget(composed);
  assert.equal(budget.ok, true, `tokens=${composed.tokens}`);
  assert.ok(composed.text.includes("dsh-forge"));
  assert.ok(composed.tokens > 150 && composed.tokens < PROMPT_CEILING, `tokens=${composed.tokens}`);
});

test("estimateTokens counts CJK denser than latin", () => {
  assert.ok(estimateTokens("汉".repeat(100)) > estimateTokens("a".repeat(100)));
});

test("writeInject backs up an existing prompt file", (t) => {
  const dir = tmpDir(t, "forge-inject-");
  const target = path.join(dir, "prompt-inject.md");
  fs.writeFileSync(target, "old");
  const result = writeInject(composePrompt(), { path: target });
  assert.ok(result.backup);
  assert.equal(fs.readFileSync(target, "utf8").startsWith("<!-- dsh-forge"), true);
});

test("preset defaults to fallback and persists a policy", (t) => {
  const dshHome = tmpDir(t, "forge-home-");
  assert.equal(readPolicy({ dshHome }), "fallback");
  assert.equal(setPolicy("strict", { dshHome }), "strict");
  assert.equal(readPolicy({ dshHome }), "strict");
  assert.equal(shouldStripWorkspace("strict", { hasUserInject: false }), true);
  assert.equal(shouldStripWorkspace("always", { hasUserInject: true }), false);
  assert.equal(shouldStripWorkspace("fallback", { hasUserInject: false }), false);
  assert.equal(shouldStripWorkspace("fallback", { hasUserInject: true }), true);
  assert.equal(shouldStripWorkspace("fallback", { hasWorkspaceInject: true }), true);
});

test("verifyProofs does not pass when the plugin is not registered", (t) => {
  const dshHome = tmpDir(t, "forge-ver-");
  const profDir = path.join(dshHome, "profiles", "desktop");
  fs.mkdirSync(profDir, { recursive: true });
  fs.writeFileSync(path.join(profDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: [] } } }));
  const result = verifyProofs({ env: { dshHome } });
  assert.equal(result.proofs.find((p) => p.id === "proof2-prompt").status, "warn");
  assert.equal(result.ok, false);
});

test("writeInject refuses to follow a symlink target", (t) => {
  const dir = tmpDir(t, "forge-link-");
  const real = path.join(dir, "real.md");
  const link = path.join(dir, "prompt-inject.md");
  fs.writeFileSync(real, "keep");
  fs.symlinkSync(real, link);
  assert.throws(() => writeInject(composePrompt(), { path: link }), /symlink/);
  assert.equal(fs.readFileSync(real, "utf8"), "keep");

  const broken = path.join(dir, "broken-inject.md");
  fs.symlinkSync(path.join(dir, "missing.md"), broken);
  assert.throws(() => writeInject(composePrompt(), { path: broken }), /symlink/);
});

test("composePrompt rejects path traversal and unknown adapters or modes", () => {
  assert.throws(() => composePrompt({ adapter: "../core" }), /escapes/);
  assert.throws(() => composePrompt({ adapter: "no-such-adapter" }), /unknown prompt adapter/);
  assert.throws(() => composePrompt({ mode: "no-such-mode" }), /missing/);
  const claudeComposed = composePrompt({ adapter: "claude", mode: "coding" });
  assert.ok(claudeComposed.tokens < PROMPT_CEILING, `tokens=${claudeComposed.tokens}`);
});

test("two writes in the same second get distinct backups", (t) => {
  const dir = tmpDir(t, "forge-bak-");
  const target = path.join(dir, "prompt-inject.md");
  const composed = composePrompt();
  const first = writeInject(composed, { path: target });
  const second = writeInject(composed, { path: target });
  assert.equal(first.backup, null);
  assert.ok(second.backup && second.backup !== first.backup);
  assert.ok(fs.existsSync(second.backup));
});

test("enableProfile registers dsh-forge after dsh-purge-community and disableProfile removes it", (t) => {
  const dshHome = tmpDir(t, "forge-prof-");
  const profDir = path.join(dshHome, "profiles", "desktop");
  fs.mkdirSync(profDir, { recursive: true });
  fs.writeFileSync(path.join(profDir, "package.json"), JSON.stringify({
    name: "desktop",
    dsh: { profile: { bundles: ["dsh-forge", "dsh-purge-community"] } },
  }, null, 2));

  const before = profileStatus({ dshHome });
  assert.equal(before.orderOk, false);

  const enabled = enableProfile({ dshHome });
  assert.equal(enabled.ok, true);
  assert.deepEqual(enabled.bundles, ["dsh-purge-community", "dsh-forge"]);
  assert.equal(profileStatus({ dshHome }).orderOk, true);

  const disabled = disableProfile({ dshHome });
  assert.equal(disabled.ok, true);
  assert.deepEqual(disabled.bundles, ["dsh-purge-community"]);
});

test("resolvePrompt adjusts section order by workspace policy and reads custom forge prompt-inject", (t) => {
  const dshHome = tmpDir(t, "forge-res-");
  setPolicy("always", { dshHome });
  const alwaysRes = resolvePrompt({}, { dshHome });
  assert.equal(alwaysRes.order, 500);
  assert.equal(alwaysRes.hasUserInject, false);

  setPolicy("strict", { dshHome });
  const strictRes = resolvePrompt({}, { dshHome });
  assert.equal(strictRes.order, 1000);

  const customText = "<!-- dsh-forge v0.1.0 sha256:000000000000 -->\ncustom body\n";
  fs.writeFileSync(path.join(dshHome, "prompt-inject.md"), customText);
  const customRes = resolvePrompt({}, { dshHome });
  assert.equal(customRes.hasUserInject, true);
  assert.equal(customRes.text, customText);
});

test("profileStatus reports invalid package.json instead of throwing", (t) => {
  const dshHome = tmpDir(t, "forge-bad-");
  const dir = path.join(dshHome, "profiles", "desktop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), "{bad json");
  const status = profileStatus({ dshHome });
  assert.equal(status.exists, true);
  assert.equal(status.enabled, false);
  assert.equal(status.reason, "invalid-package-json");
});

test("injectionSource only reports a managed AGENTS.md block", (t) => {
  const projectRoot = tmpDir(t, "forge-source-");
  const agents = path.join(projectRoot, "AGENTS.md");
  fs.writeFileSync(agents, "# unrelated project instructions\n");
  assert.equal(injectionSource({ projectRoot }).kind, "builtin");
  fs.writeFileSync(agents, "<!-- dsh-forge:begin system -->\nmanaged\n<!-- dsh-forge:end system -->\n");
  assert.equal(injectionSource({ projectRoot }).kind, "agents-md");
});

test("doctor runs all 12 checks against an isolated environment", (t) => {
  const dshHome = tmpDir(t, "forge-doc-home-");
  const hostRoot = tmpDir(t, "forge-doc-host-");
  const report = doctor({ dshHome, hostRoot });
  assert.equal(report.checks.length, 12);
  assert.equal(report.checks.find((c) => c.id === "host-root")?.status, "fail");
  assert.equal(report.ok, false);
  assert.equal(report.activation.sessionLoaded, false);
  assert.equal(report.activation.requiresRestart, report.activation.configured);
});
