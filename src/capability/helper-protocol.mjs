// The HELPER's side of orbit.helper/v1 (ADR 0036), for a helper written in this language.
//
// A helper is any program -- in any language, using whatever official SDK, CLI or API its
// system has -- that reads ONE request on stdin and writes ONE answer line on stdout. These are
// the three things a Node helper needs to keep that promise: read the request, say the answer,
// say what went wrong in one of the classes the engine maps to a typed stop
// (src/capability/helper.mjs HELPER_CLASSES). A helper in another language writes the same two
// JSON shapes; nothing here is required of it.
import { HELPER_API, HELPER_CLASS_IDS } from "./helper.mjs";

export function parsedRequest(text) {
  const request = jsonOf(text);
  if (request?.v !== HELPER_API || typeof request.op !== "string") return { ok: false, why: `this is not an ${HELPER_API} request` };
  return { ok: true, request: { ...request, request: request.request ?? {}, bound: request.bound ?? {}, limits: request.limits ?? {} } };
}

function jsonOf(text) {
  try { return JSON.parse(String(text ?? "")); }
  catch { return null; }
}

export const answerLine = (value) => `${JSON.stringify({ v: HELPER_API, ok: true, value })}\n`;

// A class nobody declared is reported as protocol: the engine would read it so anyway, and
// saying it here keeps a helper's own test honest about what it sends.
export const failureLine = (cls, message, extra = {}) => `${JSON.stringify({ v: HELPER_API, ok: false, class: HELPER_CLASS_IDS.includes(cls) ? cls : "protocol", message: String(message ?? ""), ...extra })}\n`;

// Everything a stream says, as one string -- the request is one document, never a stream of them.
export async function readAll(stream) {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}
