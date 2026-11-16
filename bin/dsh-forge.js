#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { doctor } from "../lib/doctor.mjs";
import { dryRun, apply as applyPatches, revert, upgrade, listBackups, explain, replacementsOf, inspectPatch } from "../lib/engine.mjs";
import { unpackHostAsar } from "../lib/asar.mjs";
import { PATCHES } from "../lib/table.mjs";
import { composePrompt, checkBudget, writeInject, verifyProofs } from "../lib/inject.mjs";
import { readPolicy, setPolicy, POLICIES, profileStatus, enableProfile, disableProfile } from "../lib/preset.mjs";
import { reportsDir, ensureDir, dshHome, promptInjectPath, displayPath, redactText, VERSION } from "../lib/paths.mjs";
import { readLog, clearLogs, defaultLogFile } from "../lib/log.mjs";
import { loadProfile, loadModel, listProfiles, listModels } from "../core/contract.mjs";
import { ForgeError } from "../core/errors.mjs";
import { compile } from "../core/compile.mjs";
import { applyPlan, revertPlan, listPlans, verifyPlan } from "../core/executor.mjs";
import { detectAll } from "../hosts/registry.mjs";
import { registerProvider } from "../core/provider.mjs";
import * as dshProvider from "../lib/dsh-provider.mjs";
import { normalizeContext } from "../core/context.mjs";
import { listPersonas } from "../core/persona.mjs";
import { renderShim } from "../core/shim.mjs";
import { gradeTable } from "../core/grades.mjs";
import { acquireLock, createConsole, renderOverview, CONSOLE_HOST, CONSOLE_PORT } from "../core/console.mjs";
import { consoleState } from "../lib/console-state.mjs";

registerProvider(dshProvider);

const { values: opts, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    json: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean" },
    force: { type: "boolean" },
    clear: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    id: { type: "string" },
    adapter: { type: "string" },
    mode: { type: "string" },
    persona: { type: "string" },
    binary: { type: "string" },
    prompt: { type: "string" },
    env: { type: "string", multiple: true },
    port: { type: "string" },
    once: { type: "boolean" },
    "persona-mode": { type: "string" },
    out: { type: "string" },
    budget: { type: "string" },
    profile: { type: "string" },
    "host-root": { type: "string" },
    limit: { type: "string" },
    "forge-profile": { type: "string" },
    plan: { type: "string" },
    model: { type: "string" },
    project: { type: "string" },
    home: { type: "string" },
    state: { type: "string" },
    preview: { type: "string" },
  },
});

if (opts["host-root"]) process.env.DSH_FORGE_HOST_ROOT = opts["host-root"];
if (opts.profile && ["desktop", "web"].includes(opts.profile)) process.env.DSH_FORGE_PROFILE = opts.profile;
const command = opts.version ? "version" : opts.help ? "help" : (positionals[0] || "help");
const positional = positionals.slice(1);
const flags = {
  has: (name) => Boolean(opts[name.replace(/^--/, "")]),
};

function optionValue(name, fallback = null) {
  const val = opts[name];
  return typeof val === "string" && val.length > 0 ? val : fallback;
}

function out(value, json = flags.has("--json")) {
  if (json) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    return;
  }
  if (typeof value === "string") process.stdout.write(value + "\n");
  else process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function banner(text) {
  process.stdout.write(`\n${text}\n${"-".repeat(text.length)}\n`);
}

