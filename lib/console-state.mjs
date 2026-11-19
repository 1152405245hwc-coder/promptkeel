import { doctor } from "./doctor.mjs";
import { PATCHES } from "./table.mjs";
import { dryRun, apply as applyPatches, upgrade as upgradePatches, revert as revertPatches } from "./engine.mjs";
import { readPolicy, setPolicy } from "./preset.mjs";
import { composePrompt, writeInject, verifyProofs } from "./inject.mjs";
import { listProfiles, listModels, loadModel } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { listModes } from "../core/prompt.mjs";
import { listPersonas } from "../core/persona.mjs";
import { readAudit, summarizeAudit } from "../core/audit.mjs";
import { listSnapshots, SNAPSHOT_DEFAULTS } from "../core/snapshot.mjs";
import { listPlans, defaultStateRoot } from "../core/executor.mjs";
import { STRATEGIES } from "../core/strategy.mjs";
import { TRANSFORMS } from "../core/transform.mjs";
import { detectAll } from "../hosts/registry.mjs";
import { logsDir } from "./paths.mjs";

function profileRow(profile, projectRoot) {
  try {
    const plan = compile(profile, loadModel(profile.model || "deepseek"), { projectRoot });
    return { id: profile.id, host: profile.host, support: profile.support, channels: plan.channels.counts, delivery: plan.delivery };
  } catch (error) {
    return {
      id: profile.id,
      host: profile.host,
      support: profile.support,
      channels: null,
      delivery: { grade: "unobservable", source: "none", mechanism: error?.message || String(error) },
      error: error?.message || String(error),
    };
  }
}

/**
 * Assemble the facts the console renders. Doctor results are reused as-is so a
 * page cannot disagree with the CLI about the same host.
 */
export function consoleState(env = {}, { projectRoot = process.cwd() } = {}) {
  const summary = doctor(env);
  const layerOf = new Map(PATCHES.map((patch) => [patch.id, patch.layer || null]));
  const rows = summary.patches.map((row) => ({ ...row, layer: layerOf.get(row.id) || null }));
  const audit = summarizeAudit(readAudit(logsDir(env), { limit: 50 }).events);
  const stateDir = env.stateRoot || defaultStateRoot(env);
  const snapshots = listSnapshots(stateDir);
  const plans = listPlans({ stateRoot: stateDir, hostRoot: env.hostRoot });
  return {
    host: { version: summary.version, root: summary.root },
    audit,
    snapshots: { rows: snapshots, limits: SNAPSHOT_DEFAULTS },
    plans,
    doctor: summary,
    policy: readPolicy(env),
    patches: { rows, ready: rows.filter((row) => row.status === "hit" || row.status === "applied" || row.status === "ready").length, total: rows.length },
    profiles: listProfiles().map((profile) => profileRow(profile, projectRoot)),
    models: listModels().map(({ id, name, hosts }) => ({ id, name, hosts })),
    hosts: detectAll({ home: env.home, projectRoot, dshHome: env.dshHome, hostRoot: env.hostRoot }),
    personas: listPersonas().map(({ id, name, mode, harness, transform, chars }) => ({ id, name, mode, harness, transform, chars })),
    modes: listModes(),
    strategies: STRATEGIES,
    transforms: TRANSFORMS,
  };
}

export function createConsoleHandlers(env = {}) {
  return {
    dryRun: () => dryRun(PATCHES, env),
    applyPatches: () => applyPatches(PATCHES, env),
    upgradePatches: () => upgradePatches(PATCHES, env),
    revertPatches: () => revertPatches(env),
    readPolicy: () => readPolicy(env),
    setPolicy: (policy) => setPolicy(policy, env),
    installPrompt: (opts) => writeInject(composePrompt(opts), env),
    verifyProofs: () => verifyProofs(env),
  };
}
