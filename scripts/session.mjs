#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadProfile, loadModel } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import {
  resolveForgeModelId,
  resolveProvider,
  sendWithBudget,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  excerpt,
} from "../core/gateway.mjs";
import {
  SESSION_ARMS,
  DEFAULT_MAX_TURNS,
  TURN_SHAPES,
  normalizeShape,
  armById,
  bestArm,
  readFamilyStats,
  createSession,
  loadSession,
  listSessions,
  archiveSession,
  buildTurn,
  systemVariants,
  noteTurn,
  stabilityOf,
  exportSession,
} from "../core/session.mjs";
import { familyFor, ladderFor } from "../core/families.mjs";

const OPTIONS = {
  model: { type: "string" },
  models: { type: "string" },
  task: { type: "string" },
  profile: { type: "string", default: "generic" },
  family: { type: "string" },
  strategy: { type: "string", default: "auto" },
  system: { type: "string" },
  arm: { type: "string" },
  state: { type: "string" },
  "max-turns": { type: "string" },
  reply: { type: "string" },
  status: { type: "string" },
  error: { type: "string" },
  "finish-reason": { type: "string" },
  provider: { type: "string" },
  gateway: { type: "string" },
  config: { type: "string" },
  "base-url": { type: "string" },
  "key-env": { type: "string" },
  "max-tokens": { type: "string" },
  temperature: { type: "string" },
  "timeout-ms": { type: "string" },
  send: { type: "boolean", default: false },
  turns: { type: "string" },
  out: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
};