function usage() {
  out(`dsh-forge ${VERSION}

Usage:
  dsh-forge doctor [--json]                     run 12 host checks
  dsh-forge status [--json]                     doctor + policy + profile + backups
  dsh-forge apply [--dry-run|--yes]             apply host patches (unpacks app.asar if needed)
  dsh-forge unpack [--dry-run|--yes]            unpack sealed app.asar into Resources/app
  dsh-forge upgrade [--dry-run|--yes]           refresh patches after forge or DSH update
  dsh-forge revert [--id <backup>] [--force]    restore files from backup manifest
  dsh-forge verify [--json]                     check patches, prompt channel, and session log
  dsh-forge explain <patch-id>                  show anchor match count and file preview
  dsh-forge adapt [--json]                      check anchor status across all patches
  dsh-forge profile [status|enable|disable] [--profile desktop]
  dsh-forge prompt compose [--adapter deepseek] [--mode coding] [--out file] [--budget 3200]
  dsh-forge prompt install                      write ~/.dsh/prompt-inject.md (with backup)
  dsh-forge preset [strict|fallback|always]
  dsh-forge collect                             export redacted diagnostics tarball
  dsh-forge log [--limit 50|--clear]
  dsh-forge audit [--limit 50]                  read the structured operation log
  dsh-forge personas [--json]                   list bundled personas
  dsh-forge channels [--all] [--json]           show delivery channel per action
  dsh-forge grades [--json]                     show how much of the host prompt each profile displaces
  dsh-forge console [--port 7788] [--state <dir>]   serve the read-only console on 127.0.0.1
  dsh-forge console --once [--json]             render the overview page and exit
  dsh-forge shim --binary <path> [--prompt <file>] [--env K=V] [--out <file>]
  dsh-forge compile [profile] [--model <id>] [--mode <mode>] [--persona <id>] [--persona-mode off|replace|strict|append] [--home <dir>] [--project <dir>] [--budget 3200] [--out plan.json]
  dsh-forge apply --profile <profile> [--model <model>] [--home <dir>] [--project <dir>] [--state <dir>] [--preview file] [--dry-run|--yes]
  dsh-forge plans [--json]
  dsh-forge verify-plan <plan-id> [--json]
  dsh-forge revert-plan <plan-id> [--force]
  dsh-forge profiles [--json]
  dsh-forge hosts [--json]
  dsh-forge models [--json]

Environment:
  DSH_HOME                 default ~/.dsh
  DSH_FORGE_PROFILE        default desktop
  DSH_FORGE_HOST_ROOT      override host root (or pass --host-root)
  DSH_FORGE_DEBUG=1        verbose event log`);
}

function cmdDoctor() {
  const report = doctor();
  process.exitCode = report.ok ? 0 : 1;
  if (flags.has("--json")) return out(report, true);
  banner(`dsh-forge doctor · DSH ${report.version}`);
  report.checks.forEach((c, i) => {
    const mark = c.status === "ok" ? "OK  " : c.status === "warn" ? "WARN" : "FAIL";
    process.stdout.write(`${String(i + 1).padStart(2)}. ${mark}  ${c.label.padEnd(18)} ${c.detail}\n`);
  });
  if (report.activation) {
    process.stdout.write(`Activation: ${report.activation.state} · session=${report.activation.sessionLoaded ? "loaded" : "pending"} · risk=${report.activation.risk}\n`);
  }
  const verdict = report.ok ? "PASS" : "FAIL";
  process.stdout.write(`\nVERDICT: ${verdict}\n`);
}

function cmdApply() {
  if (flags.has("--dry-run") || !flags.has("--yes")) {
    const report = dryRun();
    process.exitCode = report.ok ? 0 : 1;
    if (flags.has("--json")) return out(report, true);
    banner(`dry-run · DSH ${report.version}`);
    report.patches.forEach((p) => {
      const detail = p.files.map((f) => `${path.basename(f.abs)}:${f.status}/${f.matches}`).join(" ");
      process.stdout.write(`${p.status === "hit" || p.status === "applied" ? "OK  " : "FAIL"} ${p.id.padEnd(28)} ${detail}\n`);
    });
    process.stdout.write(`\n${report.ok ? `${PATCHES.length}/${PATCHES.length} ready` : "preflight failed"} — pass --yes to write files\n`);
    return;
  }
  const result = applyPatches();
  out(result, flags.has("--json"));
  if (!result.ok) process.exitCode = 1;
  else if (result.dir) process.stdout.write(`\nBackup: ${displayPath(result.dir)}\nQuit DSH (Cmd+Q) and reopen, then run: dsh-forge verify\n`);
}

