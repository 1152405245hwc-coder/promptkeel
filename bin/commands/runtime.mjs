import { loadProfile, loadModel } from "../../core/contract.mjs";
import { compile, normalizeContext } from "../../core/compile.mjs";
import { STRATEGIES, resolveStrategy, buildConversation } from "../../core/strategy.mjs";
import { resolveProvider, resolveForgeModelId, executeStrategyRequest, detectRefusal, verdictOf, complianceOf, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS } from "../../core/gateway.mjs";
import { acquireLock, createConsole, renderOverview, CONSOLE_HOST, CONSOLE_PORT } from "../../core/console.mjs";
import { consoleState, createConsoleHandlers } from "../../lib/console-state.mjs";
import { defaultLogFile, log, setLogFile } from "../../lib/log.mjs";
import { positional, flags, optionValue, out, banner, stateRootPath } from "./shared.mjs";

export function cmdConsole() {
  const stateRoot = stateRootPath();
  const projectRoot = optionValue("project", process.cwd());
  const home = optionValue("home", process.env.HOME || process.env.USERPROFILE);
  const dshHomeOpt = optionValue("dsh-home", null);
  const hostRootOpt = optionValue("host-root", process.env.DSH_FORGE_KIT_HOST_ROOT || process.env.DSH_FORGE_HOST_ROOT || undefined);
  const env = {
    stateRoot,
    projectRoot,
    home,
    ...(dshHomeOpt ? { dshHome: dshHomeOpt } : {}),
    ...(hostRootOpt ? { hostRoot: hostRootOpt } : {}),
  };
  const state = () => consoleState(env, { projectRoot });
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
  const server = createConsole({ state, env, handlers: createConsoleHandlers(env), port });
  server.on("error", (error) => {
    lock.release();
    process.exitCode = 1;
    out({ ok: false, code: "console-listen", error: error.message }, true);
  });
  server.listen(port, CONSOLE_HOST, () => {
    const actual = server.address().port;
    setLogFile(defaultLogFile({ stateRoot }));
    log("console.start", { port: actual });
    banner(`console http://${CONSOLE_HOST}:${actual}`);
    process.stdout.write(`workbench · state ${stateRoot} · ctrl-c to stop\n`);
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

export function cmdStrategies() {
  if (flags.has("--json")) return out({ ok: true, strategies: STRATEGIES }, true);
  banner(`strategies ${STRATEGIES.length}`);
  for (const s of STRATEGIES) {
    process.stdout.write(`${s.id.padEnd(18)} wrap=${s.wrap.padEnd(8)} script=${String(s.script || "-").padEnd(9)} stuff=${String(s.stuffTokens).padEnd(5)} ${s.label}\n`);
  }
}

export async function cmdRun() {
  const rawPrompt = optionValue("prompt-text", positional.join(" ") || null);
  if (!rawPrompt) {
    process.exitCode = 2;
    return out({ ok: false, code: "run-prompt", error: "pass --prompt-text <text> or a positional prompt" }, true);
  }
  const strat = resolveStrategy({
    strategy: optionValue("strategy", null),
    persona: optionValue("persona", null),
    transform: optionValue("transform", null),
    wrap: optionValue("wrap", null),
    script: optionValue("script", null),
    prefill: optionValue("prefill", null),
    stuffTokens: optionValue("stuff", null),
  });
  const profileId = optionValue("forge-profile", optionValue("profile", "generic"));
  const profile = loadProfile(profileId);
  const liveModel = optionValue("model", profile.model || "deepseek");
  const modelId = resolveForgeModelId(optionValue("forge-model", null) || liveModel, profile.model || "deepseek");
  const model = loadModel(modelId);
  const plan = compile(profile, model, normalizeContext({
    hostId: profile.host,
    profileId: profile.id,
    mode: optionValue("mode", null),
    persona: strat.persona && strat.persona !== "none" ? strat.persona : null,
    personaMode: optionValue("persona-mode", null),
    transform: strat.transform,
    home: optionValue("home", process.env.HOME || process.env.USERPROFILE),
    projectRoot: optionValue("project", process.cwd()),
    budget: Number(optionValue("budget", 3200)),
  }));
  const provider = resolveProvider({
    options: {
      gateway: optionValue("gateway", null) || (optionValue("provider", null) ? null : "default"),
      provider: optionValue("provider", null),
      baseUrl: optionValue("base-url", null),
      keyEnv: optionValue("key-env", null),
    },
    env: process.env,
  });
  const maxTokens = Number(optionValue("max-tokens", DEFAULT_MAX_TOKENS)) || DEFAULT_MAX_TOKENS;
  const timeoutMs = Number(optionValue("timeout-ms", DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS;
  const temperature = Number(optionValue("temperature", 0)) || 0;
  if (flags.has("--dry-run")) {
    const conv = buildConversation(rawPrompt, strat);
    return out({ ok: true, dryRun: true, provider: provider.name, model: liveModel, forgeModel: model.id, mode: plan.mode, strategy: conv.strategy, systemTokens: plan.prompt.tokens, conversation: conv }, flags.has("--json"));
  }
  const key = provider.keyOptional ? "" : (process.env[provider.keyEnv] || "");
  if (!provider.keyOptional && !key) {
    process.exitCode = 2;
    return out({ ok: false, code: "provider-key", error: `missing env: ${provider.keyEnv}` }, true);
  }
  const res = await executeStrategyRequest(provider, {
    system: plan.prompt.text,
    rawUser: rawPrompt,
    model: liveModel,
    ...strat,
  }, { key, maxTokens, temperature, timeoutMs });
  const refusal = res.status === "ok" ? detectRefusal(res.reply, { finishReason: res.finishReason, providerFlag: res.providerFlag }) : { refused: null, signal: null };
  const verdict = verdictOf(res, refusal);
  const payload = {
    ok: res.status === "ok",
    model: liveModel,
    forgeModel: model.id,
    mode: plan.mode,
    provider: provider.name,
    strategy: res.strategyUsed || strat,
    verdict,
    compliance: res.status === "ok" ? complianceOf(res.reply) : null,
    refused: refusal.refused,
    refusalSignal: refusal.signal,
    turns: res.turns,
    latencyMs: res.latencyMs,
    usage: res.usage || null,
    reply: res.reply || null,
    error: res.error || null,
  };
  if (flags.has("--json")) return out(payload, true);
  banner(`run ${liveModel} · ${verdict} (${res.latencyMs ?? 0}ms)`);
  if (res.status === "ok") process.stdout.write(`${res.reply}\n`);
  else process.stderr.write(`${res.error}\n`);
  if (res.status !== "ok") process.exitCode = 1;
}
