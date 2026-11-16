import fs from "node:fs";
import path from "node:path";
import { fail } from "./errors.mjs";

export const SNAPSHOT_DIR = "snapshots";
export const SNAPSHOT_DEFAULTS = { keep: 5, days: 7, maxBytes: 200 * 1024 * 1024 };
const NAME = /^snap-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-([a-z0-9._-]+)\.txt$/;

export function snapshotStamp(date) {
  return date.toISOString().replace(/[-:.]/g, "");
}

export function writeSnapshot(dir, { label = "prompt", content = "", now = () => new Date() } = {}) {
  const safe = String(label).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (!/^[a-z0-9._-]+$/.test(safe)) fail("snapshot-label", `label must be a slug, got ${label}`);
  const root = path.join(dir, SNAPSHOT_DIR);
  fs.mkdirSync(root, { recursive: true });
  const at = now();
  const file = path.join(root, `snap-${snapshotStamp(at)}-${safe}.txt`);
  fs.writeFileSync(file, content);
  return { file, label: safe, bytes: Buffer.byteLength(content), at: at.toISOString() };
}

function parseName(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms, label] = m;
  const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`);
  if (Number.isNaN(at.getTime())) return null;
  return { at, label };
}

export function listSnapshots(dir) {
  const root = path.join(dir, SNAPSHOT_DIR);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((name) => {
      const meta = parseName(name);
      if (!meta) return null;
      const file = path.join(root, name);
      return { name, file, at: meta.at.toISOString(), label: meta.label, bytes: fs.statSync(file).size };
    })
    .filter(Boolean)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Retention by count, age, and total size. Removal order is oldest first so the
 * newest snapshot always survives, even when it alone exceeds the byte budget.
 */
export function pruneSnapshots(dir, { keep, days, maxBytes, now = () => new Date() } = {}) {
  const limits = { ...SNAPSHOT_DEFAULTS, ...Object.fromEntries(Object.entries({ keep, days, maxBytes }).filter(([, v]) => v !== undefined)) };
  const rows = listSnapshots(dir);
  const cutoff = limits.days > 0 ? now().getTime() - limits.days * 86400000 : null;
  const removed = [];
  let freedBytes = 0;
  const drop = (row) => {
    fs.unlinkSync(row.file);
    removed.push(row.name);
    freedBytes += row.bytes;
  };
  let alive = rows.filter((row) => {
    if (cutoff !== null && new Date(row.at).getTime() < cutoff) {
      drop(row);
      return false;
    }
    return true;
  });
  if (limits.keep > 0) {
    while (alive.length > limits.keep) drop(alive.shift());
  }
  let total = alive.reduce((sum, row) => sum + row.bytes, 0);
  while (total > limits.maxBytes && alive.length > 1) {
    const oldest = alive.shift();
    total -= oldest.bytes;
    drop(oldest);
  }
  return { removed, freedBytes, kept: alive.map((row) => row.name), limits };
}
