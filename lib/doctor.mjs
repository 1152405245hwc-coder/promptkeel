import fs from "node:fs";
import path from "node:path";
import { hostRoot, hostVersion, profileDir, promptInjectPath, backupsDir, displayPath } from "./paths.mjs";
import { hostStorageState } from "./asar.mjs";
import { PATCHES, HOST_VERSION_RANGE } from "./table.mjs";
import { dryRun, satisfies } from "./engine.mjs";
import { verifyProofs, injectionSource, checkBudget, composePrompt } from "./inject.mjs";
import { readPolicy } from "./preset.mjs";

function ok(id, label, detail) { return { id, label, status: "ok", detail }; }
function warn(id, label, detail) { return { id, label, status: "warn", detail }; }
function fail(id, label, detail) { return { id, label, status: "fail", detail }; }

export function doctor(env = {}) {
  const root = hostRoot(env);
  const version = hostVersion(root);
  const storage = hostStorageState(root);
  const checks = [];

  checks.push(storage.mode === "unpacked"
    ? ok("host-root", "Host root", displayPath(root))
    : storage.mode === "asar" || storage.mode === "shadowed"
      ? ok("host-root", "Host root", `${displayPath(storage.asarPath)} (${storage.mode === "asar" ? "packed asar" : "asar + unpacked"})`)
      : fail("host-root", "Host root", `not found: ${displayPath(root)}`));

  checks.push(satisfies(version, HOST_VERSION_RANGE)
    ? ok("host-version", "Host version", `${version} (range ${HOST_VERSION_RANGE})`)
    : warn("host-version", "Host version", `${version} is outside ${HOST_VERSION_RANGE}`));

  const report = dryRun(PATCHES, { ...env, hostRoot: root });
  const applied = report.patches.filter((p) => p.status === "applied").length;
  const ready = report.patches.filter((p) => ["hit", "applied"].includes(p.status)).length;
  checks.push(ready === PATCHES.length
    ? ok("patches", "Patches", applied === PATCHES.length ? `${applied}/${PATCHES.length} applied` : `${ready}/${PATCHES.length} ready (${applied} applied)`)
    : fail("patches", "Patches", report.patches.filter((p) => !["hit", "applied"].includes(p.status)).map((p) => `${p.id}:${p.status}`).join(", ")));

  const composed = composePrompt();
  const inject = promptInjectPath(env);
  let foreignInject = false;
  if (fs.existsSync(inject)) {
    try { foreignInject = !fs.readFileSync(inject, "utf8").startsWith("<!-- dsh-forge "); } catch { foreignInject = true; }
  }
  checks.push(!fs.existsSync(inject)
    ? ok("prompt-file", "Prompt core", `built-in (${composed.bodySha})`)
    : foreignInject
      ? warn("prompt-file", "Prompt file", `${displayPath(inject)} exists without a dsh-forge header; plugin uses the built-in prompt`)
      : ok("prompt-file", "Prompt file", displayPath(inject)));

  const budget = checkBudget(composed);
  checks.push(budget.ok
    ? ok("prompt-budget", "Prompt budget", `${budget.tokens}/${budget.max} tokens`)
    : fail("prompt-budget", "Prompt budget", `${budget.tokens} exceeds ${budget.max}`));

  const source = injectionSource(env);
  checks.push(source.kind === "prompt-inject"
    ? ok("inject-source", "Injection source", displayPath(source.source))
    : ok("inject-source", "Injection source", `section forge:prompt (${source.kind})`));

  const proofs = verifyProofs({ env, composed, patchReport: report });
  const sessionProof = proofs.proofs.find((p) => p.id === "proof3-session");
  checks.push(sessionProof?.status === "pass"
    ? ok("session-runtime", "Session log", sessionProof.detail)
    : warn("session-runtime", "Session log", sessionProof?.detail || "unknown"));

  const profilePkg = path.join(profileDir(env), "package.json");
  let bundles = [];
  try { bundles = JSON.parse(fs.readFileSync(profilePkg, "utf8"))?.dsh?.profile?.bundles || []; } catch { /* ignore */ }
  const legacy = bundles.filter((name) => /dsh-purge/.test(name));
  const forgeIdx = bundles.indexOf("dsh-forge");
  const purgeIdx = bundles.findLastIndex((name) => /dsh-purge/.test(name));
  const orderBad = forgeIdx !== -1 && purgeIdx !== -1 && forgeIdx < purgeIdx;
  checks.push(legacy.length === 0
    ? ok("plugin-conflicts", "Plugin conflicts", "none")
    : forgeIdx === -1
      ? warn("plugin-conflicts", "Plugin conflicts", `${legacy.join(", ")} is active; install dsh-forge to disable it`)
      : orderBad
        ? fail("plugin-conflicts", "Plugin conflicts", `dsh-forge appears before ${legacy.join(", ")} in dsh.profile.bundles`)
        : ok("plugin-conflicts", "Plugin conflicts", `${legacy.join(", ")} suppressed by cordis.patch.yml`));

  checks.push(bundles.includes("dsh-forge")
    ? ok("profile-bundle", "Profile bundle", "dsh-forge registered")
    : warn("profile-bundle", "Profile bundle", "dsh-forge not in dsh.profile.bundles (run dsh-forge profile enable)"));

  const backupDir = backupsDir(env);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.accessSync(backupDir, fs.constants.W_OK);
    checks.push(ok("backup-dir", "Backup dir", displayPath(backupDir)));
  } catch {
    checks.push(fail("backup-dir", "Backup dir", `not writable: ${displayPath(backupDir)}`));
  }

  const ui = path.join(import.meta.dirname, "..", "client", "client.js");
  checks.push(fs.existsSync(ui)
    ? ok("ui-bundle", "UI bundle", `${fs.statSync(ui).size} bytes`)
    : warn("ui-bundle", "UI bundle", "run npm run build:client"));

  checks.push(ok("workspace-policy", "Workspace policy", readPolicy(env)));

  const summary = {
    ok: checks.every((c) => c.status !== "fail"),
    version,
    root,
    checks,
    patches: report.patches.map(({ id, status, matches }) => {
      const def = PATCHES.find((p) => p.id === id);
      return { id, status, matches, title: def?.title || "", file: def?.file || "" };
    }),
  };
  return summary;
}
