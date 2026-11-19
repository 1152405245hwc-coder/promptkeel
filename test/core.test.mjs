import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProfile, loadModel, validateProfile, PROFILE_SCHEMA } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { applyPlan, previewPlan, checkPreview, revertPlan, verifyPlan, verifyCompiled, mergeBlock, mergeJson, mergeToml, mergeYaml, defaultStateRoot } from "../core/executor.mjs";
import { renderPrompt } from "../core/prompt.mjs";
import { PATCHES } from "../lib/table.mjs";
import { normalizeFiles, replacementsOf } from "../lib/engine.mjs";
import { registerProvider } from "../core/provider.mjs";
import * as dshProvider from "../lib/dsh-provider.mjs";

registerProvider(dshProvider);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "forge-core-"));

test("profile validation rejects duplicate targets", () => {
  const profile = {
    schema: PROFILE_SCHEMA, id: "x", name: "X", version: "1", host: "generic",
    prompt: { core: "core.md" }, capabilities: { prompt: "verified" },
    targets: [{ kind: "markdown-block", path: "AGENTS.md" }, { kind: "markdown-block", path: "AGENTS.md" }],
  };
  assert.throws(() => validateProfile(profile), /duplicates/);
});

test("profile validation rejects unknown risk and activation evidence", () => {
  const base = {
    schema: PROFILE_SCHEMA, id: "risk-test", name: "Risk test", version: "1", host: "generic",
    prompt: { core: "core.md" }, capabilities: { prompt: "verified" },
    targets: [{ kind: "prompt-only" }],
  };
  assert.throws(() => validateProfile({ ...base, risk: "critical" }), /bad risk level/);
  assert.throws(() => validateProfile({ ...base, activationEvidence: ["unknown"] }), /unknown activation evidence/);
});

test("prompt render is deterministic and changes with model", () => {
  const p = loadProfile("claude-code");
  const a = loadModel("claude");
  const b = loadModel("gpt");
  const root = path.join(import.meta.dirname, "..", "prompt");
  const one = renderPrompt({ profile: p, model: a, root });
  const two = renderPrompt({ profile: p, model: a, root });
  assert.equal(one.sha256, two.sha256);
  assert.notEqual(one.sha256, renderPrompt({ profile: p, model: b, root }).sha256);
  assert.match(one.text, /dsh-forge profile=claude-code/);
});

test("compile resolves project and user targets without writing", () => {
  const home = tmp(); const project = tmp();
  const plan = compile(loadProfile("codex"), loadModel("gpt"), { home, projectRoot: project });
  assert.equal(plan.actions.find((a) => a.kind === "markdown-block").path, path.join(project, "AGENTS.md"));
  assert.equal(plan.actions.find((a) => a.kind === "file").path, path.join(project, ".codex", "forge-instructions.md"));
  const tomlAction = plan.actions.find((a) => a.kind === "toml-merge");
  assert.equal(tomlAction.path, path.join(project, ".codex", "config.toml"));
  assert.equal(tomlAction.value.model_instructions_file, "forge-instructions.md");
  assert.equal(plan.delivery.grade, "replace-full");
  assert.equal(fs.existsSync(path.join(project, "AGENTS.md")), false);
});

test("mergeYaml preserves unrelated keys and nested mappings idempotently", () => {
  const initial = "name: Local Agent\nchatOptions:\n  temperature: 0.2\n";
  const first = mergeYaml(initial, { chatOptions: { baseAgentSystemMessage: "line1\nline2" } });
  const second = mergeYaml(first, { chatOptions: { baseAgentSystemMessage: "line1\nline2" } });
  assert.equal(first, second);
  assert.match(first, /name: Local Agent/);
  assert.match(first, /temperature: 0\.2/);
  assert.match(first, /baseAgentSystemMessage: \|-/);
  assert.equal(first.split(/^chatOptions:/m).length - 1, 1);
  const inlineEmpty = mergeYaml("chatOptions: {}\n", { chatOptions: { baseAgentSystemMessage: "ok" } });
  assert.equal(inlineEmpty.split(/^chatOptions:/m).length - 1, 1);
  assert.doesNotMatch(inlineEmpty, /chatOptions: \{\}/);
  assert.throws(() => mergeYaml("# dsh-forge:begin config\n", { a: 1 }), /dsh-forge YAML block/);
});