function cmdUpgrade() {
  const isDry = flags.has("--dry-run") || !flags.has("--yes");
  const result = upgrade(PATCHES, {}, { dryRun: isDry });
  if (flags.has("--json") || !isDry) {
    out(result, flags.has("--json"));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  banner(`upgrade dry-run · DSH ${result.version} · forge ${result.forgeVersion}`);
  if (result.willRevert) process.stdout.write(`Will revert active backup first: ${result.willRevert}\n`);
  result.patches.forEach((p) => {
    const detail = p.files.map((f) => `${path.basename(f.abs)}:${f.status}/${f.matches}`).join(" ");
    process.stdout.write(`${p.status === "hit" || p.status === "applied" ? "OK  " : "FAIL"} ${p.id.padEnd(28)} ${detail}\n`);
  });
  process.stdout.write(`\n${result.ok ? "ready to upgrade" : "preflight failed"} — pass --yes to execute\n`);
  process.exitCode = result.ok ? 0 : 1;
}

function cmdRevert() {
  const id = optionValue("id", positional[0] || null);
  const result = revert({}, id, undefined, { force: flags.has("--force") });
  out(result, flags.has("--json"));
  process.exitCode = result.ok ? 0 : 1;
}

function cmdVerify() {
  const proofs = verifyProofs();
  process.exitCode = proofs.ok ? 0 : 1;
  if (flags.has("--json")) return out(proofs, true);
  banner("dsh-forge verify");
  for (const p of proofs.proofs) process.stdout.write(`${p.status.toUpperCase().padEnd(7)} ${p.name.padEnd(20)} ${p.detail}\n`);
  process.stdout.write(`\nBudget: ${proofs.composed.tokens}/${proofs.budget.max} tokens\nVERDICT: ${proofs.ok ? "PASS" : "FAIL"}\n`);
}

function cmdExplain() {
  const id = positional[0];
  if (!id) { usage(); process.exitCode = 2; return; }
  const data = explain(id);
  if (!data) { process.stdout.write(`unknown patch: ${id}\n`); process.exitCode = 2; return; }
  banner(`${data.patch.id} — ${data.patch.title}`);
  process.stdout.write(`why: ${data.patch.why}\n\n`);
  for (const file of data.results) {
    const label = file.exists ? `present (${file.source || "disk"})` : "MISSING";
    process.stdout.write(`file: ${displayPath(file.abs)}\n${label}\n`);
    for (const r of replacementsOf(data.patch)) {
      const count = file.exists && file.content ? file.content.split(r.find).length - 1 : 0;
      process.stdout.write(`  anchor hits: ${count}\n  find: ${JSON.stringify(r.find).slice(0, 180)}\n`);
    }
  }
}

function cmdUnpack() {
  const isDry = flags.has("--dry-run") || !flags.has("--yes");
  try {
    const result = unpackHostAsar({}, { dryRun: isDry });
    out(result, flags.has("--json"));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    out({ ok: false, error: error.message }, true);
    process.exitCode = 1;
  }
}

function cmdAdapt() {
  const rows = PATCHES.map((patch) => {
    const report = inspectPatch(patch);
    return { id: patch.id, status: report.status === "hit" || report.status === "applied" ? "ready" : report.status };
  });
  out(rows, flags.has("--json"));
  process.exitCode = rows.every((r) => r.status === "ready") ? 0 : 1;
}

function cmdProfile() {
  const action = positional[0] || "status";
  const env = { profile: optionValue("profile", undefined) };
  if (action === "status") {
    const res = profileStatus(env);
    out(res, flags.has("--json"));
    process.exitCode = res.ok && res.orderOk ? 0 : 1;
    return;
  }
  if (action === "enable") {
    const res = enableProfile(env);
    out(res, flags.has("--json"));
    process.exitCode = res.ok ? 0 : 1;
    return;
  }
  if (action === "disable") {
    const res = disableProfile(env);
    out(res, flags.has("--json"));
    process.exitCode = res.ok ? 0 : 1;
    return;
  }
  usage();
  process.exitCode = 2;
}

function cmdPrompt() {
  const action = positional[0] || "compose";
  const composed = composePrompt({ adapter: optionValue("adapter", "deepseek"), mode: optionValue("mode", null) });
  const max = Number(optionValue("budget", 3200));
  const budget = checkBudget(composed, max);
  if (action === "compose") {
    if (!budget.ok) process.exitCode = 1;
    if (flags.has("--json")) return out({ tokens: composed.tokens, max: budget.max, ok: budget.ok, sha256: composed.sha256 }, true);
    const target = optionValue("out", null);
    if (target) {
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, composed.text);
      process.stdout.write(`wrote ${target} · ${composed.tokens} tokens · sha256 ${composed.sha256.slice(0, 12)}\n`);
    } else {
      process.stdout.write(composed.text);
    }
    if (!budget.ok) process.stderr.write(`budget exceeded: ${budget.tokens}/${max}\n`);
    return;
  }
  if (action === "install") {
    if (!budget.ok && !flags.has("--force")) {
      out({ ok: false, reason: "budget-exceeded", tokens: budget.tokens, max: budget.max }, flags.has("--json"));
      process.exitCode = 1;
      return;
    }
    const result = writeInject(composed, { dshHome: optionValue("home", undefined) });
    out(result, flags.has("--json"));
    return;
  }
  usage();
  process.exitCode = 2;
}

