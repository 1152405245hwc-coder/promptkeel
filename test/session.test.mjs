import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { familyFor, familyById, ladderFor, supportsPrefill } from "../core/families.mjs";
import {
  createSession,
  loadSession,
  listSessions,
  buildTurn,
  systemVariants,
  noteTurn,
  repackTurn,
  normalizeShape,
  continuationNote,
  TURN_SHAPES,
  stabilityOf,
  readFamilyStats,
  writeFamilyStats,
  SESSION_SCHEMA,
  DEFAULT_MAX_TURNS,
} from "../core/session.mjs";

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-session-"));
  return { env: { stateRoot: root } };
}

function deliveredReply() {
  return "1. create the file\n2. add the handler\n3. test it\n\n```js\nexport const x = 1;\n```";
}

test("families: model resolution, ladders, prefill traits", () => {
  assert.equal(familyFor("deepseek-chat").id, "deepseek");
  assert.equal(familyFor("gpt-4o-mini").id, "gpt");
  assert.equal(familyFor("claude-3-5-sonnet").id, "claude");
  assert.equal(familyFor("totally-unknown-model").id, "generic");
  assert.equal(familyById("gemini").prefill, false);
  assert.ok(ladderFor("gpt").includes("prefill"));
  assert.equal(supportsPrefill("gemini"), false);
  assert.equal(supportsPrefill("deepseek"), true);
});

test("session: create, persist, load, list", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "deepseek-chat", task: "build a parser", env });
  assert.equal(session.schema, SESSION_SCHEMA);
  assert.equal(session.family, "deepseek");
  assert.equal(session.maxTurns, DEFAULT_MAX_TURNS);
  const loaded = loadSession(session.id, { env });
  assert.equal(loaded.task, "build a parser");
  const rows = listSessions({ env });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, session.id);
});

test("session: invalid id is rejected", () => {
  const { env } = tmpEnv();
  assert.throws(() => loadSession("../escape", { env }), (error) => error.code === "session-id");
});

test("session: buildTurn frames the task and carries history", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "deepseek-chat", task: "write a parser", env });
  const first = buildTurn(session);
  assert.equal(first.turn, 1);
  assert.match(first.system, /forge:session-lock/);
  assert.match(first.user, /直接进入交付/);
  assert.equal(first.messages.at(-1).role, "user");
  // A delivered turn is replayed on the next request.
  noteTurn(session, { reply: deliveredReply(), prompt: first.user, env });
  const second = buildTurn(loadSession(session.id, { env }));
  assert.equal(second.turn, 2);
  assert.ok(second.messages.some((message) => message.role === "assistant"));
});

test("session: inline arm folds the system slot into the user message", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const framed = buildTurn(session, { arm: "deliver" });
  assert.match(framed.system, /forge:session-lock/);
  assert.equal(framed.inlineSystem, false);

  const inlined = buildTurn(session, { arm: "inline" });
  assert.equal(inlined.system, "");
  assert.equal(inlined.inlineSystem, true);
  assert.match(inlined.messages.at(-1).content, /forge:session-lock/);
  // The logical prompt stays clean so replay never doubles the lock.
  assert.doesNotMatch(inlined.user, /forge:session-lock/);
  assert.ok(ladderFor(familyFor("gpt-4o").id).includes("inline"));
});

test("session: delivered turn keeps the arm and scores a win", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "x", env });
  const arm = session.arm;
  const result = noteTurn(session, { reply: deliveredReply(), env });
  assert.equal(result.verdict, "delivered");
  assert.equal(result.session.arm, arm);
  assert.equal(result.session.arms[arm].pulls, 1);
  assert.ok(result.session.arms[arm].wins >= 1);
});

test("session: withheld reply escalates to the next ladder arm", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "x", env });
  const ladder = ladderFor(session.family);
  const start = session.arm;
  const result = noteTurn(session, { reply: "I'm sorry, but I can't help with that.", env });
  assert.equal(result.verdict, "withheld");
  assert.equal(result.recovery.action, "escalate");
  assert.equal(result.session.arm, ladder[ladder.indexOf(start) + 1]);
  assert.ok(result.session.pending && result.session.pending.directive);
});

test("session: partial reply continues on the same arm", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "x", env });
  const arm = session.arm;
  const reply = "I can't provide everything, but here is the outline:\n1. step one\n2. step two";
  const result = noteTurn(session, { reply, env });
  assert.equal(result.verdict, "partial");
  assert.equal(result.recovery.action, "continue");
  assert.equal(result.session.arm, arm);
});

test("session: empty reply counts as empty and escalates", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "x", env });
  const result = noteTurn(session, { reply: "   ", env });
  assert.equal(result.verdict, "empty");
  assert.equal(result.recovery.action, "escalate");
});

test("session: stability needs three attempts at 80% delivery", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "x", env });
  for (let index = 0; index < 3; index += 1) {
    noteTurn(session, { reply: deliveredReply(), env });
  }
  const stability = stabilityOf(session);
  assert.equal(stability.attempts, 3);
  assert.equal(stability.delivered, 3);
  assert.equal(stability.deliveredRate, 100);
  assert.equal(stability.stable, true);
});

