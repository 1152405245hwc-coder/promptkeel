import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditFiles, readAudit, summarizeAudit } from "../core/audit.mjs";
import { SNAPSHOT_DIR, writeSnapshot, listSnapshots, pruneSnapshots, SNAPSHOT_DEFAULTS } from "../core/snapshot.mjs";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("audit reads every day file, tails by limit, and counts unreadable lines", () => {
  const dir = tmp("forge-audit-");
  fs.writeFileSync(path.join(dir, "forge-20261115.jsonl"), `${JSON.stringify({ ts: "2026-11-15T10:00:00.000Z", event: "apply.done" })}\n`);
  fs.writeFileSync(path.join(dir, "forge-20261116.jsonl"), [
    JSON.stringify({ ts: "2026-11-16T10:00:00.000Z", event: "revert.done", level: "warn" }),
    "{broken",
    JSON.stringify({ ts: "2026-11-16T10:01:00.000Z", event: "apply.blocked", level: "error" }),
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignored\n");
  assert.deepEqual(auditFiles(dir).map((file) => path.basename(file)), ["forge-20261115.jsonl", "forge-20261116.jsonl"]);
  const all = readAudit(dir, { limit: 0 });
  assert.equal(all.events.length, 3);
  assert.equal(all.skipped, 1);
  assert.equal(all.days, 2);
  const tail = readAudit(dir, { limit: 2 });
  assert.deepEqual(tail.events.map((event) => event.event), ["revert.done", "apply.blocked"]);
  assert.equal(tail.skipped, 1);
  assert.equal(tail.events[0].day, "forge-20261116.jsonl");
  const summary = summarizeAudit(all.events);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.counts, { "apply.done": 1, "revert.done": 1, "apply.blocked": 1 });
  assert.deepEqual(summary.levels, { info: 1, warn: 1, error: 1 });
  assert.equal(summary.first, "2026-11-15T10:00:00.000Z");
});

test("audit on a missing directory reports nothing instead of throwing", () => {
  const result = readAudit(path.join(os.tmpdir(), "forge-audit-missing", String(Date.now())), { limit: 5 });
  assert.deepEqual(result.events, []);
  assert.equal(result.days, 0);
});

test("snapshots are written with a sortable name and listed oldest first", () => {
  const dir = tmp("forge-snap-");
  const first = writeSnapshot(dir, { label: "prompt-dsh", content: "a", now: () => new Date("2026-11-16T10:00:00.000Z") });
  const second = writeSnapshot(dir, { label: "prompt-dsh", content: "bb", now: () => new Date("2026-11-16T11:00:00.000Z") });
  assert.match(path.basename(first.file), /^snap-20261116T100000000Z-prompt-dsh\.txt$/);
  assert.equal(second.bytes, 2);
  assert.deepEqual(listSnapshots(dir).map((row) => row.at), ["2026-11-16T10:00:00.000Z", "2026-11-16T11:00:00.000Z"]);
  assert.equal(fs.readFileSync(second.file, "utf8"), "bb");
});

test("retention removes by count, age, and size while keeping the newest snapshot", () => {
  const dir = tmp("forge-prune-");
  const root = path.join(dir, SNAPSHOT_DIR);
  fs.mkdirSync(root, { recursive: true });
  const write = (stamp, bytes) => fs.writeFileSync(path.join(root, `snap-${stamp}-prompt-dsh.txt`), "x".repeat(bytes));
  write("20200101T000000000Z", 10);
  write("20261110T000000000Z", 10);
  write("20261114T000000000Z", 10);
  write("20261116T000000000Z", 10);

  const byAge = pruneSnapshots(dir, { keep: 0, days: 7, maxBytes: 1000, now: () => new Date("2026-11-16T12:00:00.000Z") });
  assert.deepEqual(byAge.removed, ["snap-20200101T000000000Z-prompt-dsh.txt"]);
  assert.equal(byAge.kept.length, 3);

  const byCount = pruneSnapshots(dir, { keep: 2, days: 0, maxBytes: 1000, now: () => new Date("2026-11-16T12:00:00.000Z") });
  assert.deepEqual(byCount.removed, ["snap-20261110T000000000Z-prompt-dsh.txt"]);
  assert.deepEqual(byCount.kept, ["snap-20261114T000000000Z-prompt-dsh.txt", "snap-20261116T000000000Z-prompt-dsh.txt"]);

  const bySize = pruneSnapshots(dir, { keep: 0, days: 0, maxBytes: 15, now: () => new Date("2026-11-16T12:00:00.000Z") });
  assert.deepEqual(bySize.removed, ["snap-20261114T000000000Z-prompt-dsh.txt"]);
  assert.deepEqual(bySize.kept, ["snap-20261116T000000000Z-prompt-dsh.txt"]);
  assert.equal(bySize.freedBytes, 10);

  const survivor = pruneSnapshots(dir, { keep: 1, days: 0, maxBytes: 5, now: () => new Date("2026-11-16T12:00:00.000Z") });
  assert.deepEqual(survivor.removed, []);
  assert.equal(survivor.kept.length, 1);
  assert.deepEqual(SNAPSHOT_DEFAULTS, { keep: 5, days: 7, maxBytes: 200 * 1024 * 1024 });
});
