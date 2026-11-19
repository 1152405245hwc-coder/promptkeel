import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { sessionMain } from "../scripts/session.mjs";
import { run as liveMatrixRun } from "../scripts/live_matrix.mjs";
import { sendRequest, verdictOf, CLASSIFIER_VERSION, classifierHash } from "../core/gateway.mjs";
import { loadSession, readFamilyStats } from "../core/session.mjs";

function tmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "forge-session-e2e-"));
}

async function startFixtureServer(t, handler) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}/v1`;
}

function okChoice(content = "1. step one\n2. step two\n\n```js\nexport const ok = true;\n```") {
  return {
    id: "chatcmpl-fixture-ok",
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 40, completion_tokens: 24, total_tokens: 64 },
  };
}

test("e2e: system-rejecting HTTP 400 degrades full -> inline without invalid_request substring", async (t) => {
  const seen = [];
  const gatewayUrl = await startFixtureServer(t, (_req, res, body) => {
    seen.push(body);
    const hasSystem = (body.messages || []).some((m) => m.role === "system");
    if (hasSystem) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "system slot unsupported on this route" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(okChoice()));
  });

  const state = tmpState();
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));

  await sessionMain(["start", "--model", "gpt-4o", "--task", "Write a helper", "--state", state]);
  const [sessionFile] = fs.readdirSync(path.join(state, "sessions")).filter((f) => f.startsWith("s-"));
  const sessionId = sessionFile.replace(/\.json$/, "");

  await sessionMain(["turn", sessionId, "--send", "--gateway", gatewayUrl, "--state", state]);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].messages.some((m) => m.role === "system"), true);
  assert.equal(seen[1].messages.some((m) => m.role === "system"), false);

  const updated = loadSession(sessionId, { env: { stateRoot: state } });
  assert.equal(updated.systemMode, "inline");
  assert.equal(updated.turns[0].verdict, "delivered");
  assert.equal(updated.turns[0].classifierHash, classifierHash());
});

test("e2e: multi-message + locked-single rejecting HTTP 422 degrades history -> single -> bare cleanly", async (t) => {
  const seen = [];
  const gatewayUrl = await startFixtureServer(t, (_req, res, body) => {
    seen.push(body);
    const msgs = body.messages || [];
    const hasSystem = msgs.some((m) => m.role === "system");
    const hasLock = msgs.some((m) => /会话锁|直接进入交付/.test(String(m.content || "")));
    if (hasSystem || msgs.length > 1 || hasLock) {
      res.writeHead(422, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unprocessable payload" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(okChoice()));
  });

  const state = tmpState();
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));

  await sessionMain(["start", "--model", "gpt-4o", "--task", "exact bare task", "--state", state]);
  const [sessionFile] = fs.readdirSync(path.join(state, "sessions")).filter((f) => f.startsWith("s-"));
  const sessionId = sessionFile.replace(/\.json$/, "");

  await sessionMain(["turn", sessionId, "--send", "--gateway", gatewayUrl, "--state", state]);
  const winner = seen.at(-1);
  assert.equal(winner.messages.length, 1);
  assert.equal(winner.messages[0].role, "user");
  assert.equal(winner.messages[0].content, "exact bare task");

  const updated = loadSession(sessionId, { env: { stateRoot: state } });
  assert.equal(updated.shape, "bare");
  assert.equal(updated.systemMode, "bare");
  assert.equal(updated.turns[0].verdict, "delivered");
});

test("e2e: free-pool chatcmpl-freeipblk SSE 200 classifies as upstream_error and blocked verdict", async (t) => {
  const gatewayUrl = await startFixtureServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      'data: {"id":"chatcmpl-freeipblk0000","choices":[{"delta":{"content":"egress IP rate-limited"},"finish_reason":"stop"}]}\n' +
      "data: [DONE]\n",
    );
  });

  const provider = { kind: "openai", baseUrl: gatewayUrl, keyOptional: true, reply: "choices.0.message.content" };
  const res = await sendRequest(provider, { system: "", user: "ping", model: "group/deepseek" });
  assert.equal(res.status, "upstream_error");
  assert.equal(res.responseId, "chatcmpl-freeipblk0000");
  assert.equal(verdictOf(res, { refused: false }), "blocked");
});

test("e2e: interleaved sessions accumulate family stats without clobbering each other", async (t) => {
  const gatewayUrl = await startFixtureServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(okChoice()));
  });

  const state = tmpState();
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));

  await sessionMain(["start", "--model", "gpt-4o", "--task", "task A", "--strategy", "deliver", "--state", state]);
  await sessionMain(["start", "--model", "gpt-4o", "--task", "task B", "--strategy", "contract", "--state", state]);
  const files = fs.readdirSync(path.join(state, "sessions")).filter((f) => f.startsWith("s-")).sort();
  assert.equal(files.length, 2);
  const [idA, idB] = files.map((f) => f.replace(/\.json$/, ""));

  await sessionMain(["turn", idA, "--send", "--gateway", gatewayUrl, "--state", state]);
  await sessionMain(["turn", idB, "--send", "--gateway", gatewayUrl, "--state", state]);

  const stats = readFamilyStats("gpt", { env: { stateRoot: state } });
  assert.equal(stats.arms.deliver.pulls, 1);
  assert.equal(stats.arms.deliver.wins, 1);
  assert.equal(stats.arms.contract.pulls, 1);
  assert.equal(stats.arms.contract.wins, 1);
});

test("e2e: dsh-session matrix dry-run creates zero session files and prints defined shape", async (t) => {
  const state = tmpState();
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));

  let output = "";
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await sessionMain(["matrix", "--models", "gpt-4o,deepseek-chat", "--task", "check dry-run", "--state", state]);
  } finally {
    process.stdout.write = origWrite;
  }
  const sessionsRoot = path.join(state, "sessions");
  const created = fs.existsSync(sessionsRoot) ? fs.readdirSync(sessionsRoot) : [];
  assert.deepEqual(created, []);
  assert.doesNotMatch(output, /\bundefined\b/);
  assert.match(output, /history/);
});

test("e2e: live_matrix dry-run and live request match under inline+variable and stamp classifier metadata", async (t) => {
  const captured = [];
  const gatewayUrl = await startFixtureServer(t, (req, res, body) => {
    if (req.url.endsWith("/chat/completions")) captured.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(okChoice()));
  });

  const tmp = tmpState();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dumpFile = path.join(tmp, "dry-body.json");
  const outFile = path.join(tmp, "report.json");

  await liveMatrixRun([
    "--gateway", gatewayUrl,
    "--profile", "generic",
    "--model", "gpt-4o",
    "--probe", "lateral-report-digest",
    "--wrap", "variable",
    "--system-mode", "inline",
    "--dry-run",
    "--dump-request", dumpFile,
  ]);
  const dryBody = JSON.parse(fs.readFileSync(dumpFile, "utf8"));

  await liveMatrixRun([
    "--gateway", gatewayUrl,
    "--profile", "generic",
    "--model", "gpt-4o",
    "--probe", "lateral-report-digest",
    "--wrap", "variable",
    "--system-mode", "inline",
    "--out", outFile,
  ]);

  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0], dryBody);
  // Compiled system prompt must precede Z=[...] and NEVER be wrapped inside Z=[...].
  const msg = captured[0].messages[0].content;
  const sysPos = msg.indexOf("<!-- dsh-forge");
  const varPos = msg.indexOf("UserQuery: variable Z. Z = [");
  assert.ok(sysPos !== -1 && varPos !== -1 && sysPos < varPos);

  const report = JSON.parse(fs.readFileSync(outFile, "utf8"));
  assert.equal(report.classifierVersion, CLASSIFIER_VERSION);
  assert.equal(report.classifierHash, classifierHash());
  assert.equal(report.systemMode, "inline");
  assert.equal(report.rows[0].classifierHash, classifierHash());
});
