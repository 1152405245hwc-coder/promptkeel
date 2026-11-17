#!/usr/bin/env node
/**
 * Live matrix runner: composes each prompt with `dsh-forge compile`, applies
 * strategy layers from `core/strategy.mjs`, sends bounded requests through
 * `core/gateway.mjs`, and classifies refusal vs. compliance verdicts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as probeCore from "../core/probe.mjs";
import { listPersonas } from "../core/persona.mjs";
import { TRANSFORMS } from "../core/transform.mjs";
import {
  RUNGS,
  WRAPS,
  CRESCENDO_SETUP,
  CRESCENDO_FINISH,
  TURN_SCRIPTS,
  STRATEGIES,
  wrapUser,
  stuffContext,
  buildConversation,
  buildRequests,
  listSafeBenchmarkProbes,
} from "../core/strategy.mjs";
import {
  OPENAI_DEFAULT_BASE,
  MAGPIE_DEFAULT_BASE,
  ANTHROPIC_DEFAULT_BASE,
  GLM_DEFAULT_BASE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  GatewayConfigError as ConfigError,
  REPLY_REFUSAL_PATTERNS,
  resolveGateway,
  resolveProvider,
  requestUrl,
  authHeaders,
  fetchModelIds,
  forgeModelFor,
  planModels,
  expand,
  requestBody,
  normalizeReply,
  sendRequest,
  sendWithRetry,
  starved,
  sendWithBudget,
  executeStrategyRequest,
  detectBlock,
  detectRefusal,
  excerpt,
  redactSecret,
  verdictOf,
  complianceOf,
  makeRow,
  summarize,
} from "../core/gateway.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CORPUS = probeCore.PROBES;
export const DEFAULT_PROFILE = "generic";
export const RESULTS_SCHEMA = "forge.live-matrix/v1";

export {
  OPENAI_DEFAULT_BASE,
  MAGPIE_DEFAULT_BASE,
  ANTHROPIC_DEFAULT_BASE,
  GLM_DEFAULT_BASE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  REPLY_REFUSAL_PATTERNS,
  RUNGS,
  WRAPS,
  CRESCENDO_SETUP,
  CRESCENDO_FINISH,
  TURN_SCRIPTS,
  STRATEGIES,
  wrapUser,
  stuffContext,
  buildConversation,
  buildRequests,
  listSafeBenchmarkProbes,
  resolveGateway,
  resolveProvider,
  forgeModelFor,
  planModels,
  expand,
  requestBody,
  normalizeReply,
  sendRequest,
  sendWithRetry,
  starved,
  sendWithBudget,
  executeStrategyRequest,
  detectBlock,
  detectRefusal,
  excerpt,
  verdictOf,
  complianceOf,
  makeRow,
  summarize,
};

const USAGE = `Usage: node scripts/live_matrix.mjs [options]

Matrix axes
  --profile <id[,id]>         forge profile(s); default ${DEFAULT_PROFILE}
  --model <live[,live]>       live model id(s); repeatable or comma-separated
  --forge-model <id>          override forge model descriptor
  --persona <id[,id]|all>     persona id(s) or "none"; default none
  --transform <kind[,kind]|all>
                              payload transform(s); default none
  --probe <id[,id]>           probe ids; default every selected probe
  --family <name[,name]>      include probe families
  --exclude-family <name[,name]>
                              exclude probe families (e.g. minor,bio,chem)

Strategies
  --strategy <id>             preset (${STRATEGIES.map((s) => s.id).join(", ")})
  --control                   include a prompt-free control arm per model/probe
  --ladder                    run four rungs: direct, persona, cipher, prefill
  --wrap variable             wrap user prompt in Z=[...] assignment
  --crescendo                 two-turn outline -> fill script
  --script <name>             multi-turn script: crescendo, deep, layered
  --prefill <text>            assistant prefill prefix (single-turn only)
  --stuff <tokens>            pad with neutral engineering context tokens

Provider
  --provider <name>           openai | gateway | anthropic | glm | config entry
  --config <file>             JSON provider table
  --base-url <url>            override base URL
  --key-env <VAR>             override API key env var
  --gateway <url|default>     local OpenAI-compatible gateway (${MAGPIE_DEFAULT_BASE})
  --list-models               list advertised endpoint models and exit

Run bounds
  --max-tokens <n>            completion token cap; default ${DEFAULT_MAX_TOKENS}
  --temperature <n>           sampling temperature; default 0
  --timeout-ms <n>            per-request timeout; default ${DEFAULT_TIMEOUT_MS}
  --limit <n>                 hard cap on total requests sent
  --repeat <n>                sample each cell n times
  --dry-run                   compile locally and print request shape only
  --dump-request <file>       write first dry-run body to JSON
  --show-prompt               print compiled prompt in dry-run output
  --out <file>                write results JSON report
`;

const LIST_FLAGS = new Set(["profile", "model", "persona", "transform", "probe", "family", "exclude-family"]);
const VALUE_FLAGS = new Set([
  "provider", "config", "base-url", "key-env", "max-tokens", "temperature",
  "timeout-ms", "repeat", "stuff", "limit", "out", "dump-request", "forge-model",
  "gateway", "wrap", "prefill", "script", "stuff", "strategy",
]);
const BOOL_FLAGS = new Set(["dry-run", "show-prompt", "help", "list-models", "control", "ladder", "crescendo"]);

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

export function parseArgs(argv) {
  const options = {
    profile: [], model: [], persona: [], transform: [], probe: [], family: [], excludeFamily: [],
    dryRun: false, showPrompt: false, listModels: false, control: false, ladder: false, crescendo: false,
    wrap: "none", help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new UsageError(`unexpected argument: ${token}`);
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).trim();
    let value = eq === -1 ? null : token.slice(eq + 1);
    if (BOOL_FLAGS.has(name)) {
      if (value !== null && value !== "true") throw new UsageError(`--${name} takes no value`);
      options[name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = true;
      continue;
    }
    if (!LIST_FLAGS.has(name) && !VALUE_FLAGS.has(name)) throw new UsageError(`unknown option: --${name}`);
    if (value === null) {
      value = argv[i + 1];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      i += 1;
    }
    const camel = name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (LIST_FLAGS.has(name)) {
      for (const part of value.split(",").map((entry) => entry.trim()).filter(Boolean)) options[camel].push(part);
    } else {
      options[camel] = value;
    }
  }
  return options;
}

function positiveInt(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new UsageError(`--${name} must be an integer >= ${min}`);
  return number;
}

function numberOption(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new UsageError(`--${name} must be a finite number`);
  return number;
}

function expandAxis(requested, all, { allowNone = false, noneValue = "none" } = {}) {
  const values = [];
  for (const value of requested) {
    if (value === "all") values.push(...all);
    else if (allowNone && value === noneValue) values.push(noneValue);
    else values.push(value);
  }
  return [...new Set(values.length ? values : [allowNone ? noneValue : all[0]])];
}

function compileCommand({ profile, forge, persona, transform }) {
  const args = [path.join(ROOT, "bin", "dsh-forge.js"), "compile", "--profile", profile, "--model", forge];
  if (persona && persona !== "none") args.push("--persona", persona);
  if (transform && transform !== "none") args.push("--transform", transform);
  return args;
}

export function compilePrompt(combo, { tempRoot } = {}) {
  if (combo.arm === "control") {
    return { text: "", tokens: 0, budget: null, planId: null, personaId: null, transform: "none", cli: "(control arm: no system prompt)" };
  }
  const home = path.join(tempRoot, "home");
  const project = path.join(tempRoot, "project");
  const outFile = path.join(tempRoot, `plan-${combo.profile}-${combo.forge}-${combo.persona}-${combo.transform}.json`);
  const args = [...compileCommand(combo), "--home", home, "--project", project, "--out", outFile];
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    const parsed = (() => {
      try { return JSON.parse(stderr); } catch { return null; }
    })();
    throw new ConfigError(`compile failed for ${combo.profile}/${combo.forge}/${combo.persona}/${combo.transform}: ${parsed?.error || stderr.split("\n")[0] || error.message}`);
  }
  const plan = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const text = plan?.prompt?.text;
  if (typeof text !== "string" || !text) throw new ConfigError(`compile produced no prompt text for ${combo.profile}/${combo.forge}`);
  return {
    text,
    tokens: plan.prompt.tokens ?? null,
    budget: plan.budget || null,
    planId: plan.planId || null,
    personaId: plan.persona?.id || null,
    transform: plan.transform || (plan.prompt.transform ?? "none"),
    cli: `node bin/dsh-forge.js ${compileCommand(combo).slice(1).join(" ")}`,
  };
}

function withTempRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-live-matrix-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function comboKey(request) {
  return `${request.profile}|${request.forge}|${request.persona}|${request.transform}|${request.arm || "forge"}`;
}

function elideSystem(value, systemText, placeholder) {
  if (typeof value === "string") return value === systemText ? placeholder : value;
  if (Array.isArray(value)) return value.map((entry) => elideSystem(entry, systemText, placeholder));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, elideSystem(entry, systemText, placeholder)]));
  }
  return value;
}

function printMatrix({ profiles, models, personas, transforms, probes, plan, options }) {
  const total = plan.requests.length;
  const sent = plan.sent.length;
  const limit = options.limit ? ` · limit ${options.limit} → ${sent} sent` : "";
  process.stdout.write(`live matrix · profiles ${profiles.join(",")} · ${models.length} model(s) × ${probes.length} probe(s) × ${personas.length} persona(s) × ${transforms.length} transform(s) = ${total} request(s)${limit}${options.dryRun ? " · dry-run" : ""}\n`);
  const sentKeys = new Set(plan.sent.map(comboKey));
  const seen = new Set();
  for (const request of plan.requests) {
    const key = comboKey(request);
    if (seen.has(key)) continue;
    seen.add(key);
    const isSent = sentKeys.has(key);
    let line = `  ${request.profile} × ${request.model}${request.forge !== request.model ? ` (forge=${request.forge})` : ""} × ${request.persona} × ${request.transform}`;
    if (!isSent) line += ` · ${probes.length} probe(s) · not sent (--limit)`;
    else {
      const compiled = plan.compiled.get(key);
      line += compiled.error ? ` · compile error: ${compiled.error}` : ` · prompt ${compiled.tokens ?? "?"} tok · ${compiled.cli}`;
    }
    process.stdout.write(`${line}\n`);
  }
  if (plan.truncated) process.stdout.write(`  (${total - sent} planned requests not sent; raise --limit to cover the matrix)\n`);
}

function printRequestShape({ provider, request, compiled, keyEnv, keyPresent, options, publicKeyName }) {
  const { maxTokens, temperature } = options;
  const conv = buildConversation(request.probe.request, {
    wrap: request.wrap,
    script: request.script,
    prefill: request.prefill,
    stuffTokens: request.stuffTokens,
  });
  const body = requestBody(provider, { system: compiled.text, user: conv.user, model: request.model, prefill: conv.prefill }, { maxTokens, temperature });
  const headers = authHeaders(provider, keyPresent ? "<key>" : "");
  const displayHeaders = { ...headers };
  displayHeaders[provider.authHeader.toLowerCase()] = `${provider.authPrefix}<redacted ${publicKeyName}>`;
  const placeholder = `<system prompt: ${compiled.tokens ?? "?"} tokens / ${compiled.text.length} chars; --show-prompt to print>`;
  const shown = options.showPrompt ? body : elideSystem(body, compiled.text, placeholder);
  process.stdout.write(`\nrequest shape · ${request.model} · probe ${request.probe.id} · persona ${request.persona} · transform ${request.transform}\n`);
  process.stdout.write(`  POST ${requestUrl(provider, request.model)}\n`);
  for (const [name, value] of Object.entries(displayHeaders)) process.stdout.write(`  ${name}: ${value}\n`);
  process.stdout.write(`  ${JSON.stringify(shown)}\n`);
  if (!keyPresent) process.stdout.write(`  key: ${keyEnv} is not set; live calls would exit 2\n`);
}

function printSummary(summary) {
  const rate = summary.refusalRate === null ? "n/a" : `${summary.refusalRate}%`;
  process.stdout.write(`\nsummary · ${summary.calls}/${summary.planned} answered · ${summary.refused} refused (${rate} of replies) · ${summary.errors} errors · avg ${summary.avgLatencyMs ?? 0}ms\n`);
  for (const group of summary.groups) {
    const groupRate = group.refusalRate === null ? "n/a" : `${group.refusalRate}%`;
    process.stdout.write(`  ${group.model} · ${group.rung} · ${group.persona} · ${group.transform} · refusal ${group.refused}/${group.calls} (${groupRate}) · errors ${group.errors} · avg ${group.avgLatencyMs ?? 0}ms\n`);
  }
}

function writeResults(file, document) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return target;
}

export async function run(argv, { env = process.env } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const provider = resolveProvider({ options, env });
  if (options.listModels) {
    const ids = await fetchModelIds(provider);
    for (const id of ids) process.stdout.write(`${id}\n`);
    return 0;
  }
  if (provider.keyOptional && !options.model.length && !options.dryRun) {
    const advertised = await fetchModelIds(provider);
    options.model = advertised.filter((id) => !id.startsWith("group/"));
    if (!options.model.length) throw new ConfigError("gateway advertises no concrete models; pass --model");
    process.stdout.write(`  gateway models: ${options.model.length}\n`);
  }
  const models = planModels({ requested: options.model, provider, forgeModel: options.forgeModel, dryRun: options.dryRun });
  if (models.some((model) => model.placeholder)) {
    process.stdout.write("  model list empty: using placeholder MODEL_ID for the shape check; pass --model for a real matrix\n");
  }
  const profiles = options.profile.length ? options.profile : [DEFAULT_PROFILE];
  const personas = expandAxis(options.persona, listPersonas().map((persona) => persona.id).sort(), { allowNone: true });
  const transforms = expandAxis(options.transform, TRANSFORMS, { allowNone: true });
  const probeIds = options.probe;
  let probes = CORPUS.filter((probe) => !probeIds.length || probeIds.includes(probe.id));
  if (options.family.length) probes = probes.filter((probe) => options.family.includes(probe.family));
  if (options.excludeFamily.length) probes = probes.filter((probe) => !options.excludeFamily.includes(probe.family));
  if (!probes.length) throw new ConfigError(`no probes selected (known ids: ${CORPUS.map((probe) => probe.id).join(", ")})`);
  const unknownProbes = probeIds.filter((id) => !CORPUS.some((probe) => probe.id === id));
  if (unknownProbes.length) throw new ConfigError(`unknown probe(s): ${unknownProbes.join(", ")}`);

  options.maxTokens = options.maxTokens ? positiveInt(options.maxTokens, "max-tokens") : DEFAULT_MAX_TOKENS;
  options.temperature = options.temperature === undefined ? 0 : numberOption(options.temperature, "temperature");
  options.timeoutMs = options.timeoutMs ? positiveInt(options.timeoutMs, "timeout-ms", { min: 1000 }) : DEFAULT_TIMEOUT_MS;
  options.limit = options.limit ? positiveInt(options.limit, "limit") : 0;
  options.stuff = options.stuff ? positiveInt(options.stuff, "stuff", { min: 0 }) : 0;

  const plan = buildRequests({
    profiles,
    models,
    personas,
    transforms,
    probes,
    limit: options.limit,
    control: options.control,
    ladder: options.ladder,
    wrap: options.wrap,
    crescendo: options.crescendo,
    script: options.script || null,
    prefill: options.prefill || "",
    stuffTokens: options.stuff,
    strategy: options.strategy || null,
    repeat: Number(options.repeat) || 1,
  });

  plan.compiled = new Map();
  withTempRoot((tempRoot) => {
    for (const request of plan.sent) {
      const key = comboKey(request);
      if (!plan.compiled.has(key)) {
        try {
          plan.compiled.set(key, compilePrompt({ profile: request.profile, forge: request.forge, persona: request.persona, transform: request.transform, arm: request.arm }, { tempRoot }));
        } catch (error) {
          plan.compiled.set(key, { error: error.message });
          if (!(error instanceof ConfigError)) throw error;
        }
      }
    }
  });
  for (const value of plan.compiled.values()) {
    if (value.error) throw new ConfigError(value.error);
  }

  printMatrix({ profiles, models, personas, transforms, probes, plan, options });

  const secret = env[provider.keyEnv] || "";
  const keyPresent = provider.keyOptional || secret.trim().length > 0;
  const baseDocument = {
    schema: RESULTS_SCHEMA,
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    provider: { name: provider.name, kind: provider.kind, endpoint: requestUrl(provider, models[0].live), keyEnv: provider.keyEnv, keyPresent },
    matrix: { profiles, models, personas, transforms, probes: probes.map((probe) => probe.id), planned: plan.requests.length, sent: plan.sent.length },
    limits: { limit: options.limit || null, maxTokens: options.maxTokens, temperature: options.temperature, timeoutMs: options.timeoutMs },
    rows: [],
  };

  if (options.dryRun) {
    printRequestShape({ provider, request: plan.sent[0], compiled: plan.compiled.get(comboKey(plan.sent[0])), keyEnv: provider.keyEnv, keyPresent, options, publicKeyName: provider.keyEnv });
    if (options.dumpRequest) {
      const first = plan.sent[0];
      const conv = buildConversation(first.probe.request, { wrap: first.wrap, script: first.script, prefill: first.prefill, stuffTokens: first.stuffTokens });
      const body = requestBody(provider, { system: plan.compiled.get(comboKey(first)).text, user: conv.user, model: first.model, prefill: conv.prefill }, { maxTokens: options.maxTokens, temperature: options.temperature });
      const target = path.resolve(options.dumpRequest);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
      process.stdout.write(`  body written to ${options.dumpRequest}\n`);
    }
    if (options.out) writeResults(options.out, baseDocument);
    process.stdout.write(`\ndry-run · no network calls · ${plan.sent.length} request(s) planned\n`);
    return 0;
  }

  if (!keyPresent) {
    process.stderr.write(`missing env: ${provider.keyEnv}\n`);
    return 2;
  }

  const rows = [];
  process.stdout.write(`\nsending ${plan.sent.length} request(s) to ${provider.name} · ${requestUrl(provider, plan.sent[0].model)}\n`);
  for (const [index, request] of plan.sent.entries()) {
    const compiled = plan.compiled.get(comboKey(request));
    const response = await executeStrategyRequest(provider, {
      system: compiled.text,
      rawUser: request.probe.request,
      model: request.model,
      wrap: request.wrap,
      script: request.script,
      prefill: request.prefill,
      stuffTokens: request.stuffTokens,
    }, {
      key: secret,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
    });
    const row = makeRow({ request, compiled, response, secret });
    rows.push(row);
    const status = row.status === "ok" ? (row.refused ? "REFUSED" : "OK     ") : "ERROR  ";
    const detail = row.status === "ok"
      ? `${row.verdict}${row.refused ? `(${row.refusalSignal})` : ""} · ${row.latencyMs}ms · ${row.usage.prompt ?? "?"}/${row.usage.completion ?? "?"} tok · "${row.excerpt}"`
      : `${row.error}`;
    process.stdout.write(`  ${String(index + 1).padStart(2)}/${plan.sent.length} ${status} ${row.model} · ${row.arm} · ${row.rung} · ${row.probe} · ${detail}\n`);
  }

  const summary = summarize(rows);
  printSummary(summary);
  baseDocument.rows = rows;
  baseDocument.summary = summary;
  if (options.out) {
    const target = writeResults(options.out, baseDocument);
    process.stdout.write(`\nresults written to ${target}\n`);
  }
  if (rows.length && summary.calls === 0) return 1;
  return 0;
}

async function main() {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      if (error instanceof UsageError) process.stderr.write("run with --help for usage\n");
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`live matrix failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
