// ORBIT'S OWN SIGN-IN, as the API holds every request body to it: what is accepted (and as what), and what is refused
// with which words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkChangePassword, checkLogin, checkSetup, checkUpdateAccountProfile, checkUpdateProfile, IDENTITY_LIMITS, isTimeZoneName, normalizeUsername, passwordProblems } from "./identity.js";
import type { Checked } from "./validate.js";

const errorsOf = <T>(c: Checked<T>): string[] => (c.ok ? [] : c.errors);
const has = (errors: readonly string[], needle: string): void => assert.ok(errors.some((e) => e.includes(needle)), `"${needle}" in ${JSON.stringify(errors)}`);

const GOOD = "correct horse battery staple";

test("a username is 2-32 lower-case letters, digits, dots, dashes or underscores, starting with a letter", () => {
  assert.deepEqual([" Admin ", "ops.team_1", "a-b", `a${"x".repeat(31)}`].map(normalizeUsername), ["admin", "ops.team_1", "a-b", `a${"x".repeat(31)}`]);
  for (const bad of ["a", "1admin", "_admin", "ad min", "admin!", "x".repeat(33), "", 7, null]) assert.equal(normalizeUsername(bad), null, String(bad));
});

test("a password: 12 characters at least, not the username, not one or two characters repeated, not a sequence, not a common one", () => {
  assert.deepEqual(passwordProblems(GOOD), []);
  assert.deepEqual(passwordProblems("Tr0ub4dor&3x", "admin"), []);
  assert.deepEqual(passwordProblems(42), ["password must be text"]);
  has(passwordProblems("short1!"), `at least ${IDENTITY_LIMITS.passwordMin} characters`);
  has(passwordProblems("x7".repeat(129)), `at most ${IDENTITY_LIMITS.passwordMax} characters`);
  assert.deepEqual(passwordProblems("my-ADMIN-password-1", "admin"), ["password must not contain the username"]);
  assert.deepEqual(passwordProblems("my-ADMIN-password-1"), [], "without a username nothing is compared");
  for (const repeated of ["aaaaaaaaaaaaaa", "abababababab"]) has(passwordProblems(repeated), "must not repeat one or two characters");
  for (const sequence of ["abcdefghijklmnop", "123456123456", "ZXCVBNM"]) has(passwordProblems(sequence), "must not be a keyboard or number sequence");
  for (const common of ["passwordpassword", "Welcome12345"]) has(passwordProblems(common), "one of the commonest passwords");
  // The trial seed's password is refused here like any other: only the server waives the rules, for that seed alone.
  assert.ok(passwordProblems("123456").length >= 2);
});

test("a time zone is a name the runtime knows", () => {
  for (const ok of ["Asia/Ho_Chi_Minh", "UTC", "Europe/Kyiv", "America/Argentina/Buenos_Aires", "Etc/GMT+7"]) assert.equal(isTimeZoneName(ok), true, ok);
  for (const bad of ["Mars/Olympus", "", " Asia/Ho_Chi_Minh", "x".repeat(65), 7, null]) assert.equal(isTimeZoneName(bad), false, String(bad));
});

test("a login names a username and a password, nothing else", () => {
  assert.deepEqual(checkLogin({ username: "  Admin ", password: "pw" }), { ok: true, value: { username: "admin", password: "pw" } });
  assert.deepEqual(checkLogin("admin:pw"), { ok: false, errors: ["the body must be a JSON object"] });
  assert.deepEqual(errorsOf(checkLogin({ username: " ", password: "", remember: true })), ["remember is not a field of this request", "username is required", "password is required"]);
  assert.deepEqual(errorsOf(checkLogin({ username: "x".repeat(65), password: "pw" })), ["username is required"]);
  assert.deepEqual(errorsOf(checkLogin({ username: "admin", password: "x".repeat(IDENTITY_LIMITS.passwordMax + 1) })), ["password is required"]);
});

const SETUP = { code: "ABCD-EFGH-1234", username: "Owner", password: GOOD, fullName: "  Ada   Lovelace ", companyName: "Analytical Engines", timezone: "Asia/Ho_Chi_Minh", contactEmail: " Ada@Example.COM " };

