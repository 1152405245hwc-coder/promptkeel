import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { allowRequest, apply } from "../lib/index.js";

function fake() {
  const res = {
    code: 0,
    headers: null,
    body: null,
    writeHead(code, headers) {
      this.code = code;
      this.headers = headers;
    },
    end(data) {
      this.body = data;
    },
  };
  return res;
}

function makeReq(method, url, { headers = {}, body = "" } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = { host: "127.0.0.1:43120", ...headers };
  return stream;
}

test("loopback requests without an Origin pass", () => {
  const res = fake();
  assert.equal(allowRequest({ headers: { host: "127.0.0.1:43120" } }, res, {}), true);
  assert.equal(res.code, 0);
});

test("a foreign Host is rejected", () => {
  const res = fake();
  assert.equal(allowRequest({ headers: { host: "evil.example" } }, res, {}), false);
  assert.equal(res.code, 403);
});

test("a cross-site request is rejected", () => {
  const res = fake();
  assert.equal(allowRequest({ headers: { host: "127.0.0.1:43120", "sec-fetch-site": "cross-site" } }, res, {}), false);
  assert.equal(res.code, 403);
});

test("an Origin that does not match the Host is rejected", () => {
  const res = fake();
  assert.equal(allowRequest({ headers: { host: "127.0.0.1:43120", origin: "http://evil.example" } }, res, {}), false);
  assert.equal(res.code, 403);
});

test("a same-origin Origin passes", () => {
  const res = fake();
  assert.equal(allowRequest({ headers: { host: "127.0.0.1:43120", origin: "http://127.0.0.1:43120" } }, res, {}), true);
});

test("Host header with userinfo or path is rejected", () => {
  for (const host of ["evil.example@127.0.0.1:43120", "127.0.0.1:43120/path", "127.0.0.1:43120?x=1"]) {
    const res = fake();
    assert.equal(allowRequest({ headers: { host } }, res, {}), false, host);
    assert.equal(res.code, 403);
  }
});

test("null or non-http Origin is rejected", () => {
  for (const origin of ["null", "file://127.0.0.1:43120", "custom://127.0.0.1:43120"]) {
    const res = fake();
    assert.equal(allowRequest({ headers: { host: "127.0.0.1:43120", origin } }, res, {}), false, origin);
    assert.equal(res.code, 403);
  }
});

test("API route handler serves prompt, rejects invalid JSON/policy/content-type, and 404s unknown routes", async () => {
  let route = null;
  const sections = [];
  const ctx = {
    systemPrompt: { section: (s) => sections.push(s) },
    webServer: {
      register: (def) => {
        route = def;
        return () => {};
      },
    },
  };
  apply(ctx, { enabled: true, adapter: "deepseek" });
  assert.equal(sections.length, 1);
  assert.ok(route && typeof route.handler === "function");

  const promptRes = fake();
  await route.handler(makeReq("GET", "/promptkeel/api/prompt"), promptRes);
  assert.equal(promptRes.code, 200);
  const promptBody = JSON.parse(promptRes.body);
  assert.equal(promptBody.ok, true);
  assert.ok(promptBody.tokens < 480, `tokens=${promptBody.tokens}`);

  const statusRes = fake();
  await route.handler(makeReq("GET", "/promptkeel/api/status"), statusRes);
  assert.equal(statusRes.code, 200);
  const statusBody = JSON.parse(statusRes.body);
  assert.ok(statusBody.grades.length >= 10);
  assert.ok(statusBody.grades.every((row) => typeof row.grade === "string"));
  assert.ok(statusBody.personas.length >= 10);
  assert.ok(statusBody.personas.every((row) => row.id && row.mode));
  assert.ok(Array.isArray(statusBody.modes) && statusBody.modes.includes("writing"));

  const compileRes = fake();
  await route.handler(
    makeReq("POST", "/promptkeel/api/compile", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "generic", model: "glm-5.3-flash", mode: "writing", persona: "none" }),
    }),
    compileRes,
  );
  assert.equal(compileRes.code, 200);
  const compileBody = JSON.parse(compileRes.body);
  assert.equal(compileBody.plan.model.id, "glm");
  assert.equal(compileBody.plan.mode, "writing");

  const { default: http } = await import("node:http");
  const mockGateway = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { content: "1. ok\n```js\nconst x = 1;\n```" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    }));
  });
  await new Promise((resolve) => mockGateway.listen(0, "127.0.0.1", resolve));
  try {
    const gwPort = mockGateway.address().port;
    const liveRes = fake();
    await route.handler(
      makeReq("POST", "/promptkeel/api/live-run", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gateway: `http://127.0.0.1:${gwPort}/v1`,
          model: "glm-5.3-flash",
          profile: "generic",
          mode: "writing",
          strategy: "narrative",
          rawUser: "scene",
        }),
      }),
      liveRes,
    );
    assert.equal(liveRes.code, 200);
    const liveBody = JSON.parse(liveRes.body);
    assert.equal(liveBody.ok, true);
    assert.equal(liveBody.forgeModel, "glm");
    assert.equal(liveBody.mode, "writing");
    assert.equal(liveBody.turns, 2);
    assert.equal(liveBody.usage.total, 18);
  } finally {
    mockGateway.close();
  }

  const badJsonRes = fake();
  await route.handler(
    makeReq("POST", "/promptkeel/api/policy", {
      headers: { "content-type": "application/json" },
      body: "{bad",
    }),
    badJsonRes,
  );
  assert.equal(badJsonRes.code, 400);

  const badPolicyRes = fake();
  await route.handler(
    makeReq("POST", "/promptkeel/api/policy", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: "invalid-policy" }),
    }),
    badPolicyRes,
  );
  assert.equal(badPolicyRes.code, 400);

  const badTypeRes = fake();
  await route.handler(
    makeReq("POST", "/promptkeel/api/policy", {
      headers: { "content-type": "text/plain" },
      body: "strict",
    }),
    badTypeRes,
  );
  assert.equal(badTypeRes.code, 415);

  const notFoundRes = fake();
  await route.handler(makeReq("GET", "/promptkeel/api/no-such-op"), notFoundRes);
  assert.equal(notFoundRes.code, 404);
});
