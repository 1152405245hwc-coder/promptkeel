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
  assert.equal(state.patches.total, 23);
  assert.ok(state.profiles.length >= 10);
  assert.ok(state.personas.some((persona) => persona.id === "direct"));
  const layers = new Set(state.patches.rows.map((row) => row.layer));
  assert.ok(layers.has("approval") && layers.has("sandbox"));
});

test("pages carry the console design system and highlight the current route", () => {
  const html = renderOverview(fixture);
  assert.match(html, /class="top"/);
  assert.match(html, /class="grid"/);
  assert.match(html, /class="card"/);
  assert.match(html, /aria-current="page">overview/);
  assert.doesNotMatch(html, /<script/);
});

test("the sidebar bundle ships the grade and persona tabs", async () => {
  const { readFile } = await import("node:fs/promises");
  const bundle = await readFile(new URL("../client/client.js", import.meta.url), "utf8");
  for (const label of ["分级", "人设", "工作台", "df-personas", "df-badge"]) assert.ok(bundle.includes(label), label);
});

test("interactive workbench enforces CSRF/Origin and compiles, probes, applies, and reverts plans", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-wb-"));
  const stateDir = path.join(dir, "state");
  const projectDir = path.join(dir, "project");
  fs.mkdirSync(projectDir, { recursive: true });
  const server = createConsole({
    state: () => consoleState({ stateRoot: stateDir, home: dir }, { projectRoot: projectDir }),
    env: { stateRoot: stateDir, home: dir, projectRoot: projectDir },
  });
  const port = await listen(server);
  const base = `http://${CONSOLE_HOST}:${port}`;
  try {
    const html = await (await fetch(`${base}/workbench`)).text();
    const csrfMatch = /<meta name="forge-csrf" content="([0-9a-f]+)">/.exec(html);
    assert.ok(csrfMatch, "csrf meta tag rendered");
    const csrf = csrfMatch[1];

    const asset = await fetch(`${base}/assets/workbench.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /forge-workbench-root/);

    const noCsrf = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "generic", model: "deepseek" }),
    });
    assert.equal(noCsrf.status, 403);

    const { default: net } = await import("node:net");
    const rawResp = await new Promise((resolve, reject) => {
      const sock = net.connect(port, CONSOLE_HOST, () => {
        sock.write("GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n");
      });
      let out = "";
      sock.on("data", (d) => { out += d.toString("utf8"); });
      sock.on("end", () => resolve(out));
      sock.on("error", reject);
    });
    assert.match(rawResp, /^HTTP\/1\.1 403 /);

    const compiledRes = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forge-csrf": csrf },
      body: JSON.stringify({ profile: "codex", model: "gpt", strategy: "variable+contract" }),
    });
    assert.equal(compiledRes.status, 200);
    const compiled = await compiledRes.json();
    assert.equal(compiled.ok, true);
    assert.equal(compiled.plan.delivery.grade, "replace-full");

    const appliedRes = await fetch(`${base}/api/apply-plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forge-csrf": csrf },
      body: JSON.stringify({ profile: "codex", model: "gpt", strategy: "variable+contract", preview: compiled.preview.preview, confirm: true }),
    });
    assert.equal(appliedRes.status, 200);
    const applied = await appliedRes.json();
    assert.equal(applied.ok, true);
    assert.equal(fs.existsSync(path.join(projectDir, ".codex", "config.toml")), true);

    const revertedRes = await fetch(`${base}/api/revert-plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forge-csrf": csrf },
      body: JSON.stringify({ planId: applied.id }),
    });
    assert.equal(revertedRes.status, 200);
    assert.equal((await revertedRes.json()).ok, true);
    assert.equal(fs.existsSync(path.join(projectDir, ".codex", "config.toml")), false);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("workbench exposes real prompt modes and /api/live-run resolves live model ids and mode", async () => {
  const { default: http } = await import("node:http");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-live-wb-"));
  const stateDir = path.join(dir, "state");
  const projectDir = path.join(dir, "project");
  fs.mkdirSync(projectDir, { recursive: true });
  const receivedBodies = [];
  const mockGateway = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    receivedBodies.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { content: "1. step one\n2. step two\n```py\nprint('ok')\n```" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
    }));
  });
  const gatewayPort = await listen(mockGateway);
  const server = createConsole({
    state: () => consoleState({ stateRoot: stateDir, home: dir }, { projectRoot: projectDir }),
    env: { stateRoot: stateDir, home: dir, projectRoot: projectDir },
  });
  const port = await listen(server);
  const base = `http://${CONSOLE_HOST}:${port}`;
  try {
    const wbHtml = await (await fetch(`${base}/workbench`)).text();
    assert.match(wbHtml, /<option value="writing">writing<\/option>/);
    assert.match(wbHtml, /<option value="research">research<\/option>/);
    assert.doesNotMatch(wbHtml, /<option value="chat">/);
    assert.doesNotMatch(wbHtml, /<option value="review">/);

    const liveHtml = await (await fetch(`${base}/live`)).text();
    assert.match(liveHtml, /id="live-model-list"/);
    assert.match(liveHtml, /id="live-mode"/);
    assert.match(liveHtml, /id="live-forge-model"/);
    assert.match(liveHtml, /id="live-transform"/);

    const csrf = /<meta name="forge-csrf" content="([0-9a-f]+)">/.exec(wbHtml)[1];
    const compiledRes = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forge-csrf": csrf },
      body: JSON.stringify({ profile: "generic", model: "glm-5.3-flash", mode: "writing" }),
    });
    assert.equal(compiledRes.status, 200);
    const compiled = await compiledRes.json();
    assert.equal(compiled.plan.model.id, "glm");
    assert.equal(compiled.plan.mode, "writing");

    const liveRes = await fetch(`${base}/api/live-run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forge-csrf": csrf },
      body: JSON.stringify({
        gateway: `http://127.0.0.1:${gatewayPort}/v1`,
        model: "glm-5.3-flash",
        profile: "generic",
        strategy: "variable+contract",
        mode: "writing",
        rawUser: "Write a short helper.",
      }),
    });
    assert.equal(liveRes.status, 200);
    const live = await liveRes.json();
    assert.equal(live.ok, true);
    assert.equal(live.forgeModel, "glm");
    assert.equal(live.mode, "writing");
    assert.equal(live.verdict, "delivered");
    assert.equal(receivedBodies.length, 1);
    assert.match(receivedBodies[0].messages[0].content, /model=glm mode=writing/);
    assert.match(receivedBodies[0].messages[1].content, /^UserQuery: variable Z\./);
  } finally {
    server.close();
    mockGateway.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