test("write-shim creates executable 0755 shims for gemini and claude-code", () => {
  const home = tmp(); const project = tmp(); const state = tmp();
  const plan = compile(loadProfile("gemini"), loadModel("gemini"), { home, projectRoot: project });
  assert.equal(plan.delivery.grade, "replace-full");
  const applied = applyPlan(plan, { yes: true, env: { stateRoot: state } });
  assert.equal(applied.ok, true);
  const shimPath = path.join(project, ".gemini", "dsh-forge-shim.sh");
  const stat = fs.statSync(shimPath);
  assert.equal((stat.mode & 0o111) !== 0, true);
  assert.match(fs.readFileSync(shimPath, "utf8"), /DSH_FORGE_PROMPT='[^']*\.gemini\/system\.md'/);
  assert.match(fs.readFileSync(shimPath, "utf8"), /export GEMINI_SYSTEM_MD="\$DSH_FORGE_PROMPT"/);
  const reverted = revertPlan(applied.id, { env: { stateRoot: state } });
  assert.equal(reverted.ok, true);
  assert.equal(fs.existsSync(shimPath), false);
});

test("mergeBlock preserves user text and is idempotent", () => {
  const first = mergeBlock("user intro\n", "system", "hello");
  const second = mergeBlock(first, "system", "hello");
  assert.equal(first, second);
  assert.match(first, /user intro/);
  assert.match(first, /hello/);
});

test("mergeJson and mergeToml preserve unrelated keys", () => {
  const json = mergeJson('{"keep":true}', { permissions: { defaultMode: "bypassPermissions" } });
  assert.deepEqual(JSON.parse(json), { keep: true, permissions: { defaultMode: "bypassPermissions" } });
  const toml = mergeToml('model = "x"\napproval_policy = "on-request"\n', { approval_policy: "never", sandbox_mode: "danger-full-access" });
  assert.match(toml, /model = "x"/);
  assert.match(toml, /approval_policy = "never"/);
  assert.match(toml, /sandbox_mode = "danger-full-access"/);
});

test("apply and revert are byte-exact for existing files", () => {
  const home = tmp(); const project = tmp(); const state = tmp();
  const before = "user content\n";
  fs.writeFileSync(path.join(project, "CLAUDE.md"), before);
  const plan = compile(loadProfile("claude-code"), loadModel("claude"), { home, projectRoot: project });
  const applied = applyPlan(plan, { yes: true, env: { stateRoot: state } });
  assert.equal(applied.ok, true);
  assert.notEqual(fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8"), before);
  assert.equal(verifyPlan(applied.id, { stateRoot: state }).ok, true);
  const reverted = revertPlan(applied.id, { env: { stateRoot: state } });
  assert.equal(reverted.ok, true);
  assert.equal(fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(project, ".claude/settings.json")), false);
});

test("revert refuses to overwrite a file edited after apply", () => {
  const home = tmp(); const project = tmp(); const state = tmp();
  const plan = compile(loadProfile("claude-code"), loadModel("claude"), { home, projectRoot: project });
  const applied = applyPlan(plan, { yes: true, env: { stateRoot: state } });
  fs.appendFileSync(path.join(project, "CLAUDE.md"), "\nuser edit\n");
  assert.throws(() => revertPlan(applied.id, { env: { stateRoot: state } }), /changed after apply/);
  const forced = revertPlan(applied.id, { env: { stateRoot: state }, force: true });
  assert.equal(forced.ok, true);
});

test("file target writes the rendered prompt and reverts byte-exactly", () => {
  const profile = {
    schema: PROFILE_SCHEMA, id: "file-test", name: "File test", version: "1", host: "generic",
    prompt: { core: "core.md" }, capabilities: { prompt: "verified", rollback: "verified" },
    targets: [{ kind: "file", path: "prompt-inject.md", scope: "user" }],
  };
  const home = tmp(); const project = tmp(); const state = tmp();
  const plan = compile(profile, loadModel("deepseek"), { home, projectRoot: project });
  const result = applyPlan(plan, { yes: true, env: { stateRoot: state } });
  assert.equal(result.ok, true);
  assert.match(fs.readFileSync(path.join(home, "prompt-inject.md"), "utf8"), /dsh-forge profile=file-test/);
  assert.equal(revertPlan(result.id, { env: { stateRoot: state } }).ok, true);
  assert.equal(fs.existsSync(path.join(home, "prompt-inject.md")), false);
});

