// PASSWORDS, kept as a slow hash: scrypt (Node's own -- Argon2id has no built-in and would need a native dependency),
// N = 2^17, r = 8, p = 1, a random 16-byte salt per hash, a 32-byte key. The parameters are written into the hash
// itself (`scrypt$N$r$p$salt$key`), so a hash made at another cost is still read, and stored again at today's.
//
// Comparing is constant-time. A sign-in for a username nobody has still costs one hash (`dummy`), so how long an
// answer takes says nothing about whether the user exists.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { KdfParams } from "../../config/config.js";

const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const SCHEME = "scrypt";

const derive = (password: string, salt: Buffer, o: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password.normalize("NFC"), salt, KEY_LENGTH, o, (err, key) => (err ? reject(err) : resolve(key))));

// The memory scrypt needs for these parameters (128 * N * r), with room to spare.
const memoryFor = (N: number, r: number, floor: number): number => Math.max(floor, 2 * 128 * N * r);

export async function hashPassword(password: string, kdf: KdfParams): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: memoryFor(kdf.N, kdf.r, kdf.maxmem) });
  return [SCHEME, kdf.N, kdf.r, kdf.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

const POSITIVE = /^[1-9][0-9]{0,9}$/;

function parse(stored: string): Parsed | null {
  const [scheme, N, r, p, salt, key, ...rest] = stored.split("$");
  if (scheme !== SCHEME || rest.length > 0 || ![N, r, p].every((v) => v !== undefined && POSITIVE.test(v)) || salt === undefined || key === undefined) return null;
  const parsed = { N: Number(N), r: Number(r), p: Number(p), salt: Buffer.from(salt, "base64url"), key: Buffer.from(key, "base64url") };
  // N a power of two, and nothing that would ask for more than a GiB of memory: a stored value is never trusted blindly.
  if ((parsed.N & (parsed.N - 1)) !== 0 || 128 * parsed.N * parsed.r > 1024 * 1024 * 1024 || parsed.key.length !== KEY_LENGTH || parsed.salt.length < 8) return null;
  return parsed;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const p = parse(stored);
  if (p === null) return false;
  const key = await derive(password, p.salt, { N: p.N, r: p.r, p: p.p, maxmem: memoryFor(p.N, p.r, 32 * 1024 * 1024) });
  return key.length === p.key.length && timingSafeEqual(key, p.key);
}

// Whether a hash was made at another cost than today's (it is made again at the next successful sign-in).
export function needsRehash(stored: string, kdf: KdfParams): boolean {
  const p = parse(stored);
  return p === null || p.N !== kdf.N || p.r !== kdf.r || p.p !== kdf.p;
}

// A hash of nothing anybody knows, made once at today's cost: what a sign-in for an unknown username is compared to.
export class DummyHash {
  private value: Promise<string> | null = null;

  constructor(private readonly kdf: KdfParams) {}

  get(): Promise<string> {
    this.value ??= hashPassword(randomBytes(24).toString("base64url"), this.kdf);
    return this.value;
  }
}
