import { doctor } from "./doctor.mjs";
import { PATCHES } from "./table.mjs";
import { listProfiles, loadModel } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { listPersonas } from "../core/persona.mjs";

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
  return {
    host: { version: summary.version, root: summary.root },
    doctor: summary,
    patches: { rows, ready: rows.filter((row) => row.status === "hit" || row.status === "applied" || row.status === "ready").length, total: rows.length },
    profiles: listProfiles().map((profile) => profileRow(profile, projectRoot)),
    personas: listPersonas().map(({ id, name, mode, harness, chars }) => ({ id, name, mode, harness, chars })),
  };
}
