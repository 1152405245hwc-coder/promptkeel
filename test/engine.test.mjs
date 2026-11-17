import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { PATCHES } from "../lib/table.mjs";
import { DSH_PATCH_IDS } from "../core/contract.mjs";
import { inspectPatch, dryRun, apply, revert, upgrade, verifyApplied, normalizeFiles, replacementsOf, resolvePatch, satisfies, listBackups } from "../lib/engine.mjs";
import { packAsarArchive, hostStorageState, unpackHostAsar } from "../lib/asar.mjs";

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixture(t, version = "0.2.2-rc.2") {
  const root = tmpDir(t, "forge-host-");
  fs.mkdirSync(path.join(root, "node_modules", "@deepseek-ai"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
  for (const patch of PATCHES) {
    for (const rel of normalizeFiles(patch)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const body = replacementsOf(patch).map((r) => r.find).join("\n");
      fs.appendFileSync(abs, body + "\n");
    }
  }
  return root;
}

test("dry-run reports every patch in the table as hittable", (t) => {
  const hostRoot = fixture(t);
  const report = dryRun(PATCHES, { hostRoot });
  assert.equal(report.ok, true);
  assert.equal(report.patches.length, PATCHES.length);
  assert.ok(report.patches.every((p) => p.status === "hit"));
});

test("every patch entry is complete, well-typed and uniquely named", () => {
  const layers = new Set(PATCHES.map((patch) => patch.layer));
  assert.equal(layers.size, 5);
  const ids = PATCHES.map((patch) => patch.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), DSH_PATCH_IDS);
  for (const patch of PATCHES) {
    assert.match(patch.id, /^[a-z0-9]+(?:-[a-z0-9]+)+$/, `id shape: ${patch.id}`);
    assert.ok(patch.title.length >= 12, `title: ${patch.id}`);
    assert.ok(["code", "prompt"].includes(patch.kind), `kind: ${patch.id}`);
    assert.equal(typeof patch.required, "boolean", `required: ${patch.id}`);
    assert.ok(patch.versions.length > 0, `versions: ${patch.id}`);
    assert.ok(patch.why.length > 40, `why: ${patch.id}`);
    const replacements = replacementsOf(patch);
    assert.ok(replacements.length > 0, `replacements: ${patch.id}`);
    for (const entry of replacements) {
      assert.equal(typeof entry.find, "string", `find: ${patch.id}`);
      assert.equal(typeof entry.replace, "string", `replace: ${patch.id}`);
      assert.ok(entry.find.length > 8, `find too short: ${patch.id}`);
    }
    assert.equal(typeof patch.marker, "string", `marker: ${patch.id}`);
    assert.ok(patch.marker.length > 8, `marker too short: ${patch.id}`);
  }
});

test("apply then verify then revert restores every byte", (t) => {
  const hostRoot = fixture(t);
  const dshHome = tmpDir(t, "forge-home-");
  const before = new Map();
  for (const patch of PATCHES) {
    for (const rel of normalizeFiles(patch)) {
      const abs = path.join(hostRoot, rel);
      before.set(abs, sha(abs));
    }
  }
  const result = apply(PATCHES, { hostRoot, dshHome }, { backupRoot: path.join(dshHome, "backups") });
  assert.equal(result.ok, true);
  assert.equal(result.changed.length, new Set(result.changed).size, "changed list has no duplicate paths");
  const expectedFiles = new Set(PATCHES.flatMap((patch) => normalizeFiles(patch))).size;
  assert.equal(result.changed.length, expectedFiles);
  const verified = verifyApplied(PATCHES, { hostRoot });
  assert.equal(verified.ok, true);

  const back = revert({ hostRoot, dshHome }, null, path.join(dshHome, "backups"));
  assert.equal(back.ok, true);
  for (const [abs, hash] of before) assert.equal(sha(abs), hash, `hash mismatch: ${abs}`);
});

test("a missing anchor blocks the whole apply", (t) => {
  const hostRoot = fixture(t);
  const dshHome = tmpDir(t, "forge-home-");
  const target = path.join(hostRoot, "node_modules/@deepseek-ai/dsh-user-approval/lib/index.js");
  fs.writeFileSync(target, "nothing here");
  const result = apply(PATCHES, { hostRoot, dshHome }, { backupRoot: path.join(dshHome, "backups") });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "preflight-failed");
});

test("inspect marks an already-patched file as applied", (t) => {
  const hostRoot = fixture(t);
  const dshHome = tmpDir(t, "forge-home-");
  const result = apply(PATCHES, { hostRoot, dshHome });
  assert.equal(result.ok, true);
  const one = inspectPatch(PATCHES[0], { hostRoot });
  assert.equal(one.status, "applied");
});

