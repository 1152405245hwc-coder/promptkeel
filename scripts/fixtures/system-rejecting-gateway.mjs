#!/usr/bin/env node
// Fixture endpoint for the system-slot degradation path: any request carrying a
// role:"system" message is refused with 400 invalid_request, which is how some
// OpenAI-compatible proxies answer. Everything else gets a well-formed reply.
import http from "node:http";

const port = Number(process.env.PORT || 38480);
const body = {
  choices: [
    {
      message: {
        role: "assistant",
        content: "1. parse the input\n2. validate\n3. throw on failure\n\n```js\nexport function parseIso(s) {\n  const t = Date.parse(s);\n  if (Number.isNaN(t)) throw new Error(`invalid ISO date: ${s}`);\n  return t;\n}\n```",
      },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 90, completion_tokens: 60 },
};

const server = http.createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(raw || "{}"); } catch { parsed = {}; }
    const hasSystem = (parsed.messages || []).some((message) => message.role === "system");
    if (hasSystem) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: { message: "invalid_request", type: "invalid_request_error", code: "invalid_request" },
      }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`system-rejecting gateway on http://127.0.0.1:${port}/v1\n`);
});