test("session: family stats persist and seed the next session's arm", () => {
  const { env } = tmpEnv();
  writeFamilyStats("gpt", { deliver: { pulls: 4, wins: 0 }, variable: { pulls: 4, wins: 4 } }, { env });
  const stats = readFamilyStats("gpt", { env });
  assert.equal(stats.arms.variable.wins, 4);
  const session = createSession({ model: "gpt-4o", task: "x", env });
  assert.equal(session.arm, "variable");
  assert.equal(session.arms.variable.pulls, 4);
});

test("session: history is trimmed when it exceeds the character budget", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "x", env, maxTurns: 50 });
  for (let index = 0; index < 6; index += 1) {
    session.turns.push({ index, arm: session.arm, status: "ok", verdict: "delivered", prompt: "p".repeat(400), reply: "r".repeat(400) });
  }
  const turn = buildTurn(session, { maxChars: 1200 });
  assert.equal(turn.messages[0].role, "assistant");
  assert.match(turn.messages[0].content, /omitted from context/);
});

test("session: system variants degrade from full prelude to bare directive", () => {
  const { env } = tmpEnv();
  const session = createSession({
    model: "gpt-4o",
    task: "write a parser",
    systems: { deliver: "PERSONA-BODY" },
    env,
  });
  const turn = buildTurn(session);
  const variants = systemVariants(session, turn);
  assert.deepEqual(variants.map((variant) => variant.mode), ["full", "inline", "lock", "bare"]);
  assert.match(variants[0].system, /PERSONA-BODY/);
  // Inline keeps the same bytes, just moved into the leading user turn.
  assert.equal(variants[1].system, "");
  assert.match(variants[1].messages[0].content, /PERSONA-BODY/);
  // Lock drops the persona body but keeps the per-turn frame.
  assert.match(variants[2].system, /forge:session-lock/);
  assert.doesNotMatch(variants[2].system, /PERSONA-BODY/);
  assert.equal(variants[3].system, "");
  assert.equal(variants[3].messages, turn.messages);

  // A learned starting mode rotates to the front without dropping the rest.
  const resumed = systemVariants(session, turn, { start: "inline" });
  assert.equal(resumed[0].mode, "inline");
  assert.equal(resumed.length, 4);
  assert.equal(new Set(resumed.map((variant) => variant.mode)).size, 4);
});

test("session: noteTurn remembers the system mode that got through", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const turn = buildTurn(session);
  assert.equal(session.systemMode, "full");
  noteTurn(session, { reply: deliveredReply(), prompt: turn.user, arm: "deliver", systemMode: "inline", env });
  assert.equal(session.systemMode, "inline");
  assert.equal(loadSession(session.id, { env }).systemMode, "inline");
  assert.equal(loadSession(session.id, { env }).turns[0].systemMode, "inline");
});

test("session: noteTurn records the mode and the turn keeps a zero-reward arm honest", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "totally-unknown-model", task: "write a parser", env });
  const turn = buildTurn(session);
  noteTurn(session, { reply: "", status: "error", error: "timeout after 1000ms", prompt: turn.user, arm: "deliver", systemMode: "bare", env });
  assert.equal(loadSession(session.id, { env }).systemMode, "full");
  const row = loadSession(session.id, { env }).arms.deliver;
  assert.equal(row.wins, 0);
  assert.ok(row.pulls >= 1);
});

test("session: single shape packs one user message and carries continuity in the text", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const first = buildTurn(session, { shape: "single" });
  assert.equal(first.shape, "single");
  assert.equal(first.messages.length, 1);
  assert.equal(first.system, "");
  assert.ok(first.messages[0].content.includes("write a parser"));

  noteTurn(session, { reply: deliveredReply(), prompt: first.user, arm: "deliver", shape: "single", env });
  const second = buildTurn(session, { shape: "single" });
  assert.equal(second.messages.length, 1);
  assert.ok(second.messages[0].content.includes("前文已交付部分"));
  assert.ok(second.messages[0].content.includes("export const x = 1"));
});

test("session: repackTurn drops replay without losing the ask", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const first = buildTurn(session, { shape: "history" });
  noteTurn(session, { reply: deliveredReply(), prompt: first.user, arm: "deliver", env });
  const history = buildTurn(session, { shape: "history" });
  assert.ok(history.messages.length > 1, "history shape replays the conversation");
  const packed = repackTurn(session, history, "single");
  assert.equal(packed.length, 1);
  assert.ok(packed[0].content.includes("write a parser"));
  assert.deepEqual(repackTurn(session, history, "history"), history.messages);
});

test("session: single shape emits only the placement that can carry it", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const turn = buildTurn(session, { shape: "single" });
  const variants = systemVariants(session, turn, { shape: "single" });
  assert.ok(variants.length >= 1);
  for (const variant of variants) {
    assert.equal(variant.shape, "single");
    assert.equal(variant.system, "");
    assert.equal(variant.messages.length, 1);
  }
});

