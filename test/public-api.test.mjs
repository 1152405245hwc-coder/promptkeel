import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../core/index.mjs";

test("core/index.mjs exports curated public API and hides internal/removed symbols", () => {
  const expected = [
    "compile",
    "normalizeContext",
    "applyPlan",
    "revertPlan",
    "verifyPlan",
    "createSession",
    "buildTurn",
    "noteTurn",
    "stabilityOf",
    "executeStrategyRequest",
    "classifierHash",
    "placeSystem",
    "hostnameOf",
    "LOOPBACK",
  ];
  for (const name of expected) {
    assert.ok(name in core, `missing public export ${name}`);
  }

  const hidden = [
    "requireSupport",
    "listProviders",
    "providerForAction",
    "renderWorkbench",
    "SCOPES",
    "PLATFORM_OS",
    "ACTIVATION_STATES",
    "CAPABILITY_NAMES",
  ];
  for (const name of hidden) {
    assert.equal(name in core, false, `internal/removed symbol leaked from core/index.mjs: ${name}`);
  }
});
