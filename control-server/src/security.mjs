// Who may ask this server anything, and who may change something.
//
// It listens on 127.0.0.1 only, but "only this machine" is not "only you": any
// page open in a browser here can send it a request. Three checks close that:
//
//   HOST    every request must be addressed to 127.0.0.1:<port> or
//           localhost:<port>. A DNS-rebinding page reaches the loopback address
//           under its OWN name, and that name is what the Host header carries.
//   ORIGIN  a PUT or DELETE sent by a browser carries an Origin, and it must be
//           this server's own. There is no CORS: a cross-origin page gets no
//           header that would let it read an answer or send a custom header.
//   TOKEN   a PUT or DELETE must carry the token main.mjs printed, in a header.
//           It is minted per process, travels in the URL's #fragment (which no
//           browser sends to a server or puts in a Referer), and is compared in
//           constant time. Reading needs no token; changing always does.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { forbidden } from "./errors.mjs";

export const TOKEN_HEADER = "x-orbit-control-token";
export const LOOPBACK = "127.0.0.1";
const NAMES = [LOOPBACK, "localhost"];

export const newToken = () => randomBytes(32).toString("base64url");

const own = (port) => NAMES.map((name) => `${name}:${port}`);

export const hostAllowed = (req, port) => own(port).includes(String(req.headers.host ?? "").toLowerCase());

export const originAllowed = (req, port) => req.headers.origin === undefined || own(port).map((h) => `http://${h}`).includes(req.headers.origin);

// Hashed first, so the comparison is always over two equal-length buffers and
// the length of a wrong guess says nothing either.
export function tokenMatches(req, token) {
  const given = req.headers[TOKEN_HEADER];
  if (typeof given !== "string" || !given) return false;
  return timingSafeEqual(digest(given), digest(token));
}

const digest = (s) => createHash("sha256").update(s).digest();

export function admit(req, port, token, mutates) {
  if (!hostAllowed(req, port)) throw forbidden("HOST_NOT_ALLOWED", `this server answers only to ${LOOPBACK}:${port} and localhost:${port}`);
  if (!mutates) return;
  if (!originAllowed(req, port)) throw forbidden("ORIGIN_NOT_ALLOWED", "a change may only come from this server's own page");
  if (!tokenMatches(req, token)) throw forbidden("MUTATION_TOKEN_REQUIRED", "changing a skill needs the token in the URL the server printed at start-up — open that URL");
}
