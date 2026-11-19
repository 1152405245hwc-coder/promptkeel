import path from "node:path";
import { parseArgs } from "node:util";
import { loadProfile, loadModel } from "../../core/contract.mjs";
import { compile, normalizeContext } from "../../core/compile.mjs";
import { defaultStateRoot } from "../../core/executor.mjs";
import { VERSION } from "../../lib/paths.mjs";

const PARSE_OPTIONS = {
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
  transform: { type: "string" },
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
  "dsh-home": { type: "string" },
  keep: { type: "string" },
  days: { type: "string" },
  "max-bytes": { type: "string" },
  list: { type: "boolean" },
  state: { type: "string" },
  preview: { type: "string" },
  strategy: { type: "string" },
  wrap: { type: "string" },
  script: { type: "string" },
  prefill: { type: "string" },
  stuff: { type: "string" },
  gateway: { type: "string" },
  provider: { type: "string" },
  "base-url": { type: "string" },
  "key-env": { type: "string" },
  "max-tokens": { type: "string" },
  "forge-model": { type: "string" },
  "timeout-ms": { type: "string" },
  temperature: { type: "string" },
  "prompt-text": { type: "string" },
};

export let opts = {};
export let command = "help";
export let positional = [];

export function initCli(argv = process.argv.slice(2)) {
  if (argv[0] === "session") {
    opts = {};
    command = "session";
    positional = argv.slice(1);
    return { opts, command, positional, flags };
  }
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: PARSE_OPTIONS,
  });
  opts = parsed.values;
  if (opts["host-root"]) {
    process.env.PROMPTKEEL_HOST_ROOT = opts["host-root"];
    process.env.DSH_FORGE_KIT_HOST_ROOT = opts["host-root"];
    process.env.DSH_FORGE_HOST_ROOT = opts["host-root"];
  }
  if (opts.profile && ["desktop", "web"].includes(opts.profile)) {
    process.env.PROMPTKEEL_PROFILE = opts.profile;
    process.env.DSH_FORGE_KIT_PROFILE = opts.profile;
    process.env.DSH_FORGE_PROFILE = opts.profile;
  }
  command = opts.version ? "version" : opts.help ? "help" : (parsed.positionals[0] || "help");
  positional = parsed.positionals.slice(1);
  return { opts, command, positional, flags };
}

export const flags = {
  has: (name) => Boolean(opts[name.replace(/^--/, "")]),
};

export function optionValue(name, fallback = null) {
  const val = opts[name];
  return typeof val === "string" && val.length > 0 ? val : fallback;
}

export function out(value, json = flags.has("--json")) {
  if (json) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    return;
  }
  if (typeof value === "string") process.stdout.write(value + "\n");
  else process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function banner(text) {
  process.stdout.write(`\n${text}\n${"-".repeat(text.length)}\n`);
}

export function stateRootPath() {
  const explicitState = optionValue("state", null);
  const explicitHome = optionValue("home", null);
  return explicitState || defaultStateRoot(explicitHome ? { home: explicitHome } : {});
}

export function forgeContext() {
  const profileId = optionValue("forge-profile", optionValue("profile", positional[0] || "dsh"));
  const profile = loadProfile(profileId);
  const modelId = optionValue("model", profile.model || "deepseek");
  const model = loadModel(modelId);
  // Keep the executor environment as a flat object. The compile context also
  // exposes these values at the top level so adapters can observe the same
  // host/state selection as the executor.
  const explicitState = optionValue("state", null);
  const explicitHome = optionValue("home", null);
  const stateRoot = explicitState || defaultStateRoot(explicitHome ? { home: explicitHome } : {});
  const hostRoot = optionValue("host-root", process.env.PROMPTKEEL_HOST_ROOT || process.env.DSH_FORGE_KIT_HOST_ROOT || process.env.DSH_FORGE_HOST_ROOT || undefined);
  const home = explicitHome || process.env.HOME || process.env.USERPROFILE;
  const context = normalizeContext({
    hostId: profile.host,
    profileId: profile.id,
    mode: optionValue("mode", null),
    persona: optionValue("persona", null),
    personaMode: optionValue("persona-mode", null),
    transform: optionValue("transform", null),
    projectRoot: optionValue("project", process.cwd()),
    home,
    budget: Number(optionValue("budget", 3200)),
    env: { stateRoot, hostRoot, dshHome: home ? path.join(home, ".dsh") : undefined },
  });
  const plan = compile(profile, model, context);
  return { profile, model, plan, context };
}

