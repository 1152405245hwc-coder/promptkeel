#!/usr/bin/env node
/**
 * Keep the patch facts quoted in the docs in sync with `lib/table.mjs`.
 *
 * The patch table is the only source of truth: the number of patches, the
 * number of distinct patched files, the number of `@deepseek-ai/*` packages,
 * the layer histogram and the supported host range are all derived here. Six
 * markdown files quote those numbers, and hand-copying them drifted every time
 * the table grew. Marked regions fix that: the doc owns the sentence, the
 * generator owns the numbers inside it.
 *
 * Usage:
 *   node scripts/check_docs.mjs             rewrite every marked region in place
 *   node scripts/check_docs.mjs --check     compare only; exit 1 and list the stale fragment
 *   node scripts/check_docs.mjs --json      machine-readable facts + region report (never writes)
 *   node scripts/check_docs.mjs --help
 *
 * Region syntax (HTML comments, invisible in rendered markdown):
 *
 *   <!-- forge-facts:begin -->
 *   ...generated content...
 *   <!-- forge-facts:end -->
 *
 * `kind=` on the begin marker selects the rendering; the default is `line`:
 *
 *   block kinds   line | table | block     must start its own line; the region
 *                                          may span several lines
 *   inline kinds  inline | patches | files | packages | layers | range
 *                                          a single-line fragment for prose and
 *                                          table cells
 *
 * Everything outside a region is preserved byte for byte, indentation of the
 * begin marker is re-applied to block output, and the file's own line endings
 * are kept, so the rewrite is idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_VERSION_RANGE, PATCHES } from "../lib/table.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The documents allowed to quote patch facts. */
export const DOC_FILES = [
  "README.md",
  "README.zh-CN.md",
  "docs/DESIGN.md",
  "docs/ARCHITECTURE.md",
  "docs/COMPAT.md",
  "docs/PORTABILITY.md",
];

/**
 * Armor layers in the order a request meets them. A layer outside this list is
 * sorted after the known ones, alphabetically, so the histogram never depends
 * on how `PATCHES` happens to be ordered.
 */
const LAYER_ORDER = ["approval", "sandbox", "turn", "persona", "session"];

const BLOCK_KINDS = new Set(["line", "table", "block"]);
const INLINE_KINDS = new Set([
  "inline", "patches", "files", "packages", "layers", "range",
  "profiles", "models", "personas", "promptCeiling", "nodeEngine",
]);
const ALL_KINDS = new Set([...BLOCK_KINDS, ...INLINE_KINDS]);

const BEGIN_RE = /<!--\s*forge-facts:begin\b([^>]*?)-->/g;
const END_RE = /<!--\s*forge-facts:end\s*-->/g;

/** Files a patch writes to. `file` is the common case; `files` stays supported. */
function filesOf(patch) {
  if (Array.isArray(patch.files)) return patch.files;
  return patch.file ? [patch.file] : [];
}

/** `node_modules/@scope/pkg/lib/index.js` -> `@scope/pkg`; bare packages keep their name. */
function packageOf(file) {
  const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(file);
  return match ? match[1] : null;
}

function compareLayer(a, b) {
  const ia = LAYER_ORDER.indexOf(a);
  const ib = LAYER_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Derived facts. Pure: the same `PATCHES` table always yields the same object,
 * including layer order, so the rendered regions are byte-stable.
 */
export function computeFacts(patches = PATCHES) {
  const files = new Set();
  const packages = new Set();
  const layerCounts = new Map();

  for (const patch of patches) {
    for (const file of filesOf(patch)) {
      files.add(file);
      const pkg = packageOf(file);
      if (pkg) packages.add(pkg);
    }
    const layer = patch.layer || "unlabeled";
    layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
  }

  const countDir = (rel, ext) => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith(ext)).length : 0;
  };
  let nodeEngine = ">=20";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    nodeEngine = pkg.engines?.node || ">=20";
  } catch { /* fallback */ }

  return {
    patches: patches.length,
    files: files.size,
    packages: packages.size,
    hostRange: HOST_VERSION_RANGE,
    layers: [...layerCounts.keys()].sort(compareLayer).map((name) => [name, layerCounts.get(name)]),
    profiles: countDir("profiles", ".json"),
    models: countDir("models", ".json"),
    personas: countDir("prompt/personas", ".md"),
    promptCeiling: 480,
    nodeEngine,
  };
}

/** `approval 5, sandbox 6, turn 1, persona 3, session 1` */
function layerSummary(facts) {
  return facts.layers.map(([name, count]) => `${name} ${count}`).join(", ");
}

/** `approval` 5 · `sandbox` 6 · `turn` 1 · `persona` 3 · `session` 1 */
function layerDetail(facts) {
  return facts.layers.map(([name, count]) => `\`${name}\` ${count}`).join(" · ");
}