test("the first administrator: the setup code, a username (admin when none is given), a good password, a name and a time zone", () => {
  assert.deepEqual(checkSetup(SETUP), { ok: true, value: { code: "ABCD-EFGH-1234", username: "owner", password: GOOD, fullName: "Ada Lovelace", companyName: "Analytical Engines", timezone: "Asia/Ho_Chi_Minh", contactEmail: "ada@example.com" } });
  assert.deepEqual(checkSetup({ code: "  12345678  ", password: GOOD, fullName: "Ada", timezone: "UTC" }), { ok: true, value: { code: "12345678", username: "admin", password: GOOD, fullName: "Ada", companyName: "", timezone: "UTC", contactEmail: null } });
  const wrong = errorsOf(checkSetup({ code: "short", username: "1st", password: GOOD, fullName: "", companyName: "x".repeat(121), timezone: "Mars/Olympus", contactEmail: "not-an-email", role: "owner" }));
  for (const needle of ["role is not a field of this request", "code must be the one-time setup code printed on the server", "username must be 2-32 lower-case letters", "fullName must be 1-120 printable characters", "companyName must be at most 120 printable characters", "timezone must be an IANA time zone (Asia/Ho_Chi_Minh)", "contactEmail must be an email address"]) has(wrong, needle);
  has(errorsOf(checkSetup({ ...SETUP, username: "admin", password: "the-admin-of-orbit-web" })), "password must not contain the username");
  has(errorsOf(checkSetup({ ...SETUP, password: "123456" })), "at least 12 characters");
  assert.deepEqual(checkSetup(null), { ok: false, errors: ["the body must be a JSON object"] });
});

test("a new password follows the same rules and is not the current one", () => {
  assert.deepEqual(checkChangePassword({ currentPassword: "123456", newPassword: GOOD }, "admin"), { ok: true, value: { currentPassword: "123456", newPassword: GOOD } });
  assert.deepEqual(errorsOf(checkChangePassword({ currentPassword: GOOD, newPassword: GOOD }, "admin")), ["newPassword must differ from the current one"]);
  const e = errorsOf(checkChangePassword({ currentPassword: "", newPassword: "short", extra: 1 }, "admin"));
  for (const needle of ["extra is not a field of this request", "currentPassword is required", "at least 12 characters"]) has(e, needle);
  has(errorsOf(checkChangePassword({ currentPassword: "x", newPassword: "my admin password!" }, "admin")), "must not contain the username");
});

test("a person's profile change names a full name or an email; an empty email removes it", () => {
  assert.deepEqual(checkUpdateProfile({ fullName: " Ada  King " }), { ok: true, value: { fullName: "Ada King" } });
  assert.deepEqual(checkUpdateProfile({ email: "" }), { ok: true, value: { email: null } });
  assert.deepEqual(checkUpdateProfile({ email: null }), { ok: true, value: { email: null } });
  assert.deepEqual(checkUpdateProfile({ email: " ADA@example.com" }), { ok: true, value: { email: "ada@example.com" } });
  assert.deepEqual(errorsOf(checkUpdateProfile({})), ["nothing to change: send fullName or email"]);
  assert.deepEqual(errorsOf(checkUpdateProfile({ email: "ada@" })), ["email must be an email address"]);
  assert.deepEqual(errorsOf(checkUpdateProfile({ fullName: "Ada\u0007" })), ["fullName must be 1-120 printable characters"]);
  assert.deepEqual(errorsOf(checkUpdateProfile({ fullName: "Ada", role: "owner" })), ["role is not a field of this request"]);
});

test("the account's profile: each field checked, only what is sent changes", () => {
  assert.deepEqual(checkUpdateAccountProfile({ displayName: " Octo ", companyName: "", contactEmail: null, timezone: "Europe/Berlin", locale: "en-US" }), { ok: true, value: { displayName: "Octo", companyName: "", contactEmail: null, timezone: "Europe/Berlin", locale: "en-US" } });
  assert.deepEqual(checkUpdateAccountProfile({ locale: "vi" }), { ok: true, value: { locale: "vi" } });
  assert.deepEqual(errorsOf(checkUpdateAccountProfile({})), ["nothing to change"]);
  const e = errorsOf(checkUpdateAccountProfile({ timezone: "Mars/Olympus", locale: "english", contactEmail: "nope", displayName: "x".repeat(121), owner: "me" }));
  for (const needle of ["owner is not a field of this request", "timezone must be an IANA time zone", "locale must look like en or en-US", "contactEmail must be an email address", "displayName must be at most 120 printable characters"]) has(e, needle);
  assert.deepEqual(checkUpdateAccountProfile([]), { ok: false, errors: ["the body must be a JSON object"] });
});