export function usage() {
  out(`PromptKeel ${VERSION} (CLI: promptkeel / promptkeel-session; compat: dsh-forge / dsh-session)

Usage:
  promptkeel doctor [--json]                     run 12 host checks
  promptkeel status [--json]                     doctor + policy + profile + backups
  promptkeel apply [--dry-run|--yes]             apply host patches (unpacks app.asar if needed)
  promptkeel unpack [--dry-run|--yes]            unpack sealed app.asar into Resources/app
  promptkeel upgrade [--dry-run|--yes]           refresh patches after upgrade or DSH update
  promptkeel revert [--id <backup>] [--force]    restore files from backup manifest
  promptkeel verify [--json]                     check patches, prompt channel, and session log
  promptkeel explain <patch-id>                  show anchor match count and file preview
  promptkeel adapt [--json]                      check anchor status across all patches
  promptkeel profile [status|enable|disable] [--profile desktop]
  promptkeel prompt compose [--adapter deepseek] [--mode coding] [--out file] [--budget 3200]
  promptkeel prompt install                      write ~/.dsh/prompt-inject.md (with backup)
  promptkeel preset [strict|fallback|always]
  promptkeel collect                             export redacted diagnostics tarball
  promptkeel log [--limit 50|--clear]
  promptkeel audit [--limit 100] [--json]        read the operation log across days
  promptkeel snapshot [profile] [--keep 5] [--days 7] [--max-bytes N] [--list] [--json]
  promptkeel personas [--json]                   list bundled personas
  promptkeel transforms [--json]                 list payload transforms and round-trip status
  promptkeel probe [profile] [--persona <id>] [--transform <kind>] [--json]   run the static probe harness
  promptkeel channels [--all] [--json]           show delivery channel per action
  promptkeel grades [--json]                     show how much of the host prompt each profile displaces
  promptkeel console [--port 7788] [--state <dir>]   serve interactive workbench on 127.0.0.1
  promptkeel console --once [--json]             render the overview page and exit
  promptkeel run --prompt-text <text> [--strategy <id>] [--mode <mode>] [--gateway default] [--model <live>] [--forge-model <id>]
  promptkeel strategies [--json]                 list delivery & breakout strategies
  promptkeel session <start|turn|record|status|list|export|archive|matrix> [...]
  promptkeel shim --binary <path> [--prompt <file>] [--env K=V] [--out <file>]
  promptkeel compile [profile] [--model <id>] [--mode <mode>] [--persona <id>] [--persona-mode off|replace|strict|append] [--transform base64|rot13|leet|vowels|morse|ascii|reverse|split] [--home <dir>] [--project <dir>] [--budget 3200] [--out plan.json]
  promptkeel apply --profile <profile> [--model <model>] [--home <dir>] [--project <dir>] [--state <dir>] [--preview file] [--dry-run|--yes]
  promptkeel plans [--json]
  promptkeel verify-plan <plan-id> [--json]
  promptkeel revert-plan <plan-id> [--force]
  promptkeel profiles [--json]
  promptkeel hosts [--json]
  promptkeel models [--json]

Environment:
  DSH_HOME                    default ~/.dsh
  PROMPTKEEL_STATE            default ~/.promptkeel (legacy: DSH_FORGE_KIT_STATE, DSH_FORGE_STATE)
  PROMPTKEEL_PROFILE          default desktop (legacy: DSH_FORGE_KIT_PROFILE, DSH_FORGE_PROFILE)
  PROMPTKEEL_HOST_ROOT        override host root (or pass --host-root; legacy: DSH_FORGE_HOST_ROOT)
  DSH_FORGE_DEBUG=1           verbose event log`);
}
