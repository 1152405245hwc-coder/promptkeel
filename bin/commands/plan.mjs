import fs from "node:fs";
import path from "node:path";
import { loadModel, listProfiles, listModels } from "../../core/contract.mjs";
import { compile } from "../../core/compile.mjs";
import { applyPlan, revertPlan, listPlans, verifyPlan } from "../../core/executor.mjs";
import { detectAll } from "../../hosts/registry.mjs";
import { listPersonas } from "../../core/persona.mjs";
import { PROBES, runProbes, selfCheck } from "../../core/probe.mjs";
import { TRANSFORMS, roundTrip } from "../../core/transform.mjs";
import { renderShim } from "../../core/shim.mjs";
import { gradeTable } from "../../core/grades.mjs";
import { readAudit, summarizeAudit } from "../../core/audit.mjs";
import { writeSnapshot, pruneSnapshots, listSnapshots, SNAPSHOT_DEFAULTS } from "../../core/snapshot.mjs";
import { ensureDir, logsDir } from "../../lib/paths.mjs";
import { defaultLogFile, log, setLogFile } from "../../lib/log.mjs";
import { opts, positional, flags, optionValue, out, banner, usage, stateRootPath, forgeContext } from "./shared.mjs";

export function cmdPersonas() {
  const rows = listPersonas().map(({ id, name, mode, harness, transform, chars }) => ({ id, name, mode, harness, transform, chars }));
  if (flags.has("--json")) return out({ ok: true, personas: rows }, true);
  banner(`personas ${rows.length}`);
  rows.forEach((row) => process.stdout.write(`${row.id.padEnd(12)} ${row.mode.padEnd(8)} ${String(row.transform).padEnd(8)} ${row.harness.padEnd(8)} ${row.chars} chars  ${row.name}\n`));
}

export function cmdTransforms() {
  const sample = "Deliver the result first, then the reasoning behind it.";
  const rows = TRANSFORMS.map((kind) => {
    const rt = roundTrip(sample, kind);
    return { kind, reversible: rt.reversible, roundTrip: rt.roundTrip, ratio: Number(rt.ratio.toFixed(2)), sample: rt.output.slice(0, 64) };
  });
  if (flags.has("--json")) return out({ ok: true, transforms: rows }, true);
  banner(`transforms ${rows.length}`);
  rows.forEach((row) => process.stdout.write(`${row.kind.padEnd(9)} ${(row.reversible ? (row.roundTrip ? "round-trip" : "broken") : "lossy").padEnd(11)} ${String(row.ratio).padStart(5)}x  ${row.sample.replace(/\n/g, "⏎")}\n`));
}

export function cmdProbe() {
  const check = selfCheck();
  const { plan } = forgeContext();
  const result = runProbes({
    prompt: plan.prompt.text,
    persona: plan.prompt.persona ? plan.prompt.persona.id : null,
    transform: plan.transform || (plan.persona && plan.persona.transform) || null,
    budget: plan.budget.max,
  });
  if (flags.has("--json")) return out({ ok: result.failed === 0 && check.ok, ...result, profile: plan.profile.id, selfCheck: check }, true);
  banner(`probe ${result.passed}/${result.total} · ${plan.profile.id} · transform ${result.transform} · ${PROBES.length} requests`);
  for (const row of result.rows) {
    const failedChecks = row.checks.filter((c) => !c.ok);
    const status = row.ok ? "pass" : "FAIL";
    process.stdout.write(`${status.padEnd(5)} ${row.id.padEnd(23)} ${row.family.padEnd(9)} ${failedChecks.length ? failedChecks.map((c) => `${c.name}: ${c.detail}`).join("; ") : row.checks.map((c) => c.name).join(" ")}\n`);
  }
  process.stdout.write(`score ${result.score} · self-check ${check.ok ? `detected ${check.detected.join("+")}` : "MISSED"} · families ${[...new Set(result.rows.map((r) => r.family))].join(",")}\n`);
  if (result.failed || !check.ok) process.exitCode = 1;
}

export function cmdAudit() {
  const limit = Number(optionValue("limit", 100)) || 100;
  const dshHomeOpt = optionValue("dsh-home", null);
  const stateOpt = optionValue("state", null);
  const logEnv = dshHomeOpt ? { dshHome: dshHomeOpt } : { stateRoot: stateOpt || stateRootPath() };
  const result = readAudit(logsDir(logEnv), { limit });
  const summary = summarizeAudit(result.events);
  if (flags.has("--json")) return out({ ok: true, ...result, summary }, true);
  banner(`audit ${summary.total} events · ${result.days} day(s)`);
  Object.entries(summary.counts).sort((a, b) => b[1] - a[1]).forEach(([event, count]) => process.stdout.write(`${String(count).padStart(4)}  ${event}\n`));
  result.events.slice(-10).forEach((event) => process.stdout.write(`${event.ts} ${(event.level || "info").padEnd(5)} ${event.event} ${JSON.stringify(Object.fromEntries(Object.entries(event).filter(([k]) => !["ts", "level", "event", "day"].includes(k))))}\n`));
  if (result.skipped) process.stdout.write(`${result.skipped} unreadable line(s) skipped\n`);
}

