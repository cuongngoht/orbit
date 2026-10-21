// SCRAM-SHA-256 (RFC 5802, RFC 7677), the client's half, as PostgreSQL speaks it: no channel
// binding, the user named by the startup message rather than here. The client proves it knows the
// password without sending it, and holds the SERVER to proving it knows it too -- a server whose
// final signature does not match is not the server this client meant to reach.
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const MECHANISM = "SCRAM-SHA-256";
const GS2 = "n,,";

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const xor = (a, b) => Buffer.from(a.map((byte, i) => byte ^ b[i]));

// PostgreSQL names the user in the startup message, so the SCRAM user is empty (`user` exists for the RFC's own vector).
export function clientFirst(nonce = randomBytes(18).toString("base64"), user = "") {
  const bare = `n=${user},r=${nonce}`;
  return { nonce, bare, message: `${GS2}${bare}` };
}

// The server's first message: its nonce (which must extend ours), the salt and the iteration count.
export function serverFirstOf(text, nonce) {
  const at = Object.fromEntries(String(text).split(",").map((part) => [part.slice(0, 1), part.slice(2)]));
  const iterations = Number(at.i);
  if (!at.r?.startsWith(nonce) || !at.s || !Number.isInteger(iterations) || iterations < 1) return null;
  return { nonce: at.r, salt: Buffer.from(at.s, "base64"), iterations, text: String(text) };
}

// -> { message, serverSignature }: what to send, and what the server must answer with.
export function clientFinal(password, first, server) {
  const salted = pbkdf2Sync(String(password).normalize("NFKC"), server.salt, server.iterations, 32, "sha256");
  const withoutProof = `c=${Buffer.from(GS2).toString("base64")},r=${server.nonce}`;
  const auth = `${first.bare},${server.text},${withoutProof}`;
  const clientKey = hmac(salted, "Client Key");
  return { message: `${withoutProof},p=${xor(clientKey, hmac(createHash("sha256").update(clientKey).digest(), auth)).toString("base64")}`, serverSignature: hmac(hmac(salted, "Server Key"), auth) };
}

// The server's final message, held to the signature only a server that knows the password can make.
export function serverProved(text, expected) {
  const said = /(?:^|,)v=([^,]+)/.exec(String(text))?.[1];
  const got = said ? Buffer.from(said, "base64") : Buffer.alloc(0);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