/**
 * Render one region. `line`/`table`/`block` return markdown that owns whole
 * lines; the remaining kinds return a fragment that fits inside a sentence.
 */
export function renderFacts(kind, facts) {
  switch (kind) {
    case "line":
      return (
        `${facts.patches} host patches · ${facts.files} patched files · ` +
        `${facts.packages} \`@deepseek-ai/*\` packages · layers: ${layerSummary(facts)} · ` +
        `host range \`${facts.hostRange}\``
      );
    case "table":
      return [
        "| Fact | Value |",
        "| :--- | :--- |",
        `| Host patches | ${facts.patches} |`,
        `| Patched files | ${facts.files} |`,
        `| \`@deepseek-ai/*\` packages | ${facts.packages} |`,
        `| Layers | ${layerDetail(facts)} |`,
        `| Host version range | \`${facts.hostRange}\` |`,
      ].join("\n");
    case "block":
      return `${renderFacts("line", facts)}\n\n${renderFacts("table", facts)}`;
    case "inline":
      return `${facts.patches} patches across ${facts.files} files in ${facts.packages} \`@deepseek-ai/*\` packages`;
    case "patches":
      return String(facts.patches);
    case "files":
      return String(facts.files);
    case "packages":
      return String(facts.packages);
    case "layers":
      return layerSummary(facts);
    case "range":
      return `\`${facts.hostRange}\``;
    case "profiles":
      return String(facts.profiles);
    case "models":
      return String(facts.models);
    case "personas":
      return String(facts.personas);
    case "promptCeiling":
      return String(facts.promptCeiling);
    case "nodeEngine":
      return `\`${facts.nodeEngine}\``;
    default:
      throw new Error(`unknown forge-facts kind: ${kind}`);
  }
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function oneLine(text, limit = 120) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * The smallest useful stale fragment: for a one-line region, the line itself;
 * for a multi-line region, the first line that actually differs. A table dump
 * of the whole region buries the one number that is wrong.
 */
function staleFragment(found, want) {
  const foundLines = found.split("\n").map((line) => line.trim());
  const wantLines = want.split("\n").map((line) => line.trim());
  if (foundLines.length === 1 && wantLines.length === 1) {
    return { found: oneLine(found), want: oneLine(want) };
  }
  const total = Math.max(foundLines.length, wantLines.length);
  for (let i = 0; i < total; i += 1) {
    if (foundLines[i] !== wantLines[i]) {
      return {
        found: foundLines[i] === undefined ? "(no line)" : oneLine(foundLines[i]),
        want: wantLines[i] === undefined ? "(no line)" : oneLine(wantLines[i]),
      };
    }
  }
  return { found: oneLine(found), want: oneLine(want) };
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Locate every begin/end pair in a document, in order. */
function findRegions(text, file) {
  const regions = [];
  let cursor = 0;
  for (;;) {
    BEGIN_RE.lastIndex = cursor;
    const begin = BEGIN_RE.exec(text);
    if (!begin) break;
    END_RE.lastIndex = begin.index + begin[0].length;
    const end = END_RE.exec(text);
    if (!end) {
      throw new Error(
        `${file}:${lineAt(text, begin.index)}: forge-facts:begin has no matching forge-facts:end`,
      );
    }

    const attrs = begin[1].trim();
    const kindMatch = attrs.match(/(?:^|\s)kind=(["']?)([A-Za-z-]+)\1(?:\s|$)/);
    const kind = kindMatch ? kindMatch[2] : "line";
    if (!ALL_KINDS.has(kind)) {
      throw new Error(
        `${file}:${lineAt(text, begin.index)}: unknown forge-facts kind "${kind}" ` +
          `(expected one of ${[...ALL_KINDS].join(", ")})`,
      );
    }

    regions.push({ begin, end, kind, line: lineAt(text, begin.index) });
    cursor = end.index + end[0].length;
  }
  return regions;
}

/**
 * Rewrite every region in one document. Returns the new text plus one entry per
 * region that disagreed with the generated facts.
 */
export function syncText(text, file, facts = computeFacts()) {
  const regions = findRegions(text, file);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const stale = [];
  let out = "";
  let cursor = 0;

  for (const region of regions) {
    const contentStart = region.begin.index + region.begin[0].length;
    const contentEnd = region.end.index;
    const found = text.slice(contentStart, contentEnd);

    const lineStart = text.lastIndexOf("\n", region.begin.index - 1) + 1;
    const prefix = text.slice(lineStart, region.begin.index);
    const ownLine = /^[ \t]*$/.test(prefix);
    const rendered = renderFacts(region.kind, facts);

    let want;
    if (BLOCK_KINDS.has(region.kind)) {
      if (!ownLine) {
        throw new Error(
          `${file}:${region.line}: kind=${region.kind} region must start its own line ` +
            `(use an inline kind inside a sentence or table cell)`,
        );
      }
      const body = rendered.split("\n").map((line) => (line ? prefix + line : "")).join(eol);
      // Keep the whitespace that indents the end marker, so an indented region
      // (a bullet, a blockquote) stays indented on both markers.
      const trailing = (/\n([ \t]*)$/.exec(found) ?? ["", ""])[1];
      want = `${eol}${body}${eol}${trailing}`;
    } else {
      if (rendered.includes("\n")) {
        throw new Error(`${file}:${region.line}: kind=${region.kind} must render as a single line`);
      }
      want = rendered;
    }

    if (found !== want) {
      stale.push({ line: region.line, kind: region.kind, ...staleFragment(found, want) });
    }

    out += text.slice(cursor, contentStart) + want;
    cursor = contentEnd;
  }

  out += text.slice(cursor);
  return { text: out, regions: regions.length, stale };
}

function readDoc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Run the generator across every document. Writes only when `check` is false. */
export function syncDocs({ check = false } = {}) {
  const facts = computeFacts();
  const report = [];

  for (const rel of DOC_FILES) {
    const before = readDoc(rel);
    const result = syncText(before, rel, facts);

    if (!check && result.text !== before) {
      fs.writeFileSync(path.join(ROOT, rel), result.text);
    }

    report.push({
      file: rel,
      regions: result.regions,
      changed: result.text !== before,
      stale: result.stale,
    });
  }

  return { facts, report };
}

function usage() {
  return [
    "Usage: node scripts/check_docs.mjs [--check|--json|--render[=<kind>]|--help]",
    "",
    "  (no flag)  rewrite every forge-facts region in the six documents",
    "  --check    compare only; exit 1 and list the file, line and stale fragment",
    "  --json     print the computed facts and the region report; never writes",
    "  --render[:kind]  print the canonical output for a kind without writing",
    `             kinds: ${[...ALL_KINDS].join(", ")} (default line)`,
  ].join("\n");
}

function main(argv) {
  const flags = new Set(argv.filter((arg) => !arg.startsWith("--render")));
  const renderArg = argv.find((arg) => arg === "--render" || arg.startsWith("--render="));
  const renderKind = renderArg && renderArg.includes("=") ? renderArg.slice("--render=".length) : "line";
  for (const flag of flags) {
    if (!["--check", "--json", "--help", "-h"].includes(flag)) {
      process.stderr.write(`check_docs: unknown flag ${flag}\n${usage()}\n`);
      return 2;
    }
  }
  if (flags.has("--help") || flags.has("-h")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (renderArg !== undefined) {
    if (!ALL_KINDS.has(renderKind)) {
      process.stderr.write(`check_docs: unknown render kind "${renderKind}"\n${usage()}\n`);
      return 2;
    }
    process.stdout.write(`${renderFacts(renderKind, computeFacts())}\n`);
    return 0;
  }

  const check = flags.has("--check") || flags.has("--json");
  const { facts, report } = syncDocs({ check });

  if (flags.has("--json")) {
    process.stdout.write(`${JSON.stringify({ facts, files: report }, null, 2)}\n`);
    return report.some((entry) => entry.stale.length > 0 || entry.regions === 0) ? 1 : 0;
  }

  const regionTotal = report.reduce((sum, entry) => sum + entry.regions, 0);
  const missing = report.filter((entry) => entry.regions === 0);

  if (!check) {
    const touched = report.filter((entry) => entry.changed);
    for (const entry of touched) {
      process.stdout.write(`updated ${entry.file} (${entry.stale.length} of ${entry.regions} regions)\n`);
    }
    for (const entry of missing) {
      process.stdout.write(`warning: ${entry.file} carries no forge-facts region\n`);
    }
    process.stdout.write(
      `sync: ${report.length} files, ${regionTotal} regions, ${touched.length} file(s) rewritten\n`,
    );
    return 0;
  }

  const stale = report.filter((entry) => entry.stale.length > 0);
  if (stale.length === 0 && missing.length === 0) {
    process.stdout.write(`check:docs PASS (${report.length} files, ${regionTotal} regions)\n`);
    return 0;
  }

  for (const entry of stale) {
    for (const region of entry.stale) {
      process.stdout.write(`stale: ${entry.file}:${region.line} kind=${region.kind}\n`);
      process.stdout.write(`  found: ${region.found}\n`);
      process.stdout.write(`  want:  ${region.want}\n`);
    }
  }
  for (const entry of missing) {
    process.stdout.write(`missing: ${entry.file} has no forge-facts region\n`);
  }
  process.stdout.write(
    `check:docs FAIL (${plural(stale.reduce((n, e) => n + e.stale.length, 0), "stale region")} in ` +
      `${plural(stale.length, "file")}, ${plural(missing.length, "file")} without a region)\n`,
  );
  process.stdout.write("run: node scripts/check_docs.mjs\n");
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`check_docs: ${error.message}\n`);
    process.exitCode = 2;
  }
}