function envOf(options) {
  return options?.state ? { stateRoot: options.state } : {};
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Compile one system prompt per arm so every turn starts from the same frame. */
function buildSystems(profileId, modelId) {
  const profile = loadProfile(profileId);
  const forgeId = resolveForgeModelId(modelId);
  const model = loadModel(forgeId);
  const systems = {};
  for (const arm of SESSION_ARMS) {
    const persona = arm.persona && arm.persona !== "none" ? arm.persona : null;
    const plan = compile(profile, model, { persona });
    systems[arm.id] = plan.prompt.text;
  }
  return systems;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function shortArm(session) {
  const stability = stabilityOf(session);
  return `${session.id}  family=${session.family}  arm=${session.arm}  turns=${stability.turns}  delivered=${stability.delivered}/${stability.attempts}  stable=${stability.stable}`;
}

export async function sendTurn(session, turn, options = {}) {
  const provider = resolveProvider({
    options: {
      provider: options.provider,
      gateway: options.gateway,
      config: options.config,
      baseUrl: options["base-url"],
      keyEnv: options["key-env"],
    },
  });
  const maxTokens = num(options["max-tokens"], turn.maxTokensHint || DEFAULT_MAX_TOKENS);
  const temperature = Number(options.temperature) || 0;
  const timeoutMs = num(options["timeout-ms"], DEFAULT_TIMEOUT_MS);
  const key = provider.keyEnv ? process.env[provider.keyEnv] : "";
  const descriptorOf = (candidate) => {
    const turns = [...candidate.messages];
    if (turn.prefill) turns.push({ role: "assistant", content: turn.prefill });
    // sendRequest builds the HTTP body from this descriptor (system/user/model/turns).
    return { system: candidate.system, model: session.model, turns };
  };
  // Start where the previous turn got through; a fresh session starts with the full prelude.
  const shapeOrder = shapeVariants(session);
  const variants = [];
  for (const shape of shapeOrder) {
    for (const variant of systemVariants(session, turn, { start: session.systemMode || "full", shape })) variants.push(variant);
  }
  // A stall costs a full timeout, so a shape that hangs is abandoned after one
  // try and the next packing is used; an explicit rejection is cheap and walks
  // the whole list. Probing uses retries:0 to avoid multiplying timeouts.
  const stalled = new Set();
  let last = null;
  for (const [index, variant] of variants.entries()) {
    if (stalled.has(variant.shape)) continue;
    const request = descriptorOf(variant);
    const retries = index === variants.length - 1 ? 1 : 0;
    const reqOpts = { key, maxTokens, temperature, timeoutMs, retries };
    if (options.fetchImpl) reqOpts.fetchImpl = options.fetchImpl;
    const response = await sendWithBudget(provider, request, reqOpts);
    if (response.status === "ok") return { response, request, systemMode: variant.mode, shape: variant.shape };
    last = { response, request, systemMode: variant.mode, shape: variant.shape };
    if (/timeout/i.test(String(response.error || ""))) {
      stalled.add(variant.shape);
      continue;
    }
    if (!variantRejected(response, variant)) return last;
  }
  return last;
}

/**
 * Message shapes to try, learned first.
 *
 * A reachable endpoint can answer a lone user message and reject the identical
 * request as a two-message conversation, so replay is a transport choice like
 * placement is. The shape that worked is remembered per session.
 */
function shapeVariants(session) {
  const learned = normalizeShape(session.shape);
  const order = [learned, ...TURN_SHAPES.filter((shape) => shape !== learned)];
  return order;
}

const SINGLE_REJECT_STATUSES = new Set([400, 413, 415, 422, 500]);
const HISTORY_REJECT_STATUSES = new Set([400, 404, 413, 415, 422, 500]);

/**
 * True when the failure is about how the request was packed or placed,
 * rather than an unrecoverable auth/upstream error or final bare attempt.
 */
export function variantRejected(response, variant) {
  if (!response || variant?.shape === "bare") return false;
  if (response.status === "network_error") return /timeout/i.test(String(response.error || ""));
  if (response.status === "http_error") {
    const status = Number(response.httpStatus) || 0;
    const allowed = variant?.shape === "single" ? SINGLE_REJECT_STATUSES : HISTORY_REJECT_STATUSES;
    if (allowed.has(status)) return true;
    return /system|message|param|conversation|turns|role|invalid_request/i.test(String(response.error || ""));
  }
  return false;
}

function commandStart(options) {
  if (!options.model) throw new Error("start needs --model");
  if (!options.task) throw new Error("start needs --task");
  const env = envOf(options);
  const systems = buildSystems(options.profile, options.model);
  const session = createSession({
    model: options.model,
    task: options.task,
    system: options.system || "",
    systems,
    profile: options.profile,
    family: options.family || null,
    strategy: options.strategy,
    maxTurns: num(options["max-turns"], DEFAULT_MAX_TURNS),
    env,
  });
  if (options.json) return printJson(session);
  process.stdout.write(`${shortArm(session)}\n`);
  process.stdout.write(`ladder: ${ladderFor(session.family).join(" -> ")}\n`);
  process.stdout.write(`next: dsh-session turn ${session.id}\n`);
}

async function commandTurn(options, positionals) {
  const id = positionals[0];
  if (!id) throw new Error("turn needs a session id");
  const env = envOf(options);
  const session = loadSession(id, { env });
  const turn = buildTurn(session, { task: options.task || null, arm: options.arm || null });
  if (!options.send) {
    if (options.json) return printJson(turn);
    process.stdout.write(`turn ${turn.turn} arm=${turn.arm} model=${session.model}\n`);
    process.stdout.write(`system: ${turn.system.length} chars\n`);
    process.stdout.write(`user: ${turn.user}\n`);
    return;
  }
  const { response, systemMode, shape } = await sendTurn(session, turn, options);
  const result = noteTurn(session, {
    reply: response.reply,
    status: response.status,
    error: response.error,
    finishReason: response.finishReason,
    providerFlag: response.providerFlag,
    latencyMs: response.latencyMs,
    usage: response.usage,
    prompt: turn.user,
    arm: turn.arm,
    systemMode,
    shape,
    env,
  });
  if (options.json) return printJson({ verdict: result.verdict, recovery: result.recovery, systemMode, shape, stability: stabilityOf(result.session) });
  process.stdout.write(`turn ${result.session.turns.length} arm=${turn.arm} verdict=${result.verdict} nextArm=${result.session.arm} systemMode=${systemMode} shape=${shape}\n`);
  if (response.status && response.status !== "ok") process.stdout.write(`status=${response.status} error=${response.error || ""}\n`);
  process.stdout.write(`${excerpt(response.reply, 500)}\n`);
}

function commandRecord(options, positionals) {
  const id = positionals[0];
  if (!id) throw new Error("record needs a session id");
  const env = envOf(options);
  let reply = options.reply ?? "";
  if (reply === "-") reply = fs.readFileSync(0, "utf8");
  const session = loadSession(id, { env });
  const prompt = options.task ? buildTurn(session, { task: options.task }).user : "";
  const result = noteTurn(session, {
    reply,
    status: options.status || "ok",
    error: options.error || null,
    finishReason: options["finish-reason"] || null,
    arm: options.arm || null,
    prompt,
    env,
  });
  if (options.json) return printJson({ verdict: result.verdict, recovery: result.recovery, stability: stabilityOf(result.session) });
  process.stdout.write(`recorded turn ${result.session.turns.length} verdict=${result.verdict} nextArm=${result.session.arm}\n`);
}

function commandStatus(options, positionals) {
  const id = positionals[0];
  if (!id) throw new Error("status needs a session id");
  const session = loadSession(id, { env: envOf(options) });
  const stability = stabilityOf(session);
  if (options.json) return printJson({ session, stability });
  process.stdout.write(`${shortArm(session)}\n`);
  process.stdout.write(`rate=${stability.deliveredRate}% longestStreak=${stability.longestFailureStreak} status=${stability.status}\n`);
  for (const arm of stability.arms) {
    process.stdout.write(`  ${arm.id.padEnd(18)} pulls=${arm.pulls} wins=${arm.wins} rate=${arm.rate ?? "-"}\n`);
  }
}

function commandList(options) {
  const rows = listSessions({ env: envOf(options) });
  if (options.json) return printJson(rows);
  if (!rows.length) return process.stdout.write("no sessions\n");
  for (const row of rows) {
    process.stdout.write(`${row.id}  ${row.model}  ${row.family}  arm=${row.arm}  turns=${row.turns}  ${row.status}\n`);
  }
}

function commandExport(options, positionals) {
  const id = positionals[0];
  if (!id) throw new Error("export needs a session id");
  const session = loadSession(id, { env: envOf(options) });
  const payload = exportSession(session);
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.out) {
    fs.writeFileSync(path.resolve(options.out), text);
    process.stdout.write(`wrote ${options.out}\n`);
  } else {
    process.stdout.write(text);
  }
}

function commandArchive(options, positionals) {
  const id = positionals[0];
  if (!id) throw new Error("archive needs a session id");
  const result = archiveSession(id, { env: envOf(options) });
  process.stdout.write(`archived ${result.id}\n`);
}

async function commandMatrix(options) {
  const models = String(options.models || options.model || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!models.length) throw new Error("matrix needs --models a,b,c");
  if (!options.task) throw new Error("matrix needs --task");
  const env = envOf(options);
  const turns = num(options.turns, 3);
  const table = [];
  for (const model of models) {
    // Without --send the run is a pure planning preview: never write sessions,
    // arm scores, or family priors to disk.
    if (!options.send) {
      const family = familyFor(model);
      const ladder = ladderFor(family.id);
      const prior = readFamilyStats(family.id, { env });
      const seeded = Object.values(prior.arms || {}).some((row) => (row?.pulls || 0) > 0);
      const arm = options.strategy && options.strategy !== "auto"
        ? armById(options.strategy).id
        : (seeded ? bestArm({ family: family.id, arms: prior.arms }) : ladder[0]);
      table.push({
        model,
        family: family.id,
        session: "(dry-run)",
        systemMode: "full",
        shape: "history",
        turns: 0,
        attempts: 0,
        delivered: 0,
        deliveredRate: 0,
        longestFailureStreak: 0,
        stable: false,
        plan: Array(turns).fill(arm),
        dryRun: true,
      });
      continue;
    }
    const systems = buildSystems(options.profile, model);
    const session = createSession({
      model,
      task: options.task,
      systems,
      profile: options.profile,
      strategy: options.strategy,
      maxTurns: Math.max(4, turns + 2),
      env,
    });
    for (let index = 0; index < turns; index += 1) {
      const turn = buildTurn(session, {});
      const { response, systemMode, shape } = await sendTurn(session, turn, options);
      noteTurn(session, {
        reply: response.reply,
        status: response.status,
        error: response.error,
        finishReason: response.finishReason,
        providerFlag: response.providerFlag,
        latencyMs: response.latencyMs,
        usage: response.usage,
        prompt: turn.user,
        arm: turn.arm,
        systemMode,
        shape,
        env,
      });
      if (session.status !== "active") break;
    }
    const stability = stabilityOf(session);
    table.push({ model, family: session.family, session: session.id, systemMode: session.systemMode, shape: session.shape, ...stability });
  }
  if (options.json) return printJson(table);
  process.stdout.write("model                 family    turns  delivered  rate  streak  stable  mode    shape\n");
  for (const row of table) {
    process.stdout.write(
      `${row.model.padEnd(21)} ${String(row.family).padEnd(9)} ${String(row.turns).padEnd(6)} ${String(`${row.delivered}/${row.attempts}`).padEnd(10)} ${String(`${row.deliveredRate}%`).padEnd(5)} ${String(row.longestFailureStreak).padEnd(7)} ${String(row.stable).padEnd(7)} ${String(row.systemMode).padEnd(7)} ${row.shape}\n`,
    );
  }
}

const HELP = `promptkeel-session (compat: dsh-session) — persistent, stability-tracked multi-model delivery sessions

usage:
  promptkeel-session start --model <id> --task <text> [--profile generic] [--strategy auto|<arm>] [--max-turns N] [--state <dir>]
  promptkeel-session turn <id> [--task text] [--arm arm] [--send] [--provider openai|anthropic|glm|gateway] [--gateway URL] [--state <dir>]
  promptkeel-session record <id> --reply <text|-> [--status ok|error] [--error msg] [--state <dir>]
  promptkeel-session status <id> [--json] [--state <dir>]
  promptkeel-session list [--json] [--state <dir>]
  promptkeel-session export <id> [--out file] [--state <dir>]
  promptkeel-session archive <id> [--state <dir>]
  promptkeel-session matrix --models a,b,c --task <text> [--turns N] [--send] [--state <dir>]

notes:
  - sessions persist under <state-root>/sessions; state root defaults to ~/.promptkeel (overridden by --state, PROMPTKEEL_STATE, DSH_FORGE_KIT_STATE, or DSH_FORGE_STATE)
  - every turn re-asserts the task frame; a withheld/blocked turn escalates to the next arm in the model family ladder
  - --send requires the provider API key in its environment variable (e.g. OPENAI_API_KEY)
  - a turn degrades on its own: message shape history -> single -> bare, and system placement
    full -> inline -> lock -> bare; whatever gets through is remembered for later turns
`;

export async function sessionMain(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const command = positionals.shift();
  switch (command) {
    case "start":
      commandStart(values);
      return 0;
    case "turn":
      await commandTurn(values, positionals);
      return 0;
    case "record":
      commandRecord(values, positionals);
      return 0;
    case "status":
      commandStatus(values, positionals);
      return 0;
    case "list":
      commandList(values);
      return 0;
    case "export":
      commandExport(values, positionals);
      return 0;
    case "archive":
      commandArchive(values, positionals);
      return 0;
    case "matrix":
      await commandMatrix(values);
      return 0;
    default:
      process.stdout.write(HELP);
      return command ? 1 : 0;
  }
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) {
  sessionMain(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(`${error && error.code ? `[${error.code}] ` : ""}${error?.message || error}\n`);
    process.exit(1);
  });
}
