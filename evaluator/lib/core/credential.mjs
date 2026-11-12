// THE CREDENTIAL SCAN: before anything of a run's room is kept, every regular file in it is read for the credential the
// run was handed -- as typed, base64, base64url and percent-encoded -- and a room that holds it in any file is not kept:
// those files are removed and named (by path, never by content). The controller holds the value in memory for this
// comparison only; it is never written, printed or logged. A link is never followed.
//
//   spellingsOf(value) -> [string]      leaksIn(dir, values) -> [rel]      scrubbedRoom(dir, values) -> { leaked: [rel] }
import { lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

export const MIN_LENGTH = 8;

export const spellingsOf = (value) => (typeof value === "string" && value.length >= MIN_LENGTH ? [...new Set([value, Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64url"), encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])] : []);

const regularFiles = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  const st = lstatSync(p);
  return st.isDirectory() ? regularFiles(p) : st.isFile() ? [p] : [];
});

// Bytes read as latin1, one character per byte, so a binary file is searched as faithfully as a text one.
const holds = (file, spellings) => ((text) => spellings.some((s) => text.includes(s)))(readFileSync(file, "latin1"));

export function leaksIn(dir, values) {
  const spellings = values.flatMap(spellingsOf);
  if (!spellings.length) return [];
  return regularFiles(dir).filter((f) => holds(f, spellings)).map((f) => relative(dir, f));
}

export function scrubbedRoom(dir, values) {
  const leaked = leaksIn(dir, values);
  for (const rel of leaked) rmSync(join(dir, rel), { force: true });
  return { leaked };
}

// The value of a credential named by the controller's own environment, read for the scan alone.
export const credentialValues = (names, env = process.env) => names.map((n) => env[n]).filter((v) => typeof v === "string" && v.length >= MIN_LENGTH);
