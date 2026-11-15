#!/usr/bin/env node
import { loadProfile, listModels } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";
import { preflight } from "../core/capabilities.mjs";

const profiles = ["dsh", "claude-code", "codex", "gemini", "opencode", "generic"];
let failed = 0;
for (const id of profiles) {
  try {
    const profile = loadProfile(id);
    const model = listModels().find((m) => m.id === (profile.model || "deepseek")) || listModels()[0];
    if (!model) throw new Error("no models");
    const plan = compile(profile, model, { projectRoot: "/tmp/forge-profile-check", home: "/tmp/forge-home-check" });
    const pre = preflight(profile, { host: profile.host, model });
    console.log(`${pre.ok ? "OK  " : "FAIL"} ${id.padEnd(12)} ${profile.host.padEnd(12)} ${plan.budget.tokens} tokens ${plan.actions.length} actions`);
    if (!pre.ok || !plan.budget.ok) failed += 1;
  } catch (error) {
    console.log(`FAIL ${id}: ${error.message}`);
    failed += 1;
  }
}
process.exitCode = failed ? 1 : 0;