test("mergeBlock rejects malformed or duplicate managed blocks", () => {
  assert.throws(() => mergeBlock("<!-- dsh-forge:begin x -->\nno end\n", "x", "body"), /malformed/);
  const twice = mergeBlock(mergeBlock("", "x", "one"), "x", "two");
  assert.match(twice, /two/);
});

test("planId is independent of the machine's home and project paths", () => {
  const profile = loadProfile("codex"); const model = loadModel("gpt");
  const a = compile(profile, model, { home: "/tmp/forge-alice", projectRoot: "/tmp/forge-alice/app" });
  const b = compile(profile, model, { home: "/tmp/forge-bob", projectRoot: "/tmp/forge-bob/app" });
  assert.equal(a.planId, b.planId);
  assert.notDeepEqual(a.actions.map((x) => x.path), b.actions.map((x) => x.path));
});

test("applyPlan refuses a plan whose prompt exceeds the token budget", () => {
  const home = tmp(); const project = tmp();
  const plan = compile(loadProfile("generic"), loadModel("deepseek"), { home, projectRoot: project, budget: 1 });
  assert.equal(plan.budget.ok, false);
  const result = applyPlan(plan, { dryRun: true, yes: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "budget-exceeded");
});

test("applyPlan rejects files changed after a persisted dry-run preview", () => {
  const home = tmp(); const project = tmp(); const state = tmp();
  const target = path.join(project, "CLAUDE.md");
  fs.writeFileSync(target, "user content\n");
  const plan = compile(loadProfile("claude-code"), loadModel("claude"), { home, projectRoot: project });
  const preview = previewPlan(plan, { env: { stateRoot: state } });
  assert.equal(preview.ok, true);
  fs.appendFileSync(target, "user edit\n");
  const check = checkPreview(plan, preview.preview);
  assert.equal(check.ok, false);
  assert.equal(check.code, "preview-conflict");
  const result = applyPlan(plan, { yes: true, env: { stateRoot: state }, preview: preview.preview });
  assert.equal(result.ok, false);
  assert.equal(result.code, "preview-conflict");
  assert.match(fs.readFileSync(target, "utf8"), /user edit/);
});

test("applyPlan accepts an unchanged preview and records the plan", () => {
  const home = tmp(); const project = tmp(); const state = tmp();
  const plan = compile(loadProfile("codex"), loadModel("gpt"), { home, projectRoot: project });
  const preview = previewPlan(plan);
  assert.equal(checkPreview(plan, preview.preview).ok, true);
  const result = applyPlan(plan, { yes: true, env: { stateRoot: state }, preview: preview.preview });
  assert.equal(result.ok, true);
  assert.equal(result.planId, plan.planId);
  assert.equal(revertPlan(result.id, { env: { stateRoot: state } }).ok, true);
});

test("mergeToml inserts top-level keys before [table] sections and stays idempotent", () => {
  const initial = 'model = "o3"\n\n[mcp_servers.git]\ncommand = "uvx"\napproval_policy = "keep-in-table"\n';
  const once = mergeToml(initial, { approval_policy: "never", sandbox_mode: "danger-full-access" });
  const tableIdx = once.indexOf("[mcp_servers.git]");
  const policyIdx = once.indexOf('approval_policy = "never"');
  assert.ok(policyIdx !== -1 && policyIdx < tableIdx, "top-level key must precede [table]");
  assert.match(once.slice(tableIdx), /approval_policy = "keep-in-table"/);
  const twice = mergeToml(once, { approval_policy: "never", sandbox_mode: "danger-full-access", extra_flag: true });
  assert.equal(twice.split("# dsh-forge:begin config").length - 1, 1, "only one managed config block");
  assert.ok(twice.indexOf("extra_flag = true") < twice.indexOf("[mcp_servers.git]"));
  assert.equal(mergeToml(twice, { approval_policy: "never", sandbox_mode: "danger-full-access", extra_flag: true }), twice);
});

test("mergeToml rejects malformed managed blocks and unsafe keys", () => {
  assert.throws(() => mergeToml("# dsh-forge:begin config\n", { approval_policy: "never" }), /dsh-forge TOML block/);
  assert.throws(() => mergeToml("", { "bad\nkey": true }), /unsupported TOML bare key/);
});

test("profile validation rejects unknown or empty DSH patch lists", () => {
  const base = {
    schema: PROFILE_SCHEMA,
    id: "patch-test",
    name: "Patch test",
    version: "1",
    host: "dsh",
    prompt: { core: "core.md" },
    capabilities: { prompt: "verified" },
  };
  assert.throws(() => validateProfile({ ...base, targets: [{ kind: "dsh-patches", patches: [] }] }), /known patch IDs/);
  assert.throws(() => validateProfile({ ...base, targets: [{ kind: "dsh-patches", patches: ["missing-patch"] }] }), /known patch IDs/);
});

test("applyPlan rejects a dangling symlink target during preflight", () => {
  const home = tmp(); const project = tmp(); const state = tmp();
  fs.symlinkSync(path.join(project, "nonexistent-target.md"), path.join(project, "CLAUDE.md"));
  const plan = compile(loadProfile("claude-code"), loadModel("claude"), { home, projectRoot: project });
  assert.throws(() => applyPlan(plan, { dryRun: true }), /symlink/);
});

test("revertPlan refuses a target replaced by a symlink", () => {
  const home = tmp(); const project = tmp(); const state = tmp();
  const plan = compile({
    schema: PROFILE_SCHEMA,
    id: "file-test",
    name: "File test",
    version: "1",
    host: "generic",
    prompt: { core: "core.md" },
    capabilities: { prompt: "verified", rollback: "verified" },
    targets: [{ kind: "file", path: "managed.md", scope: "project" }],
  }, loadModel("deepseek"), { home, projectRoot: project });
  const applied = applyPlan(plan, { yes: true, env: { stateRoot: state } });
  const target = path.join(project, "managed.md");
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(project, "other.md"), target);
  assert.throws(() => revertPlan(applied.id, { env: { stateRoot: state } }), /refusing to overwrite files changed/);
  assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
});

