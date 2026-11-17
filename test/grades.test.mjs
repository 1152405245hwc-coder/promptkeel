import test from "node:test";
import assert from "node:assert/strict";
import { GRADES, HOST_GRADES, gradeOf, gradeTable } from "../core/grades.mjs";
import { listProfiles, loadProfile, loadModel } from "../core/contract.mjs";
import { compile } from "../core/compile.mjs";

test("every host used by a profile carries a grade", () => {
  const hosts = new Set(listProfiles().map((profile) => profile.host));
  for (const host of hosts) {
    assert.ok(HOST_GRADES[host], `${host} has no grade`);
    assert.ok(GRADES.includes(HOST_GRADES[host].grade), `${host} declares an unknown grade`);
    assert.ok(HOST_GRADES[host].mechanism.length > 20, `${host} explains its mechanism`);
  }
});

test("grades match the measured delivery evidence", () => {
  assert.equal(gradeOf({ host: "dsh" }).grade, "replace-with-residue");
  assert.equal(gradeOf({ host: "dsh" }).source, "measured");
  assert.equal(gradeOf({ host: "generic" }).grade, "unobservable");
  assert.equal(gradeOf({ host: "claude-code" }).grade, "append-only");
  assert.equal(gradeOf({ host: "codex" }).grade, "replace-full");
});

test("an unknown host grades unobservable with no source", () => {
  const row = gradeOf({ host: "not-a-host" });
  assert.equal(row.grade, "unobservable");
  assert.equal(row.source, "none");
  assert.match(row.mechanism, /no grading recorded/);
});

test("append-only hosts without a shim report the improvement", () => {
  const row = gradeOf({ host: "cursor", __channels: { shim: 0 } });
  assert.equal(row.grade, "append-only");
  assert.equal(row.improvements.length, 1);
  const withShim = gradeOf({ host: "cursor", __channels: { shim: 1 } });
  assert.equal(withShim.improvements.length, 0);
});

test("gradeTable covers every profile and keeps support level", () => {
  const rows = gradeTable(listProfiles());
  assert.equal(rows.length, listProfiles().length);
  const dsh = rows.find((row) => row.id === "dsh");
  assert.equal(dsh.support, "verified");
  assert.equal(dsh.grade, "replace-with-residue");
});

test("compile reports delivery alongside channels", () => {
  const plan = compile(loadProfile("dsh"), loadModel("deepseek"), {});
  assert.ok(GRADES.includes(plan.delivery.grade));
  assert.equal(plan.delivery.grade, "replace-with-residue");
  assert.ok(plan.channels.counts.install > 0);
});
