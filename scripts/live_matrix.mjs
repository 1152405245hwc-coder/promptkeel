#!/usr/bin/env node
/**
 * Live matrix runner: composes each prompt with `promptkeel compile`, applies
 * strategy layers from `core/strategy.mjs`, sends bounded requests through
 * `core/gateway.mjs`, and classifies refusal vs. compliance verdicts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as probeCore from "../core/probe.mjs";
import { loadProfile, loadModel } from "../core/contract.mjs";
import { compile, normalizeContext } from "../core/compile.mjs";
import { listPersonas } from "../core/persona.mjs";
import { TRANSFORMS } from "../core/transform.mjs";
import {
  STRATEGIES,
  buildConversation,
  buildRequests,
} from "../core/strategy.mjs";
import {
  MAGPIE_DEFAULT_BASE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  CLASSIFIER_VERSION,
  classifierHash,
  GatewayConfigError as ConfigError,
  resolveProvider,
  requestUrl,
  authHeaders,
  fetchModelIds,
  planModels,
  requestBody,
  placeSystem,
  executeStrategyRequest,
  makeRow,
  summarize,
} from "../core/gateway.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CORPUS = probeCore.PROBES;
export const DEFAULT_PROFILE = "generic";
export const RESULTS_SCHEMA = "forge.live-matrix/v1";

export { placeSystem };

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
  --compare <a,b>             run two strategies interleaved, alternating order per sample
  --control                   include a prompt-free control arm per model/probe
  --ladder                    run four rungs: direct, persona, cipher, prefill
  --wrap variable             wrap user prompt in Z=[...] assignment
  --crescendo                 two-turn outline -> fill script
  --script <name>             multi-turn script: crescendo, deep, layered
  --prefill <text>            assistant prefill prefix (single-turn only)
  --stuff <tokens>            pad with neutral engineering context tokens
  --system-mode <mode>        system placement: full (default), inline, bare

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
  --concurrency <n>           max concurrent requests (1..8); default 1
  --cooldown-ms <n>           delay between requests in ms; default 0
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
  "timeout-ms", "concurrency", "cooldown-ms", "repeat", "stuff", "compare",
  "limit", "out", "dump-request", "forge-model", "gateway", "wrap", "prefill",
  "script", "strategy", "system-mode",
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
    wrap: "none", systemMode: "full", help: false,
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
  const args = [path.join(ROOT, "bin", "promptkeel.js"), "compile", "--profile", profile, "--model", forge];
  if (persona && persona !== "none") args.push("--persona", persona);
  if (transform && transform !== "none") args.push("--transform", transform);
  return args;
}

export function compilePrompt(combo) {
  if (combo.arm === "control") {
    return { text: "", tokens: 0, budget: null, planId: null, personaId: null, transform: "none", cli: "(control arm: no system prompt)" };
  }
  try {
    const profile = loadProfile(combo.profile);
    const model = loadModel(combo.forge);
    const persona = combo.persona && combo.persona !== "none" ? combo.persona : null;
    const transform = combo.transform && combo.transform !== "none" ? combo.transform : null;
    const context = normalizeContext({
      hostId: profile.host,
      profileId: profile.id,
      persona,
      transform,
      projectRoot: ROOT,
      home: process.env.HOME || process.env.USERPROFILE || "/tmp",
    });
    const plan = compile(profile, model, context);
    const text = plan?.prompt?.text;
    if (typeof text !== "string" || !text) throw new ConfigError(`compile produced no prompt text for ${combo.profile}/${combo.forge}`);
    return {
      text,
      tokens: plan.prompt.tokens ?? null,
      budget: plan.budget || null,
      planId: plan.planId || null,
      personaId: plan.persona?.id || null,
      transform: plan.transform || (plan.prompt.transform ?? "none"),
      cli: `node bin/promptkeel.js ${compileCommand(combo).slice(1).join(" ")}`,
    };
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`compile failed for ${combo.profile}/${combo.forge}/${combo.persona}/${combo.transform}: ${error?.message || error}`);
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
  const firstUser = conv.scriptSteps ? `${conv.scriptSteps[0]}\n\n${conv.user}` : conv.user;
  const placed = placeSystem(compiled.text, firstUser, options.systemMode);
  const body = requestBody(provider, { system: placed.system, user: placed.user, model: request.model, prefill: conv.prefill }, { maxTokens, temperature });
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
  options.concurrency = options.concurrency ? positiveInt(options.concurrency, "concurrency", { min: 1, max: 8 }) : 1;
  options.cooldownMs = options.cooldownMs ? positiveInt(options.cooldownMs, "cooldown-ms", { min: 0 }) : 0;
  if (!["full", "inline", "bare"].includes(options.systemMode)) {
    throw new UsageError(`--system-mode must be full, inline, or bare`);
  }
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
    compare: options.compare ? String(options.compare).split(",").map((v) => v.trim()).filter(Boolean) : null,
    repeat: Number(options.repeat) || 1,
  });

  plan.compiled = new Map();
  for (const request of plan.sent) {
    const key = comboKey(request);
    if (!plan.compiled.has(key)) {
      try {
        plan.compiled.set(key, compilePrompt({ profile: request.profile, forge: request.forge, persona: request.persona, transform: request.transform, arm: request.arm }));
      } catch (error) {
        plan.compiled.set(key, { error: error.message });
        if (!(error instanceof ConfigError)) throw error;
      }
    }
  }
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
    classifierVersion: CLASSIFIER_VERSION,
    classifierHash: classifierHash(),
    systemMode: options.systemMode,
    provider: { name: provider.name, kind: provider.kind, endpoint: requestUrl(provider, models[0].live), keyEnv: provider.keyEnv, keyPresent },
    matrix: { profiles, models, personas, transforms, probes: probes.map((probe) => probe.id), planned: plan.requests.length, sent: plan.sent.length },
    limits: { limit: options.limit || null, maxTokens: options.maxTokens, temperature: options.temperature, timeoutMs: options.timeoutMs, concurrency: options.concurrency, cooldownMs: options.cooldownMs },
    rows: [],
  };

  if (options.dryRun) {
    printRequestShape({ provider, request: plan.sent[0], compiled: plan.compiled.get(comboKey(plan.sent[0])), keyEnv: provider.keyEnv, keyPresent, options, publicKeyName: provider.keyEnv });
    if (options.dumpRequest) {
      const first = plan.sent[0];
      const conv = buildConversation(first.probe.request, { wrap: first.wrap, script: first.script, prefill: first.prefill, stuffTokens: first.stuffTokens });
      const firstUser = conv.scriptSteps ? `${conv.scriptSteps[0]}\n\n${conv.user}` : conv.user;
      const dumpPlaced = placeSystem(plan.compiled.get(comboKey(first)).text, firstUser, options.systemMode);
      const body = requestBody(provider, { system: dumpPlaced.system, user: dumpPlaced.user, model: first.model, prefill: conv.prefill }, { maxTokens: options.maxTokens, temperature: options.temperature });
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

  const rows = new Array(plan.sent.length);
  process.stdout.write(`\nsending ${plan.sent.length} request(s) to ${provider.name} · ${requestUrl(provider, plan.sent[0].model)}\n`);
  let cursor = 0;
  const workerCount = Math.min(options.concurrency, Math.max(1, plan.sent.length));
  async function runOne(index) {
    const request = plan.sent[index];
    const compiled = plan.compiled.get(comboKey(request));
    const response = await executeStrategyRequest(provider, {
      system: compiled.text,
      rawUser: request.probe.request,
      model: request.model,
      wrap: request.wrap,
      script: request.script,
      prefill: request.prefill,
      stuffTokens: request.stuffTokens,
      systemMode: options.systemMode,
    }, {
      key: secret,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
    });
    const row = makeRow({ request, compiled, response, secret });
    rows[index] = row;
    const status = row.status === "ok" ? (row.refused ? "REFUSED" : "OK     ") : "ERROR  ";
    const detail = row.status === "ok"
      ? `${row.verdict}${row.refused ? `(${row.refusalSignal})` : ""} · ${row.latencyMs}ms · ${row.usage.prompt ?? "?"}/${row.usage.completion ?? "?"} tok · "${row.excerpt}"`
      : `${row.error}`;
    process.stdout.write(`  ${String(index + 1).padStart(2)}/${plan.sent.length} ${status} ${row.model} · ${row.arm} · ${row.rung} · ${row.probe} · ${detail}\n`);
  }
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < plan.sent.length) {
      const index = cursor;
      cursor += 1;
      await runOne(index);
      if (options.cooldownMs > 0 && cursor < plan.sent.length) {
        await new Promise((resolve) => setTimeout(resolve, options.cooldownMs));
      }
    }
  }));

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
