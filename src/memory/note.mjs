// A NOTE is one thing an agent concluded that would change what the next one
// does: a trap, a decision, a false alarm ("that FAIL was the VPN, not the
// product"). It is not "the case passed" -- that is the ledger's job, and a
// note repeating it is noise that ages into a lie.
//
// Two fields are what keep a store of notes from rotting the way an unversioned
// map rots:
//   about      a key the map already uses -- case:<id>, screen:<id>,
//              "<screen>/<via>", machine, project. Recall is then a slice, the
//              way `query screen` is a slice, instead of reading the lot.
//   fe_commit  the build it was true at, so `notes` can mark it stale exactly
//              the way `verify` marks a drifted record.
// `host` is stamped by the port, not asked for: the notes are shared through
// the repository now, so "this machine needs Edge" has to say whose machine.
import { scrubNote } from "../scrub.mjs";

export const KEYS = ["about", "title", "type", "fe_commit", "at", "host"];
export const TYPES = ["trap", "decision", "finding"];

// Masked here, at the one place a note is made, because the title reaches a
// FILENAME through slugOf -- a UPN in a title is published as a path, where no
// reader of the file's contents would ever think to look for it. Which fields
// are free text is src/scrub.mjs's to say, not this module's.
export function makeNote(fields, now = () => new Date().toISOString()) {
  const { about, title, body } = fields;
  if (!about || !title || !body) throw new Error("a note needs an about key, a title and a body");
  const text = scrubNote({ title, body });
  return { about, ...text, type: fields.type ?? "finding", fe_commit: fields.fe_commit ?? null, at: fields.at ?? now() };
}

export const slugOf = (note) => `${slug(note.about)}--${slug(note.title)}`.slice(0, 80);

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function formatNote(note) {
  const head = KEYS.map((k) => `${k}: ${note[k] ?? ""}`).join("\n");
  return `---\n${head}\n---\n\n${note.body.trim()}\n`;
}

// A note is a COMMITTED file, so it comes back with whatever line endings the
// checkout uses -- CRLF on Windows, where anchoring on \n matched nothing and
// `query notes` went silently empty on exactly the machines a shared store
// exists to serve. Normalised once, on the way in.
export function parseNote(text, file = null) {
  const body = String(text).replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (!m) return null;
  const head = Object.fromEntries(m[1].split("\n").map(pair).filter(Boolean));
  return { ...head, body: body.slice(m[0].length).trim(), file };
}

const pair = (line) => (line.includes(":") ? [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()] : null);

// `create-thing` recalls a note filed under `case:create-thing`, and a screen
// recalls the notes filed against its controls: recall must not depend on
// spelling the key the way whoever wrote it did.
export function relevant(notes, about) {
  if (!about) return notes;
  const want = String(about).toLowerCase();
  return notes.filter((n) => matches(String(n.about ?? "").toLowerCase(), want));
}

const matches = (have, want) => have === want || have.endsWith(`:${want}`) || have.startsWith(`${want}/`) || have.startsWith(`${want}:`);

export const isStale = (note, head) => Boolean(head && note.fe_commit && note.fe_commit !== head);
