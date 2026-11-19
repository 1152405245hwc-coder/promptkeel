import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { doctor } from "../../lib/doctor.mjs";
import { dryRun, apply as applyPatches, revert, upgrade, listBackups, explain, replacementsOf, inspectPatch } from "../../lib/engine.mjs";
import { unpackHostAsar } from "../../lib/asar.mjs";
import { PATCHES } from "../../lib/table.mjs";
import { composePrompt, checkBudget, writeInject, verifyProofs } from "../../lib/inject.mjs";
import { readPolicy, setPolicy, POLICIES, profileStatus, enableProfile, disableProfile } from "../../lib/preset.mjs";
import { reportsDir, ensureDir, dshHome, promptInjectPath, displayPath, redactText, VERSION } from "../../lib/paths.mjs";
import { readLog, clearLogs, defaultLogFile } from "../../lib/log.mjs";
import { positional, flags, optionValue, out, banner, usage } from "./shared.mjs";

export function cmdDoctor() {
  const report = doctor();
  process.exitCode = report.ok ? 0 : 1;
  if (flags.has("--json")) return out(report, true);
  banner(`promptkeel doctor · DSH ${report.version}`);
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

export function cmdStatus() {
  out({ doctor: doctor(), policy: readPolicy(), profile: profileStatus(), backups: listBackups() }, true);
}

export function cmdApply() {
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
  else if (result.dir) process.stdout.write(`\nBackup: ${displayPath(result.dir)}\nQuit DSH (Cmd+Q) and reopen, then run: promptkeel verify\n`);
}

export function cmdUpgrade() {
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

export function cmdRevert() {
  const id = optionValue("id", positional[0] || null);
  const result = revert({}, id, undefined, { force: flags.has("--force") });
  out(result, flags.has("--json"));
  process.exitCode = result.ok ? 0 : 1;
}

export function cmdVerify() {
  const proofs = verifyProofs();
  process.exitCode = proofs.ok ? 0 : 1;
  if (flags.has("--json")) return out(proofs, true);
  banner("promptkeel verify");
  for (const p of proofs.proofs) process.stdout.write(`${p.status.toUpperCase().padEnd(7)} ${p.name.padEnd(20)} ${p.detail}\n`);
  process.stdout.write(`\nBudget: ${proofs.composed.tokens}/${proofs.budget.max} tokens\nVERDICT: ${proofs.ok ? "PASS" : "FAIL"}\n`);
}

export function cmdExplain() {
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

export function cmdUnpack() {
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

export function cmdAdapt() {
  const rows = PATCHES.map((patch) => {
    const report = inspectPatch(patch);
    return { id: patch.id, status: report.status === "hit" || report.status === "applied" ? "ready" : report.status };
  });
  out(rows, flags.has("--json"));
  process.exitCode = rows.every((r) => r.status === "ready") ? 0 : 1;
}

export function cmdProfile() {
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

export function cmdPrompt() {
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

export function cmdPreset() {
  const value = positional[0];
  if (!value) return out({ policy: readPolicy(), options: POLICIES }, flags.has("--json"));
  try {
    out({ policy: setPolicy(value) }, flags.has("--json"));
  } catch (error) {
    out({ ok: false, error: error.message, options: POLICIES }, true);
    process.exitCode = 2;
  }
}

export function cmdCollect() {
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
  fs.writeFileSync(path.join(dir, "README.txt"), `PromptKeel diagnostics\nCreated: ${stamp}\nRun: promptkeel doctor --json\n`);
  const archive = path.join(reportsDir(), `forge-diag-${stamp}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", dir, "."]);
  process.stdout.write(`${archive}\n`);
}

export function cmdLog() {
  if (flags.has("--clear")) {
    out(clearLogs(), flags.has("--json"));
    return;
  }
  const limit = Number(optionValue("limit", 50)) || 50;
  out(readLog(limit), flags.has("--json"));
}