test("duplicate anchors are ambiguous and block a required apply", (t) => {
  const hostRoot = fixture(t);
  const target = path.join(hostRoot, "node_modules/@deepseek-ai/dsh-user-approval/lib/index.js");
  const anchor = replacementsOf(PATCHES[0])[0].find;
  fs.writeFileSync(target, `${anchor}\n${anchor}\n`);
  const one = inspectPatch(PATCHES[0], { hostRoot });
  assert.equal(one.status, "ambiguous");
  const report = dryRun(PATCHES, { hostRoot });
  assert.equal(report.ok, false);
});

test("a half-applied multi-replacement patch is partial", (t) => {
  const hostRoot = fixture(t);
  const target = path.join(hostRoot, "node_modules/@deepseek-ai/dsh-user-approval/lib/types/index.js");
  const patch = PATCHES.find((p) => p.id === "approval-types-sentences");
  const [, second] = replacementsOf(patch);
  fs.writeFileSync(target, `${patch.marker}\n${second.find}\n`);
  const one = inspectPatch(patch, { hostRoot });
  assert.equal(one.status, "partial");
  assert.equal(dryRun(PATCHES, { hostRoot }).ok, false);
});

test("a second apply cannot overwrite an existing backup id", (t) => {
  const hostRoot = fixture(t);
  const dshHome = tmpDir(t, "forge-home-");
  const backupRoot = path.join(dshHome, "backups");
  const first = apply([PATCHES[0]], { hostRoot, dshHome }, { backupRoot, id: "fixed" });
  assert.equal(first.ok, true);
  const second = apply(PATCHES, { hostRoot, dshHome }, { backupRoot, id: "fixed" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "backup-exists");
  const manifest = JSON.parse(fs.readFileSync(path.join(backupRoot, "fixed", "manifest.json"), "utf8"));
  assert.ok(manifest.files.length > 0);
});

test("revert refuses an empty manifest instead of reporting success", (t) => {
  const dshHome = tmpDir(t, "forge-home-");
  const root = path.join(dshHome, "backups");
  fs.mkdirSync(path.join(root, "empty", "files"), { recursive: true });
  fs.writeFileSync(path.join(root, "empty", "manifest.json"), JSON.stringify({ id: "empty", files: [] }));
  const result = revert({ dshHome }, "empty", root);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-backup");
});

test("revert blocks when host version moved since the backup unless forced", (t) => {
  const hostRoot = fixture(t, "0.2.2-rc.2");
  const dshHome = tmpDir(t, "forge-home-");
  const backupRoot = path.join(dshHome, "backups");
  const applied = apply(PATCHES, { hostRoot, dshHome }, { backupRoot });
  assert.equal(applied.ok, true);

  fs.writeFileSync(path.join(hostRoot, "package.json"), JSON.stringify({ version: "0.2.2-rc.3" }));
  const blocked = revert({ hostRoot, dshHome }, null, backupRoot);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "host-version-mismatch");

  const forced = revert({ hostRoot, dshHome }, null, backupRoot, { force: true });
  assert.equal(forced.ok, true);
});

test("upgrade reverts same-version backup and re-applies cleanly", (t) => {
  const hostRoot = fixture(t, "0.2.2-rc.2");
  const dshHome = tmpDir(t, "forge-home-");
  const backupRoot = path.join(dshHome, "backups");
  const first = apply(PATCHES, { hostRoot, dshHome }, { backupRoot });
  assert.equal(first.ok, true);

  const up = upgrade(PATCHES, { hostRoot, dshHome }, { backupRoot });
  assert.equal(up.ok, true);
  assert.equal(up.reverted, first.id);
  assert.equal(verifyApplied(PATCHES, { hostRoot }).ok, true);
});

test("resolvePatch selects matching version variant", () => {
  const patch = {
    id: "multi-ver",
    file: "node_modules/@deepseek-ai/pkg/index.js",
    variants: [
      { versions: ">=0.2.1 <0.2.3", find: "old()", replace: "patched_22()", marker: "patched_22" },
      { versions: ">=0.2.3 <0.3.0", find: "new()", replace: "patched_23()", marker: "patched_23" },
    ],
  };
  assert.equal(resolvePatch(patch, "0.2.2-rc.3").marker, "patched_22");
  assert.equal(resolvePatch(patch, "0.2.3").marker, "patched_23");
  assert.equal(resolvePatch(patch, "0.4.0").unsupported, true);
});

test("satisfies handles semver pre-releases and upper bounds accurately", () => {
  assert.equal(satisfies("0.2.1-rc.1", ">=0.2.1-rc.1 <0.3.0"), true);
  assert.equal(satisfies("0.2.2-rc.2", ">=0.2.2-rc.1 <0.2.2-rc.3"), true);
  assert.equal(satisfies("0.2.2-rc.1", ">=0.2.2-rc.2"), false);
  assert.equal(satisfies("0.2.2", ">=0.2.2-rc.3 <0.3.0"), true);
  assert.equal(satisfies("0.3.0-rc.1", ">=0.2.1-rc.1 <0.3.0"), false);
  assert.equal(satisfies("0.2.2-alpha.5", ">=0.2.2-rc.1"), false);
  assert.equal(satisfies("0.2.2-rc.1+build.42", ">=0.2.2-alpha.5 <0.3.0"), true);
  assert.equal(satisfies("unknown", ">=0.2.1-rc.1 <0.3.0"), false);
});

