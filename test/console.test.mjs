import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, createConsole, escapeHtml, renderOverview, CONSOLE_HOST, CONSOLE_ROUTES } from "../core/console.mjs";
import { consoleState } from "../lib/console-state.mjs";

const fixture = {
  host: { version: "9.9.9" },
  doctor: {
    checks: [{ id: "host-root", label: "Host root", status: "warn", detail: "/tmp/<script>" }],
    activation: { state: "configured", requiresRestart: true },
  },
  patches: { rows: [{ id: "a", layer: "approval", status: "hit", matches: 1 }], ready: 1, total: 1 },
  profiles: [{ id: "p", support: "verified", channels: { project: 1, install: 0, slash: 0, none: 0 }, delivery: { grade: "append-only", source: "research", mechanism: "why" } }],
  personas: [{ id: "direct", mode: "replace", harness: "any", chars: 10 }],
};

function listen(server) {
  return new Promise((resolve) => server.listen(0, CONSOLE_HOST, () => resolve(server.address().port)));
}

test("the overview escapes host text", () => {
  const html = renderOverview(fixture);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /configured/);
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("the console serves every route, refuses writes, and reports unknown paths", async () => {
  const server = createConsole({ state: () => fixture });
  const port = await listen(server);
  try {
    for (const route of CONSOLE_ROUTES) {
      const res = await fetch(`http://${CONSOLE_HOST}:${port}${route}`);
      assert.equal(res.status, 200, route);
    }
    const api = await (await fetch(`http://${CONSOLE_HOST}:${port}/api/state`)).json();
    assert.equal(api.host.version, "9.9.9");
    const post = await fetch(`http://${CONSOLE_HOST}:${port}/`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    const missing = await fetch(`http://${CONSOLE_HOST}:${port}/nope`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test("a failing state function still answers instead of dropping the request", async () => {
  const server = createConsole({ state: () => { throw new Error("host root missing"); } });
  const port = await listen(server);
  try {
    const api = await (await fetch(`http://${CONSOLE_HOST}:${port}/api/state`)).json();
    assert.match(api.error, /host root missing/);
    const page = await fetch(`http://${CONSOLE_HOST}:${port}/`);
    assert.equal(page.status, 200);
  } finally {
    server.close();
  }
});

test("the lock blocks a second live instance and replaces a stale one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-console-"));
  const first = acquireLock(dir, { pid: process.pid });
  assert.throws(() => acquireLock(dir, { pid: 999999 }), /console already running with pid \d+/);
  fs.writeFileSync(first.file, "999999\n");
  const second = acquireLock(dir, { pid: process.pid });
  assert.equal(second.pid, process.pid);
  second.release();
  assert.equal(fs.existsSync(path.join(dir, "console.pid")), false);
});

test("consoleState reuses doctor output so pages cannot disagree with the CLI", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-state-"));
  const state = consoleState({ stateRoot: dir }, { projectRoot: process.cwd() });
  assert.ok(state.doctor.checks.length >= 10);
  assert.equal(state.patches.total, 16);
  assert.ok(state.profiles.length === 10);
  assert.ok(state.personas.some((persona) => persona.id === "direct"));
  const layers = new Set(state.patches.rows.map((row) => row.layer));
  assert.ok(layers.has("approval") && layers.has("sandbox"));
});
