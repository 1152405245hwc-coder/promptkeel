import fs from "node:fs";
import path from "node:path";

const SHARED_MARKER = "dsh-forge";

function walkFiles(dir, { maxFiles = 24, extensions = [".jsonl", ".json", ".log"] } = {}) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  const queue = [dir];
  while (queue.length && out.length < maxFiles) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
    }
  }
  return out;
}

function readTail(file, maxBytes = 64 * 1024) {
  try {
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, Math.max(0, stat.size - size));
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function readHead(file, maxBytes = 32 * 1024) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const bytes = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.slice(0, bytes).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

/**
 * Inspect session logs for fixture-testable activation proof across hosts.
 * Never invents active state when only config files exist.
 */
export function inspectHostSession(hostId, { home, projectRoot, dshHome, sessionDir } = {}) {
  const dirs = [];
  if (sessionDir) dirs.push(path.resolve(sessionDir));
  if (hostId === "dsh") {
    const base = dshHome || (home ? path.join(home, ".dsh") : null);
    if (base) dirs.push(path.join(base, "sessions"), path.join(base, "logs"), path.join(base, "profiles"));
  } else if (hostId === "codex" && home) {
    dirs.push(path.join(home, ".codex", "sessions"));
  } else if (hostId === "claude-code" && home) {
    dirs.push(path.join(home, ".claude", "projects"));
  } else if (hostId === "gemini" && home) {
    dirs.push(path.join(home, ".gemini", "tmp"));
  } else if (hostId === "opencode" && home) {
    dirs.push(path.join(home, ".local", "share", "opencode", "storage"));
  } else if (hostId === "hermes" && home) {
    dirs.push(path.join(home, ".hermes", "logs"), path.join(home, ".hermes", "sessions"));
  } else if (hostId === "continue" && home) {
    dirs.push(path.join(home, ".continue", "sessions"));
  }

  const files = dirs.flatMap((dir) => walkFiles(dir, { maxFiles: 12 }));
  if (files.length === 0) return { found: false, active: false, evidence: [], note: null };

  const evidence = [];
  let active = false;
  let identityPrefixPresent = null;

  for (const file of files) {
    const content = `${readHead(file)}\n${readTail(file)}`;
    const hasMarker = content.includes(SHARED_MARKER) || content.includes("prompt-inject.md") || content.includes("model_instructions_file") || content.includes("GEMINI_SYSTEM_MD");
    if (hostId === "claude-code") {
      if (content.includes("You are Claude Code, Anthropic's official CLI for Claude.")) identityPrefixPresent = true;
    }
    if (hasMarker) {
      active = true;
      evidence.push({ kind: "session", id: path.basename(file), path: file, marker: true });
    } else if (files.length > 0 && evidence.length === 0) {
      evidence.push({ kind: "log", id: path.basename(file), path: file, marker: false });
    }
  }

  return {
    found: files.length > 0,
    active,
    identityPrefixPresent,
    evidence,
    projectRoot: projectRoot || null,
  };
}
