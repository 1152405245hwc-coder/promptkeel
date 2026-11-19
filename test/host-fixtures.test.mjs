import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectHost, getAdapter } from "../hosts/registry.mjs";
import { loadProfile } from "../core/contract.mjs";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "hosts");

function fixture(...parts) {
  return path.join(FIXTURES, ...parts);
}

test("primary 4 hosts are verified in both profiles and adapters", () => {
  for (const id of ["dsh", "claude-code", "codex", "opencode"]) {
    assert.equal(loadProfile(id).support, "verified", `${id} profile should be verified`);
    assert.equal(getAdapter(id).support, "verified", `${id} adapter should be verified`);
  }
});

test("golden fixtures: dsh missing / installed / configured / active / market-false-positive", (t) => {
  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-missing-dsh-"));
  t.after(() => fs.rmSync(missingDir, { recursive: true, force: true }));
  const missing = detectHost("dsh", {
    home: missingDir,
    env: { hostRoot: path.join(missingDir, "no-dsh"), dshHome: path.join(missingDir, ".dsh") },
  });
  assert.equal(missing.status, "missing");

  const installed = detectHost("dsh", {
    home: fixture("dsh", "installed", "home"),
    env: {
      hostRoot: fixture("dsh", "installed", "host"),
      dshHome: fixture("dsh", "installed", "home", ".dsh"),
    },
  });
  assert.equal(installed.ok, true);
  assert.equal(installed.status, "installed");

  const marketOnly = detectHost("dsh", {
    home: fixture("dsh", "market-false-positive", "home"),
    env: {
      hostRoot: fixture("dsh", "market-false-positive", "host"),
      dshHome: fixture("dsh", "market-false-positive", "home", ".dsh"),
    },
  });
  assert.equal(marketOnly.status, "installed");
  assert.equal(marketOnly.evidence.some((e) => e.kind === "session"), false);

  const configured = detectHost("dsh", {
    home: fixture("dsh", "configured", "home"),
    env: {
      hostRoot: fixture("dsh", "configured", "host"),
      dshHome: fixture("dsh", "configured", "home", ".dsh"),
    },
  });
  assert.equal(configured.status, "configured");
  assert.ok(configured.evidence.some((e) => e.kind === "config"));
  assert.equal(configured.evidence.some((e) => e.kind === "session"), false);

  const active = detectHost("dsh", {
    home: fixture("dsh", "active", "home"),
    env: {
      hostRoot: fixture("dsh", "active", "host"),
      dshHome: fixture("dsh", "active", "home", ".dsh"),
    },
  });
  assert.equal(active.status, "active");
  assert.ok(active.evidence.some((e) => e.kind === "config"));
  assert.ok(active.evidence.some((e) => e.kind === "session"));
});

test("golden fixtures: claude-code / codex / opencode missing, configured, and active", (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "forge-missing-host-"));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

  for (const id of ["claude-code", "codex", "opencode"]) {
    const missing = detectHost(id, { home: empty, projectRoot: empty });
    assert.equal(missing.status, "missing", `${id} missing`);

    const cfgDir = fixture(id, "configured");
    const configured = detectHost(id, { home: cfgDir, projectRoot: cfgDir });
    assert.equal(configured.status, "configured", `${id} configured`);
    assert.ok(configured.evidence.some((e) => e.kind === "config"), `${id} configured evidence`);
    assert.equal(configured.evidence.some((e) => e.kind === "session"), false, `${id} no fake session`);

    const actDir = fixture(id, "active");
    const active = detectHost(id, { home: actDir, projectRoot: actDir });
    assert.equal(active.status, "active", `${id} active`);
    assert.ok(active.evidence.some((e) => e.kind === "config"), `${id} active config evidence`);
    assert.ok(active.evidence.some((e) => e.kind === "session"), `${id} active session evidence`);
  }
});
