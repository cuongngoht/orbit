// WHAT SLOWS A GUESSER DOWN. Every sign-in attempt is COUNTED FIRST -- against the username typed (whether or not it is
// anybody's) and against the client's address (hashed, never kept as it is) -- and only then is the password checked,
// so a burst of attempts at once is held to the rule as if they came one after another (infra/accounts/stores.ts,
// LoginThrottleStore.attempt). A few attempts are free; after them each one waits a delay that doubles. On top of it a
// user who keeps failing is LOCKED for a while that grows with each further ten failures.
//
// Both refuse with the same words, `too_many_attempts` (HTTP 429, Retry-After): which key held the attempt back, and
// whether the username exists, is never said.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { TOO_MANY_ATTEMPTS } from "@orbit-web/contracts";
import { ApiError } from "../../common/errors.js";
import { LoginThrottleStore, sha256, type ThrottleRule } from "../../infra/accounts/stores.js";

const MINUTE = 60_000;

// A username: five free attempts in fifteen minutes, then 30 s, 1 min, 2 min ... up to fifteen minutes each.
export const USERNAME_RULE: ThrottleRule = { windowMs: 15 * MINUTE, free: 5, firstDelayMs: 30_000, maxDelayMs: 15 * MINUTE };
// An address (several people may sign in from one): twenty free attempts, then the same doubling wait.
export const ADDRESS_RULE: ThrottleRule = { windowMs: 15 * MINUTE, free: 20, firstDelayMs: 30_000, maxDelayMs: 15 * MINUTE };
// A setup code tried from an address: ten tries, then the doubling wait (a code is 120 random bits: this is the
// guesser's courtesy, not the protection).
export const SETUP_RULE: ThrottleRule = { windowMs: 15 * MINUTE, free: 10, firstDelayMs: 30_000, maxDelayMs: 15 * MINUTE };

// After this many failures of one user in a row, the user is locked: 15 minutes, doubling with each further ten, at most
// a day.
export const LOCK_EVERY = 10;
const LOCK_FIRST_MS = 15 * MINUTE;
const LOCK_MAX_MS = 24 * 60 * MINUTE;

export const lockFor = (failures: number): number | null => (failures > 0 && failures % LOCK_EVERY === 0 ? Math.min(LOCK_MAX_MS, LOCK_FIRST_MS * 2 ** (failures / LOCK_EVERY - 1)) : null);

export const usernameKey = (username: string): string => `user:${username}`;
export const addressKey = (address: string | undefined): string => `addr:${sha256(`orbit-web/sign-in-address/${(address ?? "").replace(/^::ffff:/, "")}`)}`;
export const setupKey = (address: string | undefined): string => `setup:${sha256(`orbit-web/setup-address/${(address ?? "").replace(/^::ffff:/, "")}`)}`;

export function tooManyAttempts(until: string): ApiError {
  const seconds = Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 1000));
  const wait = seconds < 120 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
  return new ApiError(HttpStatus.TOO_MANY_REQUESTS, TOO_MANY_ATTEMPTS, `Too many sign-in attempts. Try again in ${wait}.`, { retryAfterSeconds: seconds });
}

@Injectable()
export class LoginThrottle {
  constructor(@Inject(LoginThrottleStore) private readonly store: LoginThrottleStore) {}

  // Counts the attempt under each key, in order; the first that holds it back refuses it.
  async attempt(keys: readonly { key: string; rule: ThrottleRule }[], now: string): Promise<void> {
    for (const { key, rule } of keys) {
      const answer = await this.store.attempt(key, now, rule);
      if (!answer.allowed) throw tooManyAttempts(answer.until);
    }
  }

  // A success: the username's count starts again; the address keeps the others' attempts but not this one.
  async succeeded(username: string | null, address: string): Promise<void> {
    if (username !== null) await this.store.clear(usernameKey(username));
    await this.store.relieve(address);
  }

  async clear(key: string): Promise<void> {
    await this.store.clear(key);
  }
}
