// IDENTITY (Orbit Web 0.8.0, ADR 0061): Orbit's OWN sign-in, independent of every AI CLI. An ACCOUNT (its id is the
// OrbitId) is the tenant: every record of Orbit Web carries it. A USER signs in to one account with a username and a
// password Orbit keeps as a slow hash. The first administrator is made from a one-time setup code a person prints in a
// terminal of the server; a trial installation (localhost only) is pre-seeded with `admin` / `123456`.
//
// Connecting Claude Code, Codex or Antigravity is NOT signing in to Orbit: it is a connection of the account, made in
// Settings → AI Connections (ai-connections.ts), and signing in to Orbit never starts one.
import type { Checked } from "./validate.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;
const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => `${k} is not a field of this request`);
const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });
const NOT_OBJECT: Checked<never> = { ok: false, errors: ["the body must be a JSON object"] };

// The error code of every API call made without a session of THIS browser (HTTP 401): the web app answers it with the
// sign-in page.
export const SIGN_IN_REQUIRED = "sign_in_required";
// A first administrator must be set up before anybody can sign in (HTTP 409 on a login).
export const SETUP_REQUIRED = "setup_required";
export const INVALID_CREDENTIALS = "invalid_credentials";
export const TOO_MANY_ATTEMPTS = "too_many_attempts";
export const PASSWORD_CHANGE_REQUIRED = "password_change_required";
// A setup code that was used, expired, never issued -- or names another user than the one asked for (HTTP 400). Which
// of these it was is never said.
export const SETUP_CODE_INVALID = "setup_code_invalid";
// A first-administrator code used where an account exists already (HTTP 409).
export const SETUP_ALREADY_DONE = "setup_already_done";
// The username is another user's (HTTP 409): usernames are unique in the deployment.
export const USERNAME_TAKEN = "username_taken";
// A change named a version (If-Match) that is not the record's any more (HTTP 412), or named none where one is needed
// (HTTP 428).
export const STALE_VERSION = "stale_version";
export const PRECONDITION_REQUIRED = "precondition_required";
// A share named somebody who is not a user of this deployment, or an email that is no user's VERIFIED email (HTTP 400).
export const SHARE_RECIPIENT_UNKNOWN = "share_recipient_unknown";

// Why a one-time setup code was printed (`cli/governance.js owner setup-code | reset-password`).
export const SETUP_CODE_PURPOSES = ["first_admin", "new_account", "reset_password"] as const;
export type SetupCodePurpose = (typeof SETUP_CODE_PURPOSES)[number];

// THE SHARE ADDRESS of a user: what a chat or a research workspace is shared with, and what a share is matched against.
// It is the user's VERIFIED email when they have one; otherwise an address of this deployment's own that no mail ever
// reaches (`<username>@users.orbit.local`) -- so a user with no verified email can still be shared with, by username.
export const SHARE_ADDRESS_DOMAIN = "users.orbit.local";
export const shareAddressOf = (username: string): string => `${username}@${SHARE_ADDRESS_DOMAIN}`;

// The id of an Orbit account: the tenant every record belongs to. A branded string, so an id of anything else is not
// passed where an account's is expected.
export type OrbitId = string & { readonly __orbitId: unique symbol };

export const USER_ROLES = ["owner"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  // Only a verified email takes part in sharing.
  emailVerified: boolean;
  role: UserRole;
  // The trial seed's password, or one an operator reset: the page asks for a new one.
  mustChangePassword: boolean;
  // The trial seed's `123456` is still this user's password (only the trial account's user ever has it).
  trialPassword: boolean;
  lastLoginAt: string | null;
  // What others share with this user by (shareAddressOf): the verified email, or the username's own address.
  shareAddress: string;
  // For If-Match on PATCH /api/auth/profile.
  version: number;
}

export interface AuthAccount {
  orbitId: string;
  displayName: string;
  companyName: string;
  contactEmail: string | null;
  // IANA time zone: the default of the account's schedules.
  timezone: string;
  locale: string;
  createdAt: string;
  version: number;
}

// THIS browser's session: what every change carries (`csrfToken` in CSRF_HEADER).
export interface AuthSession {
  orbitId: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}

export interface TrialMode {
  // The installation runs as a localhost-only trial (ORBIT_WEB_TRIAL): the seeded `admin` / `123456` exists.
  enabled: boolean;
  username: string | null;
  password: string | null;
}