test("packed app.asar supports read-only dryRun and auto-unpacks on apply", (t) => {
  const unpackedSrc = fixture(t, "0.2.2-rc.3");
  const bundleRoot = tmpDir(t, "forge-asar-bundle-");
  const stageDir = path.join(bundleRoot, "stage", "dsh");
  fs.mkdirSync(path.dirname(stageDir), { recursive: true });
  fs.cpSync(unpackedSrc, stageDir, { recursive: true });

  const resourcesDir = path.join(bundleRoot, "Resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  packAsarArchive(path.join(bundleRoot, "stage"), asarPath);

  const hostRoot = path.join(resourcesDir, "app", "dsh");
  const dshHome = tmpDir(t, "forge-home-");

  assert.equal(hostStorageState(hostRoot).mode, "asar");
  const preflight = dryRun(PATCHES, { hostRoot, dshHome });
  assert.equal(preflight.ok, true);
  assert.equal(preflight.version, "0.2.2-rc.3");
  assert.equal(fs.existsSync(hostRoot), false);

  const blocked = apply(PATCHES, { hostRoot, dshHome }, { unpack: false });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "asar-packed");

  const applied = apply(PATCHES, { hostRoot, dshHome });
  assert.equal(applied.ok, true);
  assert.equal(Boolean(applied.unpacked?.ok), true);
  assert.equal(hostStorageState(hostRoot).mode, "unpacked");
  assert.equal(fs.existsSync(`${asarPath}.bak`), true);
  assert.equal(verifyApplied(PATCHES, { hostRoot, dshHome }).ok, true);
});

test("failed packed apply restores the original app.asar", (t) => {
  const unpackedSrc = fixture(t, "0.2.2-rc.3");
  const bundleRoot = tmpDir(t, "forge-asar-rollback-");
  const stageDir = path.join(bundleRoot, "stage", "dsh");
  fs.mkdirSync(path.dirname(stageDir), { recursive: true });
  fs.cpSync(unpackedSrc, stageDir, { recursive: true });
  const resourcesDir = path.join(bundleRoot, "Resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  packAsarArchive(path.join(bundleRoot, "stage"), asarPath);
  const hostRoot = path.join(resourcesDir, "app", "dsh");
  const dshHome = tmpDir(t, "forge-home-");
  const backupRoot = path.join(dshHome, "backups");
  fs.mkdirSync(path.join(backupRoot, "collision"), { recursive: true });
  const result = apply(PATCHES, { hostRoot, dshHome }, { backupRoot, id: "collision" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "backup-exists");
  assert.equal(hostStorageState(hostRoot).mode, "asar");
  assert.equal(fs.existsSync(asarPath), true);
  assert.equal(fs.existsSync(`${asarPath}.bak`), false);
  assert.equal(fs.existsSync(path.join(resourcesDir, "app")), false);
});

test("revert refuses to overwrite a file edited after apply", (t) => {
  const hostRoot = fixture(t);
  const dshHome = tmpDir(t, "forge-home-");
  const backupRoot = path.join(dshHome, "backups");
  const applied = apply([PATCHES[0]], { hostRoot, dshHome }, { backupRoot });
  assert.equal(applied.ok, true);
  const target = path.join(hostRoot, normalizeFiles(PATCHES[0])[0]);
  fs.appendFileSync(target, "\nuser edit\n");
  const back = revert({ hostRoot, dshHome }, null, backupRoot);
  assert.equal(back.ok, false);
  assert.equal(back.failed[0].reason, "target-modified-after-apply");
  assert.match(fs.readFileSync(target, "utf8"), /user edit/);
});

test("listBackups tolerates a malformed manifest", (t) => {
  const dshHome = tmpDir(t, "forge-home-");
  const root = path.join(dshHome, "backups");
  fs.mkdirSync(path.join(root, "broken"), { recursive: true });
  fs.writeFileSync(path.join(root, "broken", "manifest.json"), "{not json");
  const rows = listBackups(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].files, 0);
});

test("every patch declares a known layer", () => {
  const layers = new Set(["approval", "sandbox", "turn", "persona", "session"]);
  for (const patch of PATCHES) {
    assert.ok(layers.has(patch.layer), `${patch.id} has layer ${patch.layer}`);
    assert.ok(patch.why && patch.why.length > 20, `${patch.id} explains why it exists`);
  }
  const counts = PATCHES.reduce((acc, p) => ((acc[p.layer] = (acc[p.layer] || 0) + 1), acc), {});
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), PATCHES.length, "every patch is classified");
  assert.equal(Object.keys(counts).every((layer) => layers.has(layer)), true);
});
