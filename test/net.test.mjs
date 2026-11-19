import test from "node:test";
import assert from "node:assert/strict";

import { hostnameOf, LOOPBACK } from "../core/net.mjs";

test("hostnameOf accepts plain authorities", () => {
  assert.equal(hostnameOf("127.0.0.1:55859"), "127.0.0.1");
  assert.equal(hostnameOf("localhost:7788"), "localhost");
  assert.equal(hostnameOf("[::1]:7788"), "::1");
  assert.equal(hostnameOf("LOCALHOST"), "localhost");
  assert.equal(hostnameOf("example.test:443"), "example.test");
});

test("hostnameOf rejects authorities that smuggle a second target", () => {
  for (const value of [
    "",
    "   ",
    `user${"@"}evil.test`,
    `user:pass${"@"}evil.test`,
    "evil.test/path",
    "evil.test?x=1",
    "evil.test#frag",
    "evil.test\\path",
    "http://evil.test",
    "//evil.test",
  ]) {
    assert.equal(hostnameOf(value), "", `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test("hostnameOf fails closed on unparseable values", () => {
  for (const value of ["[::1", "a b", "%%%"]) {
    assert.equal(hostnameOf(value), "", `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test("LOOPBACK is the fixed loopback allow-list", () => {
  assert.deepEqual([...LOOPBACK].sort(), ["127.0.0.1", "::1", "localhost"]);
});