// GET /api/auth/status -- public: what the page shows before anything else.
export interface AuthStatus {
  state: "signed_in" | "signed_out" | "setup_required";
  session: AuthSession | null;
  user: AuthUser | null;
  account: AuthAccount | null;
  trial: TrialMode;
  // A test installation's standing setup code (ORBIT_WEB_SETUP_CODE), for the setup page to fill in: only while nobody
  // is set up (`setup_required`), null otherwise and wherever the operator set none.
  setupCode: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

// The first administrator (or an operator's reset): the one-time code printed by `cli/governance.js owner setup-code`.
export interface SetupRequest {
  code: string;
  username: string;
  password: string;
  fullName: string;
  companyName?: string;
  timezone: string;
  contactEmail?: string | null;
}

// A password reset (`cli/governance.js owner reset-password` printed the code for exactly this user): the same route as
// the setup, POST /api/auth/setup -- the page's other fields are allowed and ignored.
export interface PasswordResetRequest {
  code: string;
  username: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateProfileRequest {
  fullName?: string;
  email?: string | null;
}

export interface UpdateAccountProfileRequest {
  displayName?: string;
  companyName?: string;
  contactEmail?: string | null;
  timezone?: string;
  locale?: string;
}

export interface SessionView {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export const IDENTITY_LIMITS = { usernameLength: 32, passwordMin: 12, passwordMax: 256, nameLength: 120, codeLength: 64 } as const;

const USERNAME = /^[a-z][a-z0-9._-]{1,31}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export const normalizeUsername = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const u = v.trim().toLowerCase();
  return USERNAME.test(u) ? u : null;
};

const emailOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
};

const nameOf = (v: unknown, max: number = IDENTITY_LIMITS.nameLength): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= max && !CONTROL.test(t) ? t : null;
};

export function isTimeZoneName(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

// The commonest passwords, refused whatever their length (a short list on purpose: the length rule does most of the work).
const COMMON = new Set([
  "123456789012",
  "1234567890123",
  "password1234",
  "passwordpassword",
  "qwertyuiop12",
  "qwertyuiopas",
  "iloveyou1234",
  "adminadmin12",
  "administrator",
  "letmein12345",
  "welcome12345",
  "changeme1234",
  "orbitorbit12",
  "abcdefghijkl",
]);

const SEQUENCES = ["0123456789", "9876543210", "abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

// What makes a password unacceptable (empty: acceptable). The trial seed's `123456` is the one password that skips this,
// and only as the trial's seed (identity is the server's to decide, never a request's).
export function passwordProblems(password: unknown, username: string | null = null): string[] {
  if (typeof password !== "string") return ["password must be text"];
  const problems: string[] = [];
  const lower = password.toLowerCase();
  if (password.length < IDENTITY_LIMITS.passwordMin) problems.push(`password must be at least ${IDENTITY_LIMITS.passwordMin} characters`);
  if (password.length > IDENTITY_LIMITS.passwordMax) problems.push(`password must be at most ${IDENTITY_LIMITS.passwordMax} characters`);
  if (username !== null && lower.includes(username.toLowerCase())) problems.push("password must not contain the username");
  if (password.length > 0 && new Set(password).size <= 2) problems.push("password must not repeat one or two characters");
  if (SEQUENCES.some((s) => s.includes(lower) || (lower.length >= 6 && s.includes(lower.slice(0, 6)) && s.includes(lower.slice(-6))))) problems.push("password must not be a keyboard or number sequence");
  if (COMMON.has(lower)) problems.push("password is one of the commonest passwords");
  return problems;
}

export function checkLogin(body: unknown): Checked<LoginRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["username", "password"]);
  if (typeof body.username !== "string" || body.username.trim().length === 0 || body.username.length > 64) errors.push("username is required");
  if (typeof body.password !== "string" || body.password.length === 0 || body.password.length > IDENTITY_LIMITS.passwordMax) errors.push("password is required");
  return checked(errors, () => ({ username: (body.username as string).trim().toLowerCase(), password: body.password as string }));
}

export function checkSetup(body: unknown): Checked<Required<SetupRequest>> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["code", "username", "password", "fullName", "companyName", "timezone", "contactEmail"]);
  const username = normalizeUsername(body.username ?? "admin");
  const fullName = nameOf(body.fullName);
  const companyName = body.companyName === undefined || body.companyName === "" ? "" : nameOf(body.companyName);
  const contactEmail = body.contactEmail === undefined || body.contactEmail === null || body.contactEmail === "" ? null : emailOf(body.contactEmail);
  if (typeof body.code !== "string" || body.code.trim().length < 8 || body.code.length > IDENTITY_LIMITS.codeLength) errors.push("code must be the one-time setup code printed on the server");
  if (username === null) errors.push("username must be 2-32 lower-case letters, digits, dots, dashes or underscores, starting with a letter");
  if (fullName === null) errors.push(`fullName must be 1-${IDENTITY_LIMITS.nameLength} printable characters`);
  if (companyName === null) errors.push(`companyName must be at most ${IDENTITY_LIMITS.nameLength} printable characters`);
  if (!isTimeZoneName(body.timezone)) errors.push("timezone must be an IANA time zone (Asia/Ho_Chi_Minh)");
  if (body.contactEmail !== undefined && body.contactEmail !== null && body.contactEmail !== "" && contactEmail === null) errors.push("contactEmail must be an email address");
  errors.push(...passwordProblems(body.password, username));
  return checked(errors, () => ({
    code: (body.code as string).trim(),
    username: username as string,
    password: body.password as string,
    fullName: fullName as string,
    companyName: companyName as string,
    timezone: body.timezone as string,
    contactEmail,
  }));
}

// A one-time code as a person types it: the server compares it without its dashes, spaces and case.
export const normalizeSetupCode = (code: string): string => code.replace(/[\s-]/g, "").toUpperCase();

