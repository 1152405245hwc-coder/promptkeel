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
    process.env.DSH_FORGE_KIT_HOST_ROOT = opts["host-root"];
    process.env.DSH_FORGE_HOST_ROOT = opts["host-root"];
  }
  if (opts.profile && ["desktop", "web"].includes(opts.profile)) {
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
  const hostRoot = optionValue("host-root", process.env.DSH_FORGE_KIT_HOST_ROOT || process.env.DSH_FORGE_HOST_ROOT || undefined);
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
  out(`dsh-forge-kit ${VERSION} (CLI: dsh-forge-kit / dsh-forge / dsh-session)

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
  dsh-forge audit [--limit 100] [--json]        read the operation log across days
  dsh-forge snapshot [profile] [--keep 5] [--days 7] [--max-bytes N] [--list] [--json]
  dsh-forge personas [--json]                   list bundled personas
  dsh-forge transforms [--json]                 list payload transforms and round-trip status
  dsh-forge probe [profile] [--persona <id>] [--transform <kind>] [--json]   run the static probe harness
  dsh-forge channels [--all] [--json]           show delivery channel per action
  dsh-forge grades [--json]                     show how much of the host prompt each profile displaces
  dsh-forge console [--port 7788] [--state <dir>]   serve interactive workbench on 127.0.0.1
  dsh-forge console --once [--json]             render the overview page and exit
  dsh-forge run --prompt-text <text> [--strategy <id>] [--mode <mode>] [--gateway default] [--model <live>] [--forge-model <id>]
  dsh-forge strategies [--json]                 list delivery & breakout strategies
  dsh-forge session <start|turn|record|status|list|export|archive|matrix> [...]
  dsh-forge shim --binary <path> [--prompt <file>] [--env K=V] [--out <file>]
  dsh-forge compile [profile] [--model <id>] [--mode <mode>] [--persona <id>] [--persona-mode off|replace|strict|append] [--transform base64|rot13|leet|vowels|morse|ascii|reverse|split] [--home <dir>] [--project <dir>] [--budget 3200] [--out plan.json]
  dsh-forge apply --profile <profile> [--model <model>] [--home <dir>] [--project <dir>] [--state <dir>] [--preview file] [--dry-run|--yes]
  dsh-forge plans [--json]
  dsh-forge verify-plan <plan-id> [--json]
  dsh-forge revert-plan <plan-id> [--force]
  dsh-forge profiles [--json]
  dsh-forge hosts [--json]
  dsh-forge models [--json]

Environment:
  DSH_HOME                    default ~/.dsh
  DSH_FORGE_KIT_STATE         default ~/.dsh-forge-kit (legacy alias: DSH_FORGE_STATE)
  DSH_FORGE_KIT_PROFILE       default desktop (legacy alias: DSH_FORGE_PROFILE)
  DSH_FORGE_KIT_HOST_ROOT     override host root (or pass --host-root; legacy: DSH_FORGE_HOST_ROOT)
  DSH_FORGE_DEBUG=1           verbose event log`);
}