export function cmdSnapshot() {
  const stateRoot = stateRootPath();
  if (flags.has("--list")) {
    const rows = listSnapshots(stateRoot);
    if (flags.has("--json")) return out({ ok: true, snapshots: rows, limits: SNAPSHOT_DEFAULTS }, true);
    banner(`snapshots ${rows.length}`);
    rows.forEach((row) => process.stdout.write(`${row.at} ${String(row.bytes).padStart(8)}  ${row.label}  ${row.name}\n`));
    return;
  }
  const limits = {
    keep: Number(optionValue("keep", SNAPSHOT_DEFAULTS.keep)),
    days: Number(optionValue("days", SNAPSHOT_DEFAULTS.days)),
    maxBytes: Number(optionValue("max-bytes", SNAPSHOT_DEFAULTS.maxBytes)),
  };
  if (![limits.keep, limits.days, limits.maxBytes].every((n) => Number.isFinite(n) && n >= 0)) {
    process.exitCode = 1;
    return out({ ok: false, code: "snapshot-limits", error: "keep, days and max-bytes must be non-negative numbers" }, true);
  }
  const { plan } = forgeContext();
  const written = writeSnapshot(stateRoot, { label: `prompt-${plan.profile.id}`, content: plan.prompt.text });
  const pruned = pruneSnapshots(stateRoot, limits);
  setLogFile(defaultLogFile({ stateRoot }));
  log("snapshot.written", { profile: plan.profile.id, bytes: written.bytes, kept: pruned.kept.length, removed: pruned.removed.length });
  if (flags.has("--json")) return out({ ok: true, written, pruned }, true);
  banner(`snapshot ${plan.profile.id}`);
  process.stdout.write(`${written.bytes} bytes → ${written.file}\n`);
  process.stdout.write(`kept ${pruned.kept.length} · removed ${pruned.removed.length} · freed ${pruned.freedBytes} bytes (keep ${limits.keep}, days ${limits.days}, max ${limits.maxBytes})\n`);
}

export function cmdGrades() {
  const rows = gradeTable(listProfiles());
  if (flags.has("--json")) return out({ ok: true, grades: rows }, true);
  banner(`delivery grades ${rows.length} profiles`);
  rows.forEach((row) => process.stdout.write(`${row.id.padEnd(12)} ${row.grade.padEnd(21)} ${row.source.padEnd(9)} ${row.mechanism}\n`));
}

export function cmdChannels() {
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

export function cmdShim() {
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

export function cmdCompile() {
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

export function cmdForgeApply() {
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

export function cmdPlans() {
  out({ plans: listPlans({
    stateRoot: stateRootPath(),
    hostRoot: optionValue("host-root", process.env.PROMPTKEEL_HOST_ROOT || process.env.DSH_FORGE_KIT_HOST_ROOT || process.env.DSH_FORGE_HOST_ROOT || undefined),
  }) }, flags.has("--json"));
}

export function cmdVerifyPlan() {
  const id = positional[0];
  if (!id) { usage(); process.exitCode = 2; return; }
  const result = verifyPlan(id, {
    stateRoot: stateRootPath(),
    hostRoot: optionValue("host-root", process.env.PROMPTKEEL_HOST_ROOT || process.env.DSH_FORGE_KIT_HOST_ROOT || process.env.DSH_FORGE_HOST_ROOT || undefined),
  });
  out(result, flags.has("--json"));
  process.exitCode = result.ok ? 0 : 1;
}

export function cmdRevertPlan() {
  const id = positional[0] || optionValue("plan", null);
  if (!id) { usage(); process.exitCode = 2; return; }
  const result = revertPlan(id, {
    force: flags.has("--force"),
    env: {
      stateRoot: stateRootPath(),
      hostRoot: optionValue("host-root", process.env.PROMPTKEEL_HOST_ROOT || process.env.DSH_FORGE_KIT_HOST_ROOT || process.env.DSH_FORGE_HOST_ROOT || undefined),
    },
  });
  out(result, flags.has("--json"));
  process.exitCode = result.ok ? 0 : 1;
}

export function cmdProfiles() {
  out({ profiles: listProfiles() }, flags.has("--json"));
}

export function cmdHosts() {
  out({ hosts: detectAll() }, flags.has("--json"));
}

export function cmdModels() {
  out({ models: listModels() }, flags.has("--json"));
}