export function checkPasswordReset(body: unknown): Checked<PasswordResetRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["code", "username", "password", "fullName", "companyName", "timezone", "contactEmail"]);
  const username = normalizeUsername(body.username);
  if (typeof body.code !== "string" || body.code.trim().length < 8 || body.code.length > IDENTITY_LIMITS.codeLength) errors.push("code must be the one-time code printed on the server");
  if (username === null) errors.push("username must be the username the code was printed for");
  errors.push(...passwordProblems(body.password, username));
  return checked(errors, () => ({ code: (body.code as string).trim(), username: username as string, password: body.password as string }));
}

// WHO A SHARE NAMES: a user of this deployment, by username, or by an email -- which counts only when it is some user's
// VERIFIED email (the server decides that; this only reads the shape).
export type ShareRecipient = { kind: "username"; username: string } | { kind: "email"; email: string };

export const SHARE_PEOPLE_MAX = 20;

export function shareRecipientOf(v: unknown): ShareRecipient | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.includes("@")) {
    const email = emailOf(t);
    return email === null ? null : { kind: "email", email };
  }
  const username = normalizeUsername(t);
  return username === null ? null : { kind: "username", username };
}

// PUT …/access: the whole list of people it is shared with (an empty list: shared with nobody).
export function checkAccessPeople(body: unknown): Checked<{ people: ShareRecipient[] }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["people"]);
  const people = Array.isArray(body.people) ? body.people.map(shareRecipientOf) : null;
  if (people === null || people.length > SHARE_PEOPLE_MAX) errors.push(`people must be a list of at most ${SHARE_PEOPLE_MAX} usernames or emails`);
  else if (people.some((p) => p === null)) errors.push("every entry of people must be a username or an email address");
  return checked(errors, () => {
    const unique = new Map<string, ShareRecipient>();
    for (const p of people as ShareRecipient[]) unique.set(p.kind === "username" ? `u:${p.username}` : `e:${p.email}`, p);
    return { people: [...unique.values()] };
  });
}

export function checkChangePassword(body: unknown, username: string | null): Checked<ChangePasswordRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["currentPassword", "newPassword"]);
  if (typeof body.currentPassword !== "string" || body.currentPassword.length === 0) errors.push("currentPassword is required");
  errors.push(...passwordProblems(body.newPassword, username));
  if (typeof body.newPassword === "string" && body.newPassword === body.currentPassword) errors.push("newPassword must differ from the current one");
  return checked(errors, () => ({ currentPassword: body.currentPassword as string, newPassword: body.newPassword as string }));
}

export function checkUpdateProfile(body: unknown): Checked<UpdateProfileRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["fullName", "email"]);
  const fullName = body.fullName === undefined ? undefined : nameOf(body.fullName);
  const email = body.email === undefined || body.email === null || body.email === "" ? body.email === undefined ? undefined : null : emailOf(body.email);
  if (fullName === null) errors.push(`fullName must be 1-${IDENTITY_LIMITS.nameLength} printable characters`);
  if (body.email !== undefined && body.email !== null && body.email !== "" && email === null) errors.push("email must be an email address");
  if (body.fullName === undefined && body.email === undefined) errors.push("nothing to change: send fullName or email");
  return checked(errors, () => ({ ...(fullName !== undefined ? { fullName: fullName as string } : {}), ...(email !== undefined ? { email } : {}) }));
}

export function checkUpdateAccountProfile(body: unknown): Checked<UpdateAccountProfileRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const fields = ["displayName", "companyName", "contactEmail", "timezone", "locale"];
  const errors = unknownFields(body, fields);
  if (fields.every((f) => body[f] === undefined)) errors.push("nothing to change");
  const displayName = body.displayName === undefined ? undefined : body.displayName === "" ? "" : nameOf(body.displayName);
  const companyName = body.companyName === undefined ? undefined : body.companyName === "" ? "" : nameOf(body.companyName);
  const contactEmail = body.contactEmail === undefined ? undefined : body.contactEmail === null || body.contactEmail === "" ? null : emailOf(body.contactEmail);
  if (displayName === null) errors.push(`displayName must be at most ${IDENTITY_LIMITS.nameLength} printable characters`);
  if (companyName === null) errors.push(`companyName must be at most ${IDENTITY_LIMITS.nameLength} printable characters`);
  if (body.contactEmail !== undefined && body.contactEmail !== null && body.contactEmail !== "" && contactEmail === null) errors.push("contactEmail must be an email address");
  if (body.timezone !== undefined && !isTimeZoneName(body.timezone)) errors.push("timezone must be an IANA time zone");
  if (body.locale !== undefined && (typeof body.locale !== "string" || !LOCALE.test(body.locale))) errors.push("locale must look like en or en-US");
  return checked(errors, () => ({
    ...(displayName !== undefined ? { displayName: displayName as string } : {}),
    ...(companyName !== undefined ? { companyName: companyName as string } : {}),
    ...(contactEmail !== undefined ? { contactEmail } : {}),
    ...(body.timezone !== undefined ? { timezone: body.timezone as string } : {}),
    ...(body.locale !== undefined ? { locale: body.locale as string } : {}),
  }));
}