test("dsh profile applyPlan, verifyPlan, and revertPlan track patch state accurately", () => {
  const home = tmp(); const project = tmp(); const state = tmp(); const hostRoot = tmp();
  const dshHome = path.join(home, ".dsh");
  fs.mkdirSync(path.join(hostRoot, "node_modules", "@deepseek-ai"), { recursive: true });
  fs.writeFileSync(path.join(hostRoot, "package.json"), JSON.stringify({ version: "0.2.2-rc.3" }));
  for (const patch of PATCHES) {
    for (const rel of normalizeFiles(patch)) {
      const abs = path.join(hostRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.appendFileSync(abs, replacementsOf(patch).map((r) => r.find).join("\n") + "\n");
    }
  }
  const plan = compile(loadProfile("dsh"), loadModel("deepseek"), { home, projectRoot: project });
  assert.equal(verifyCompiled(plan).ok, true);
  const applied = applyPlan(plan, { yes: true, env: { stateRoot: state, hostRoot, dshHome } });
  assert.equal(applied.ok, true);

  const verified = verifyPlan(applied.id, { stateRoot: state });
  assert.equal(verified.ok, true);
  const dshRow = verified.rows.find((r) => r.dsh);
  assert.ok(dshRow && Array.isArray(dshRow.patches) && dshRow.patches.length === PATCHES.length);

  const reverted = revertPlan(applied.id, { env: { stateRoot: state } });
  assert.equal(reverted.ok, true);
  assert.equal(verifyPlan(applied.id, { stateRoot: state }).ok, false);
});

test("defaultStateRoot uses .dsh-forge-kit under home", () => {
  const home = tmp();
  assert.equal(defaultStateRoot({ home }), path.join(home, ".dsh-forge-kit"));
});
