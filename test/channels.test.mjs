import test from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, TIMINGS, channelOf, summarizeChannels } from "../core/channels.mjs";
import { renderShim } from "../core/shim.mjs";
import { loadProfile, loadModel } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";

test("channelOf classifies every target kind the profiles use", () => {
  assert.deepEqual(channelOf({ kind: "dsh-patches" }), { kind: "dsh-patches", channel: "install", timing: "host-restart", id: null });
  assert.equal(channelOf({ kind: "markdown-block", scope: "project" }).channel, "project");
  assert.equal(channelOf({ kind: "json-merge", scope: "project" }).timing, "next-turn");
  assert.equal(channelOf({ kind: "prompt-only" }).channel, "none");
  assert.equal(channelOf({ kind: "file", scope: "user", path: "~/.dsh/prompt-inject.md" }).timing, "next-session");
});

test("channelOf keeps an absolute file inside the project on the project channel", () => {
  const inside = channelOf({ kind: "file", scope: "absolute", path: "/repo/AGENTS.md" }, { projectRoot: "/repo" });
  assert.equal(inside.channel, "project");
  const outside = channelOf({ kind: "file", scope: "absolute", path: "/etc/hosts" }, { projectRoot: "/repo" });
  assert.equal(outside.channel, "install");
});

test("channelOf rejects kinds it cannot classify", () => {
  assert.throws(() => channelOf({ kind: "telepathy" }), /unknown action kind/);
  assert.throws(() => channelOf({}), /unknown action kind/);
});

test("summarizeChannels reports counts, ordered channels, and the latest timing", () => {
  const summary = summarizeChannels([
    { kind: "dsh-patches", op: "dsh-patches" },
    { kind: "file", scope: "user", path: "~/.dsh/prompt-inject.md", op: "write-file" },
    { kind: "markdown-block", scope: "project", path: "AGENTS.md", op: "markdown-block" },
  ]);
  assert.deepEqual(summary.counts, { project: 1, install: 2, shim: 0, slash: 0, none: 0 });
  assert.deepEqual(summary.channels, ["project", "install"]);
  assert.equal(summary.timings.install, "host-restart");
  assert.ok(TIMINGS.includes(summary.timings.project));
  assert.deepEqual(CHANNELS, ["project", "install", "shim", "slash", "none"]);
});

test("the dsh plan delivers through install only", () => {
  const plan = compile(loadProfile("dsh"), loadModel("deepseek"), {});
  assert.deepEqual(plan.channels.counts, { project: 0, install: 2, shim: 0, slash: 0, none: 0 });
  assert.equal(plan.channels.timings.install, "host-restart");
});

test("a prompt-only profile reports no delivery channel", () => {
  const plan = compile(loadProfile("generic"), loadModel("local"), {});
  assert.deepEqual(plan.channels.counts, { project: 0, install: 0, shim: 0, slash: 0, none: 1 });
  assert.deepEqual(plan.channels.channels, ["none"]);
});

test("renderShim exports the prompt path, the env, and execs the binary", () => {
  const text = renderShim({ binary: "/usr/local/bin/host", promptPath: "/tmp/p.md", env: { HOST_PROMPT: "/tmp/p.md" } });
  assert.match(text, /^#!\/bin\/sh/);
  assert.match(text, /DSH_FORGE_PROMPT='\/tmp\/p\.md'/);
  assert.match(text, /\[ -f "\$DSH_FORGE_PROMPT" \]/);
  assert.match(text, /export HOST_PROMPT='\/tmp\/p\.md'/);
  assert.match(text, /exec '\/usr\/local\/bin\/host' "\$@"\n$/);
  assert.equal(text, renderShim({ binary: "/usr/local/bin/host", promptPath: "/tmp/p.md", env: { HOST_PROMPT: "/tmp/p.md" } }));
});

test("renderShim escapes single quotes and refuses malformed input", () => {
  const text = renderShim({ binary: "/bin/host", env: { NOTE: "it's here" } });
  assert.match(text, /export NOTE='it'\\''s here'/);
  assert.doesNotMatch(text, /DSH_FORGE_PROMPT=/);
  assert.throws(() => renderShim({}), /needs the host binary/);
  assert.throws(() => renderShim({ binary: "/bin/host", env: { "bad-name": "x" } }), /invalid environment name/);
  assert.throws(() => renderShim({ binary: "/bin/host", env: { OK: "a\nb" } }), /single line/);
  assert.throws(() => renderShim({ binary: "/bin/ho\nst" }), /single line/);
});
