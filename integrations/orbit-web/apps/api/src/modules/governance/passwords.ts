// An operator's password, kept as scrypt (node:crypto; no dependency): `scrypt$N$r$p$<salt>$<hash>`. Hashing is slow
// on purpose and happens OUTSIDE any database transaction (governance-db.ts).
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const COST = { N: 32_768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * 1024 * 1024;

const derive = (password: string, salt: Buffer, o: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, { ...o, maxmem: MAX_MEMORY }, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, "base64");
  try {
    const key = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// What an unknown username is checked against, so that "no such operator" takes as long as "wrong password".
let decoy: Promise<string> | null = null;

export async function verifyDecoy(password: string): Promise<false> {
  decoy ??= hashPassword(randomBytes(24).toString("base64"));
  await verifyPassword(password, await decoy);
  return false;
}
