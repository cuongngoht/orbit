// One writer at a time, for every store writer (src/store/lock.mjs) -- and a lock directory the place refuses to make is
// a refused write, said at once as one, never another session holding it. Except that EPERM is two things: a sandbox or
// a read-only place refusing, and -- on Windows -- a mkdir racing another process that is REMOVING the lock directory, a
// release in flight that is gone in milliseconds. Read as a refusal, that race cost a writer its write (a trail line
// dropped; 0.5.0 review of B7). An EPERM is now waited on for PASSING attempts, as a held lock is, and refused only once
// it persists; EACCES and EROFS never pass. No real Windows is needed: the error goes in through the io port the lock
// already takes, and the port's clock ticks instead of sleeping.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Blocked } from "../src/errors.mjs";
import { BACKOFF, PASSING, withLock } from "../src/store/lock.mjs";
import { fakeIo } from "./fakes/io.mjs";

// The lock directory's mkdir answers `code` for its first `times` attempts; every other mkdir is the port's own.
function refusing(io, code, times) {
  const seen = { tries: 0 };
  const mkdir = io.mkdir;
  io.mkdir = (p) => (p.endsWith(".lock") && seen.tries++ < times ? thrown(code) : mkdir(p));
  return seen;
}

const thrown = (code) => {
  throw Object.assign(new Error(code), { code });
};

const waitsOf = (attempts) => BACKOFF.slice(0, attempts).reduce((a, b) => a + b, 0);

test("an EPERM that passes -- a release racing the mkdir, on Windows -- is waited out like a held lock, and the write goes on", () => {
  const io = fakeIo();
  const seen = refusing(io, "EPERM", PASSING.EPERM);
  assert.equal(withLock("/store/room", () => "wrote", io), "wrote");
  assert.equal(seen.tries, PASSING.EPERM + 1, "asked again until the directory was made");
  assert.equal(io.state.slept, waitsOf(PASSING.EPERM), "it waited as for a held lock, its own backoff");
  assert.equal(io.dirs.has("/store/room/.lock"), false, "and let go of it");
});

test("an EPERM that persists is a refused write after a bounded few attempts -- never the whole backoff, never another session", () => {
  const io = fakeIo();
  const seen = refusing(io, "EPERM", Infinity);
  assert.throws(() => withLock("/store/room", () => assert.fail("nothing runs"), io), (e) => e instanceof Blocked && /cannot be written here \(EPERM\).*this is not another session/.test(e.message));
  assert.deepEqual([seen.tries, io.state.slept], [PASSING.EPERM + 1, waitsOf(PASSING.EPERM)], "tens of milliseconds, never the whole backoff");
  assert.ok(waitsOf(PASSING.EPERM) < waitsOf(BACKOFF.length) / 50);
});

test("EACCES and EROFS never pass: a refused write at once, with nothing waited for", () => {
  for (const code of ["EACCES", "EROFS"]) {
    const io = fakeIo();
    const seen = refusing(io, code, Infinity);
    assert.throws(() => withLock("/store/room", () => assert.fail("nothing runs"), io), (e) => e instanceof Blocked && e.message.includes(`cannot be written here (${code})`));
    assert.deepEqual([seen.tries, io.state.slept], [1, 0], `${code}: nothing waited for a writer that does not exist`);
  }
});

test("a port whose backoff is shorter than the passing attempts still ends on the refusal, never on another session", () => {
  const io = fakeIo({ backoff: [1] });
  refusing(io, "EPERM", Infinity);
  assert.throws(() => withLock("/store/room", () => assert.fail("nothing runs"), io), (e) => e instanceof Blocked && /cannot be written here \(EPERM\)/.test(e.message));
});
