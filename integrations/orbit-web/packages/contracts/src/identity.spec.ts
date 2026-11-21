import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAccessPeople,
  checkChangePassword,
  checkPasswordReset,
  checkSetup,
  normalizeSetupCode,
  passwordProblems,
  SHARE_PEOPLE_MAX,
  shareAddressOf,
  shareRecipientOf,
} from "./identity.js";

const SETUP = { code: "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01", username: "Ada", password: "a long first password", fullName: "Ada Admin", timezone: "Europe/Paris" };

test("a new password is long enough, and none of the obvious ones", () => {
  assert.deepEqual(passwordProblems("correct horse battery staple"), []);
  for (const bad of ["short", "123456", "aaaaaaaaaaaaaaaa", "abababababababab", "abcdefghijklmn", "1234567890123", "passwordpassword", "x".repeat(257)]) {
    assert.notDeepEqual(passwordProblems(bad), [], bad);
  }
  assert.match(passwordProblems("ada-has-a-long-password", "ada").join(";"), /must not contain the username/);
  assert.deepEqual(passwordProblems(42), ["password must be text"]);
});

test("a setup names a code, a username, a password that follows the rules, a name and a time zone -- and nothing else", () => {
  const ok = checkSetup(SETUP);
  assert.ok(ok.ok);
  assert.deepEqual([ok.value.username, ok.value.companyName, ok.value.contactEmail], ["ada", "", null], "the username lower-cased; the rest optional");
  for (const [field, value] of [["code", "short"], ["username", "1ada"], ["password", "123456"], ["fullName", ""], ["timezone", "Mars/Olympus"], ["contactEmail", "not an address"], ["role", "owner"]] as const) {
    assert.equal(checkSetup({ ...SETUP, [field]: value }).ok, false, `${field}=${value}`);
  }
});

test("a one-time code is compared without its dashes, spaces and case", () => {
  assert.equal(normalizeSetupCode(" abcd-efgh jkmn-PQRS "), "ABCDEFGHJKMNPQRS");
});

test("a password reset names the user the code was printed for, and a new password that follows the rules", () => {
  assert.ok(checkPasswordReset({ code: SETUP.code, username: "ada", password: "another long password" }).ok);
  assert.ok(checkPasswordReset({ code: SETUP.code, username: "ada", password: "another long password", fullName: "ignored", timezone: "UTC" }).ok, "what the setup page also sends is allowed");
  assert.equal(checkPasswordReset({ code: SETUP.code, username: "ada", password: "123456789012" }).ok, false);
  assert.equal(checkPasswordReset({ code: SETUP.code, password: "another long password" }).ok, false);
});

test("a changed password differs from the current one", () => {
  assert.ok(checkChangePassword({ currentPassword: "old long password", newPassword: "a new long password" }, "ada").ok);
  assert.equal(checkChangePassword({ currentPassword: "a new long password", newPassword: "a new long password" }, "ada").ok, false);
  assert.equal(checkChangePassword({ newPassword: "a new long password" }, "ada").ok, false);
});

test("a share names a user by username or by an email address; the server decides whether that email is a verified one", () => {
  assert.deepEqual(shareRecipientOf(" Bob "), { kind: "username", username: "bob" });
  assert.deepEqual(shareRecipientOf("Bob@Example.com"), { kind: "email", email: "bob@example.com" });
  assert.deepEqual(shareRecipientOf(shareAddressOf("bob")), { kind: "email", email: "bob@users.orbit.local" }, "a share address is an email like any other");
  for (const bad of ["", "1bob", "bob@", "@example.com", 7, null]) assert.equal(shareRecipientOf(bad), null, String(bad));
  const people = checkAccessPeople({ people: ["bob", "BOB", "carol@example.com"] });
  assert.ok(people.ok);
  assert.deepEqual(people.value.people, [{ kind: "username", username: "bob" }, { kind: "email", email: "carol@example.com" }], "named twice, kept once");
  assert.ok(checkAccessPeople({ people: [] }).ok, "shared with nobody");
  assert.equal(checkAccessPeople({ people: ["bob", "not an address@"] }).ok, false);
  assert.equal(checkAccessPeople({ people: Array.from({ length: SHARE_PEOPLE_MAX + 1 }, (_, i) => `user${i}`) }).ok, false);
  assert.equal(checkAccessPeople({ people: "bob" }).ok, false);
});