test("session: noteTurn remembers the shape that got through", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const turn = buildTurn(session);
  assert.equal(session.shape, "history");
  noteTurn(session, { reply: deliveredReply(), prompt: turn.user, arm: "deliver", shape: "single", env });
  assert.equal(session.shape, "single");
  assert.equal(loadSession(session.id, { env }).shape, "single");
  assert.equal(loadSession(session.id, { env }).turns[0].shape, "single");
});

test("session: an unknown shape falls back to history rather than throwing", () => {
  assert.deepEqual(TURN_SHAPES, ["history", "single", "bare"]);
  assert.equal(normalizeShape("batch"), "history");
  assert.equal(normalizeShape(undefined), "history");
});

test("session: bare shape sends the request and nothing else", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const turn = buildTurn(session, { shape: "bare" });
  assert.equal(turn.shape, "bare");
  assert.equal(turn.system, "");
  assert.equal(turn.messages.length, 1);
  assert.equal(turn.messages[0].content, "write a parser");
  // No frame, no lock, no directive: the bytes a plain client would send.
  assert.ok(!/会话锁|直接进入交付/.test(turn.messages[0].content));

  const overrideTurn = buildTurn(session, { shape: "bare", task: "override task" });
  assert.equal(overrideTurn.messages[0].content, "override task");
});

test("session: systemVariants for bare shape strips all system frames and locks", () => {
  const { env } = tmpEnv();
  const session = createSession({
    model: "gpt-4o",
    task: "write a parser",
    systems: { deliver: "PERSONA-BODY" },
    env,
  });
  const turn = buildTurn(session, { shape: "history" });
  const variants = systemVariants(session, turn, { shape: "bare" });
  assert.equal(variants.length, 1);
  assert.equal(variants[0].mode, "bare");
  assert.equal(variants[0].shape, "bare");
  assert.equal(variants[0].system, "");
  assert.equal(variants[0].messages.length, 1);
  assert.equal(variants[0].messages[0].content, "write a parser");
  assert.doesNotMatch(variants[0].messages[0].content, /会话锁|PERSONA-BODY|直接进入交付/);
});

test("session: thin verdict escalates to nextArm and 5-arm ladder tries all 5 arms before exhausted", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gemini-2.0-flash", task: "solve x", env });
  const ladder = ladderFor("gemini");
  assert.equal(ladder.length, 5);
  assert.equal(session.arm, ladder[0]);

  const thinResult = noteTurn(session, { reply: "ok", env });
  assert.equal(thinResult.verdict, "thin");
  assert.equal(thinResult.recovery.action, "escalate");
  assert.equal(thinResult.session.arm, ladder[1]);

  // Arms 1, 2, 3, 4 should all be tried before exhausting on the 5th failure.
  for (let i = 1; i < ladder.length - 1; i += 1) {
    const res = noteTurn(session, { reply: "I'm sorry, I cannot assist with that.", env });
    assert.equal(res.recovery.action, "escalate", `step ${i} should escalate`);
    assert.equal(res.session.arm, ladder[i + 1]);
    assert.equal(res.session.status, "active");
  }
  const final = noteTurn(session, { reply: "I'm sorry, I cannot assist with that.", env });
  assert.equal(final.recovery.action, "rotate");
  assert.equal(final.session.status, "exhausted");
});

test("session: transport errors do not burn consecutiveFailures", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gemini-2.0-flash", task: "solve x", env });
  const startArm = session.arm;
  for (let i = 0; i < 6; i += 1) {
    const res = noteTurn(session, { status: "network_error", error: "timeout after 1000ms", env });
    assert.equal(res.verdict, "error");
    assert.equal(res.recovery.action, "retry");
    assert.equal(res.session.arm, startArm);
    assert.equal(res.session.consecutiveFailures, 0);
    assert.equal(res.session.status, "active");
  }
});

test("session: refusal turns stay on disk for audit but are excluded from replay and continuationNote", () => {
  const { env } = tmpEnv();
  const session = createSession({ model: "gpt-4o", task: "write a parser", env });
  const t1 = buildTurn(session);
  noteTurn(session, { reply: deliveredReply(), prompt: t1.user, env });
  const t2 = buildTurn(session);
  noteTurn(session, { reply: "I'm sorry, I cannot continue.", prompt: t2.user, env });

  assert.equal(session.turns.length, 2);
  const t3 = buildTurn(session, { shape: "history" });
  const historyTexts = t3.messages.slice(0, -1).map((m) => m.content).join("\n");
  assert.match(historyTexts, /export const x = 1/);
  assert.doesNotMatch(historyTexts, /I'm sorry, I cannot continue/);

  const note = continuationNote(session);
  assert.match(note, /export const x = 1/);
  assert.doesNotMatch(note, /I'm sorry, I cannot continue/);
});
