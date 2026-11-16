import fs from "node:fs";
import path from "node:path";

const DAY = /^(?:forge|audit)-\d{8}\.jsonl$/;

export function auditFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => DAY.test(name) || name === "audit.jsonl")
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * Cross-day view of the operation log. The write path is `lib/log.mjs`
 * (`log()` appends one JSON line per event); this module only reads, so there
 * is a single source of truth for what happened.
 */
export function readAudit(dir, { limit = 100 } = {}) {
  const files = auditFiles(dir);
  const lines = [];
  for (const file of files) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trim()) lines.push({ file: path.basename(file), line });
    }
  }
  const events = [];
  let skipped = 0;
  for (const { file, line } of lines) {
    try {
      events.push({ ...JSON.parse(line), day: file });
    } catch {
      skipped += 1;
    }
  }
  return { events: limit > 0 ? events.slice(-limit) : events, skipped, files: files.map((file) => path.basename(file)), days: files.length };
}

export function summarizeAudit(events = []) {
  const counts = {};
  const levels = {};
  for (const event of events) {
    const key = event.event || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    const level = event.level || "info";
    levels[level] = (levels[level] || 0) + 1;
  }
  return { total: events.length, counts, levels, first: events[0]?.ts || null, last: events.at(-1)?.ts || null };
}
