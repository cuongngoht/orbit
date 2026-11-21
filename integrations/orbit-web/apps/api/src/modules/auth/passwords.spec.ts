import assert from "node:assert/strict";
import { test } from "node:test";
import { PRODUCTION_KDF } from "../../config/config.js";
import { hashPassword, needsRehash, verifyPassword } from "./passwords.js";
import { lockFor, LOCK_EVERY } from "./throttle.js";
import { newSetupCode, setupCodeHash } from "./setup-codes.js";

const CHEAP = { N: 2 ** 10, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

test("a password is kept as scrypt with its own salt and its cost; only the same password matches", async () => {
  const a = await hashPassword("correct horse battery staple", CHEAP);
  const b = await hashPassword("correct horse battery staple", CHEAP);
  assert.match(a, /^scrypt\$1024\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b, "a salt of its own each time");
  assert.equal(await verifyPassword("correct horse battery staple", a), true);
  assert.equal(await verifyPassword("correct horse battery stapler", a), false);
  assert.equal(await verifyPassword("", a), false);
  for (const bad of ["", "plain", "scrypt$3$8$1$c2FsdA$a2V5", "bcrypt$10$x", `${a}$extra`, a.replace("$1024$", "$1023$")]) assert.equal(await verifyPassword("x", bad), false, bad);
});

test("production's cost is N=2^17, r=8, p=1 -- a hash at another cost is made again at the next sign-in", async () => {
  assert.deepEqual([PRODUCTION_KDF.N, PRODUCTION_KDF.r, PRODUCTION_KDF.p], [2 ** 17, 8, 1]);
  const cheap = await hashPassword("correct horse battery staple", CHEAP);
  assert.equal(needsRehash(cheap, PRODUCTION_KDF), true);
  assert.equal(needsRehash(cheap, CHEAP), false);
});

test("a user is locked after every ten failures in a row, for a while that doubles, at most a day", () => {
  assert.equal(lockFor(LOCK_EVERY - 1), null);
  assert.equal(lockFor(LOCK_EVERY), 15 * 60_000);
  assert.equal(lockFor(LOCK_EVERY * 2), 30 * 60_000);
  assert.equal(lockFor(LOCK_EVERY * 20), 24 * 60 * 60_000);
});

test("a setup code is 120 random bits a person can type, compared without its dashes and case", () => {
  const { code, hash } = newSetupCode();
  assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
  assert.doesNotMatch(code, /[ILOU]/, "no letter that reads as another");
  assert.equal(setupCodeHash(code.toLowerCase().replaceAll("-", " ")), hash);
  assert.notEqual(newSetupCode().code, code);
});
