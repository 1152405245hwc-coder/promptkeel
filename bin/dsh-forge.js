#!/usr/bin/env node
import { ForgeError } from "../core/errors.mjs";
import { registerProvider } from "../core/provider.mjs";
import * as dshProvider from "../lib/dsh-provider.mjs";
import { VERSION } from "../lib/paths.mjs";
import { sessionMain } from "../scripts/session.mjs";
import { initCli, command, positional, optionValue, out, usage } from "./commands/shared.mjs";
import { cmdDoctor, cmdStatus, cmdApply, cmdUpgrade, cmdRevert, cmdVerify, cmdExplain, cmdUnpack, cmdAdapt, cmdProfile, cmdPrompt, cmdPreset, cmdCollect, cmdLog } from "./commands/dsh.mjs";
import { cmdCompile, cmdForgeApply, cmdPlans, cmdVerifyPlan, cmdRevertPlan, cmdProfiles, cmdHosts, cmdModels, cmdPersonas, cmdTransforms, cmdProbe, cmdChannels, cmdGrades, cmdShim, cmdAudit, cmdSnapshot } from "./commands/plan.mjs";
import { cmdStrategies, cmdRun, cmdConsole } from "./commands/runtime.mjs";

registerProvider(dshProvider);
initCli(process.argv.slice(2));

async function main() {
  try {
    switch (command) {
      case "doctor": cmdDoctor(); break;
      case "status": cmdStatus(); break;
      case "apply":
        if (optionValue("profile", null) && !["desktop", "web"].includes(optionValue("profile"))) cmdForgeApply();
        else cmdApply();
        break;
      case "unpack": cmdUnpack(); break;
      case "upgrade":
      case "update": cmdUpgrade(); break;
      case "revert": cmdRevert(); break;
      case "verify": cmdVerify(); break;
      case "explain": cmdExplain(); break;
      case "adapt": cmdAdapt(); break;
      case "profile": cmdProfile(); break;
      case "prompt": cmdPrompt(); break;
      case "preset": cmdPreset(); break;
      case "collect": cmdCollect(); break;
      case "log": cmdLog(); break;
      case "audit": cmdAudit(); break;
      case "compile": cmdCompile(); break;
      case "apply-profile": cmdForgeApply(); break;
      case "plans": cmdPlans(); break;
      case "verify-plan": cmdVerifyPlan(); break;
      case "revert-plan": cmdRevertPlan(); break;
      case "profiles": cmdProfiles(); break;
      case "hosts": cmdHosts(); break;
      case "models": cmdModels(); break;
      case "personas": cmdPersonas(); break;
      case "transforms": cmdTransforms(); break;
      case "probe": cmdProbe(); break;
      case "channels": cmdChannels(); break;
      case "shim": cmdShim(); break;
      case "grades": cmdGrades(); break;
      case "strategies": cmdStrategies(); break;
      case "run": await cmdRun(); break;
      case "session": {
        const code = await sessionMain(positional);
        if (code) process.exitCode = code;
        break;
      }
      case "console": cmdConsole(); break;
      case "snapshot": cmdSnapshot(); break;
      case "version": process.stdout.write(`${VERSION}\n`); break;
      default: usage();
    }
  } catch (error) {
    if (error instanceof ForgeError) {
      out(error.toJSON(), true);
      process.exitCode = 1;
    } else {
      out({ ok: false, error: error?.message || String(error) }, true);
      process.exitCode = 1;
    }
  }
}

await main();
