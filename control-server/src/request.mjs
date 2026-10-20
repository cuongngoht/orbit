// A request body, read as JSON, and refused rather than guessed at.
//
// JSON only, and it has to SAY it is JSON: a form post from another page cannot
// set that content type without a preflight this server never answers. The size
// is capped, because a SKILL.md is a page of prose and not an upload.
import { invalid, tooLarge, unsupported } from "./errors.mjs";

export const BODY_LIMIT = 1024 * 1024;

export async function readJson(req, limit = BODY_LIMIT) {
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw unsupported("send the body as application/json");
  return parsed(await collected(req, limit));
}

async function collected(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) size = kept(chunks, chunk, size + chunk.length, limit);
  return Buffer.concat(chunks).toString("utf8");
}

function kept(chunks, chunk, size, limit) {
  if (size > limit) throw tooLarge(`the body is larger than ${limit} bytes`);
  chunks.push(chunk);
  return size;
}

function parsed(text) {
  try { return JSON.parse(text); }
  catch { throw invalid("INVALID_JSON", "the request body is not valid JSON"); }
}