function cmdPreset() {
  const value = positional[0];
  if (!value) return out({ policy: readPolicy(), options: POLICIES }, flags.has("--json"));
  try {
    out({ policy: setPolicy(value) }, flags.has("--json"));
  } catch (error) {
    out({ ok: false, error: error.message, options: POLICIES }, true);
    process.exitCode = 2;
  }
}

function cmdCollect() {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+$/, "");
  const dir = ensureDir(path.join(reportsDir(), `collect-${stamp}`));
  fs.writeFileSync(path.join(dir, "report.json"), redactText(JSON.stringify(doctor(), null, 2)));
  fs.writeFileSync(path.join(dir, "versions.txt"), [
    `forge=${VERSION}`,
    `node=${process.version}`,
    `dsh-home=${displayPath(dshHome())}`,
    `prompt=${displayPath(promptInjectPath())}`,
    `log=${displayPath(defaultLogFile())}`,
  ].join("\n"));
  const logFile = defaultLogFile();
  if (fs.existsSync(logFile)) fs.writeFileSync(path.join(dir, "forge.log.jsonl"), redactText(fs.readFileSync(logFile, "utf8")));
  fs.writeFileSync(path.join(dir, "README.txt"), `dsh-forge diagnostics\nCreated: ${stamp}\nRun: dsh-forge doctor --json\n`);
  const archive = path.join(reportsDir(), `forge-diag-${stamp}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", dir, "."]);
  process.stdout.write(`${archive}\n`);
}

function forgeContext() {
  const profileId = optionValue("forge-profile", optionValue("profile", positional[0] || "dsh"));
  const profile = loadProfile(profileId);
  const modelId = optionValue("model", profile.model || "deepseek");
  const model = loadModel(modelId);
  // Keep the executor environment as a flat object.  The compile context also
  // exposes these values at the top level so adapters can observe the same
  // host/state selection as the executor.
  const stateRoot = optionValue("state", process.env.DSH_FORGE_STATE || undefined);
  const hostRoot = optionValue("host-root", process.env.DSH_FORGE_HOST_ROOT || undefined);
  const home = optionValue("home", process.env.HOME || process.env.USERPROFILE);
  const context = normalizeContext({
    hostId: profile.host,
    profileId: profile.id,
    mode: optionValue("mode", null),
    persona: optionValue("persona", null),
    personaMode: optionValue("persona-mode", null),
    projectRoot: optionValue("project", process.cwd()),
    home,
    budget: Number(optionValue("budget", 3200)),
    env: { stateRoot, hostRoot, dshHome: home ? path.join(home, ".dsh") : undefined },
  });
  const plan = compile(profile, model, context);
  return { profile, model, plan, context };
}

function cmdPersonas() {
  const rows = listPersonas().map(({ id, name, mode, harness, chars }) => ({ id, name, mode, harness, chars }));
  if (flags.has("--json")) return out({ ok: true, personas: rows }, true);
  banner(`personas ${rows.length}`);
  rows.forEach((row) => process.stdout.write(`${row.id.padEnd(12)} ${row.mode.padEnd(8)} ${row.harness.padEnd(10)} ${row.chars} chars  ${row.name}\n`));
}

function cmdConsole() {
  const stateRoot = optionValue("state", process.env.DSH_FORGE_STATE || path.join(optionValue("home", process.env.HOME || process.env.USERPROFILE || "."), ".dsh", "dsh-forge"));
  const projectRoot = optionValue("project", process.cwd());
  const state = () => consoleState({ stateRoot }, { projectRoot });
  if (flags.has("--once")) {
    const snapshot = state();
    if (flags.has("--json")) return out({ ok: true, state: snapshot }, true);
    return process.stdout.write(renderOverview(snapshot));
  }
  const port = Number(optionValue("port", CONSOLE_PORT));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.exitCode = 1;
    return out({ ok: false, code: "console-port", error: `invalid port ${optionValue("port", null)}` }, true);
  }
  const lock = acquireLock(stateRoot);
  const server = createConsole({ state, port });
  server.on("error", (error) => {
    lock.release();
    process.exitCode = 1;
    out({ ok: false, code: "console-listen", error: error.message }, true);
  });
  server.listen(port, CONSOLE_HOST, () => {
    const actual = server.address().port;
    banner(`console http://${CONSOLE_HOST}:${actual}`);
    process.stdout.write(`read-only · state ${stateRoot} · ctrl-c to stop\n`);
  });
  const stop = () => {
    server.close(() => {
      lock.release();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function cmdGrades() {
  const rows = gradeTable(listProfiles());
  if (flags.has("--json")) return out({ ok: true, grades: rows }, true);
  banner(`delivery grades ${rows.length} profiles`);
  rows.forEach((row) => process.stdout.write(`${row.id.padEnd(12)} ${row.grade.padEnd(21)} ${row.source.padEnd(9)} ${row.mechanism}\n`));
}

function cmdChannels() {
  if (flags.has("--all")) {
    const rows = listProfiles().map((profile) => {
      const model = loadModel(profile.model || "deepseek");
      const plan = compile(profile, model, { projectRoot: process.cwd() });
      return { id: profile.id, host: profile.host, support: profile.support, ...plan.channels.counts, timings: plan.channels.timings };
    });
    if (flags.has("--json")) return out({ ok: true, profiles: rows }, true);
    banner(`channel coverage ${rows.length} profiles`);
    process.stdout.write(`${"profile".padEnd(12)} ${"track".padEnd(12)} project install shim slash none\n`);
    rows.forEach((row) => process.stdout.write(`${row.id.padEnd(12)} ${String(row.support).padEnd(12)} ${String(row.project).padEnd(7)} ${String(row.install).padEnd(7)} ${String(row.shim).padEnd(4)} ${String(row.slash).padEnd(5)} ${row.none}\n`));
    return;
  }
  const { plan } = forgeContext();
  if (flags.has("--json")) return out({ ok: true, channels: plan.channels }, true);
  banner(`channels ${plan.profile.id} → ${plan.profile.host}`);
  process.stdout.write(`track ${plan.profile.support} · ${plan.channels.channels.join(" ") || "none"}\n`);
  plan.channels.rows.forEach((row) => {
    process.stdout.write(`${row.channel.padEnd(9)} ${row.timing.padEnd(13)} ${String(row.kind).padEnd(15)} ${row.path || "(none)"}\n`);
  });
}

function cmdShim() {
  const binary = optionValue("binary", null);
  const promptPath = optionValue("prompt", null);
  const env = {};
  for (const pair of opts.env || []) {
    const at = String(pair).indexOf("=");
    if (at <= 0) {
      process.exitCode = 1;
      out({ ok: false, code: "shim-env", error: `--env expects KEY=VALUE, got ${pair}` }, true);
      return;
    }
    env[String(pair).slice(0, at)] = String(pair).slice(at + 1);
  }
  const text = renderShim({ binary, promptPath, env, note: optionValue("note", null) });
  const outFile = optionValue("out", null);
  if (!outFile) return process.stdout.write(text);
  const abs = path.resolve(outFile);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, text, { mode: 0o755 });
  out({ ok: true, shim: abs, bytes: text.length }, flags.has("--json"));
}

function cmdCompile() {
  const { plan } = forgeContext();
  process.exitCode = plan.budget.ok ? 0 : 1;
  const outFile = optionValue("out", null);
  if (outFile) {
    ensureDir(path.dirname(path.resolve(outFile)));
    fs.writeFileSync(path.resolve(outFile), JSON.stringify(plan, null, 2) + "\n");
  }
  if (flags.has("--json") || outFile) return out(plan, flags.has("--json"));
  banner(`plan ${plan.planId} · ${plan.profile.id} → ${plan.profile.host}`);
  process.stdout.write(`model ${plan.model.id} · prompt ${plan.budget.tokens}/${plan.budget.max} tokens · ${plan.capabilities.map((c) => `${c.name}:${c.level}`).join(" ")}\n`);
  plan.actions.forEach((a) => process.stdout.write(`${a.op.padEnd(14)} ${a.path || "(host patch table)"}\n`));
  process.stdout.write(`\n${plan.budget.ok ? "ready" : "budget exceeded"}; pass --out to save the plan\n`);
}

function cmdForgeApply() {
  const { plan, context } = forgeContext();
  const isDry = flags.has("--dry-run") || !flags.has("--yes");
  const previewPath = optionValue("preview", null);
  let preview = null;
  if (previewPath && !isDry) preview = JSON.parse(fs.readFileSync(path.resolve(previewPath), "utf8"));
  const result = applyPlan(plan, { ...context, env: context.env, dryRun: isDry, yes: flags.has("--yes"), preview });
  if (previewPath && isDry && result.preview) {
    ensureDir(path.dirname(path.resolve(previewPath)));
    fs.writeFileSync(path.resolve(previewPath), JSON.stringify(result.preview, null, 2) + "\n");
    result.previewPath = path.resolve(previewPath);
  }
  out(result, flags.has("--json"));
  process.exitCode = result.ok ? 0 : 1;
}

function cmdPlans() {
  out({ plans: listPlans({
    stateRoot: optionValue("state", process.env.DSH_FORGE_STATE || undefined),
    hostRoot: optionValue("host-root", process.env.DSH_FORGE_HOST_ROOT || undefined),
  }) }, flags.has("--json"));
}

function cmdVerifyPlan() {
  const id = positional[0];
  if (!id) { usage(); process.exitCode = 2; return; }
  const result = verifyPlan(id, {
    stateRoot: optionValue("state", process.env.DSH_FORGE_STATE || undefined),
    hostRoot: optionValue("host-root", process.env.DSH_FORGE_HOST_ROOT || undefined),
  });
  out(result, flags.has("--json"));
  process.exitCode = result.ok ? 0 : 1;
}

function cmdRevertPlan() {
  const id = positional[0] || optionValue("plan", null);
  if (!id) { usage(); process.exitCode = 2; return; }
  const result = revertPlan(id, {
    force: flags.has("--force"),
    env: {
      stateRoot: optionValue("state", process.env.DSH_FORGE_STATE || undefined),
      hostRoot: optionValue("host-root", process.env.DSH_FORGE_HOST_ROOT || undefined),
    },
  });
  out(result, flags.has("--json"));
  process.exitCode = result.ok ? 0 : 1;
}

function cmdProfiles() {
  out({ profiles: listProfiles() }, flags.has("--json"));
}

function cmdHosts() {
  out({ hosts: detectAll() }, flags.has("--json"));
}

function cmdModels() {
  out({ models: listModels() }, flags.has("--json"));
}

function cmdLog() {
  if (flags.has("--clear")) {
    out(clearLogs(), flags.has("--json"));
    return;
  }
  const limit = Number(optionValue("limit", 50)) || 50;
  out(readLog(limit), flags.has("--json"));
}

try {
  switch (command) {
    case "doctor": cmdDoctor(); break;
    case "status": out({ doctor: doctor(), policy: readPolicy(), profile: profileStatus(), backups: listBackups() }, true); break;
    case "apply":
      if (optionValue("profile", null) && !["desktop", "web"].includes(optionValue("profile"))) cmdForgeApply();
      else cmdApply();
      break;
    case "unpack": cmdUnpack(); break;
    case "upgrade":
    case "update": cmdUpgrade(); break;
    case "revert": cmdRevert(); break;
    case "verify": cmdVerify(); break;
    case "explain": cmdExplain(); break;
    case "adapt": cmdAdapt(); break;
    case "profile": cmdProfile(); break;
    case "prompt": cmdPrompt(); break;
    case "preset": cmdPreset(); break;
    case "collect": cmdCollect(); break;
    case "log": cmdLog(); break;
    case "audit": cmdLog(); break;
    case "compile": cmdCompile(); break;
    case "apply-profile": cmdForgeApply(); break;
    case "plans": cmdPlans(); break;
    case "verify-plan": cmdVerifyPlan(); break;
    case "revert-plan": cmdRevertPlan(); break;
    case "profiles": cmdProfiles(); break;
    case "hosts": cmdHosts(); break;
    case "models": cmdModels(); break;
    case "personas": cmdPersonas(); break;
    case "channels": cmdChannels(); break;
    case "shim": cmdShim(); break;
    case "grades": cmdGrades(); break;
    case "console": cmdConsole(); break;
    case "version": process.stdout.write(`${VERSION}\n`); break;
    default: usage();
  }
} catch (error) {
  if (error instanceof ForgeError) {
    out(error.toJSON(), true);
    process.exitCode = 1;
  } else {
    out({ ok: false, error: error?.message || String(error) }, true);
    process.exitCode = 1;
  }
}
