// Nothing that is a secret may ever be written where it outlives the run.
//
// Two stores need that and they need it for OPPOSITE reasons, which is why this
// is a leaf rather than a file inside either of them:
//
//   a LESSON (src/learn/) lives in a home directory, which makes it feel safe, so
//   every string one carries is scrubbed at `makeLesson` -- the one place a
//   lesson is made, exactly as `makeNote` is the only constructor of a note.
//   the CORPUS (src/memory/) is the reverse: `ui-tests/memory/` is COMMITTED, so
//   a value that reaches it reaches every clone and the history besides.
//   `recordRun` and `makeNote` are its only two doors.
//
// For a lesson this is the BACKSTOP; the defence is the allow-list in
// learn/evidence.mjs, which never reads the risky fields at all. For the corpus
// this IS the defence, because a ledger line's job is to describe the WHOLE run --
// so the fields stay and their values are masked.
//
// Masked by SHAPE, never by name. `TARGET_UPN` is a name this engine must not
// know: a project's vocabulary belongs in its own repo. A pattern for what a
// secret LOOKS like needs no product knowledge to be right.
// What a secret is CALLED, declared once and asked twice: of a sentence, and of
// a record's key. `TARGET_UPN` would be product knowledge; "password" is not.
// `pat` (a personal access token) and `credential` joined in 1.6.0, with the
// project-report connections: `GITHUB_PAT`, `ado_pat` and `credential` are how
// such a key is actually spelled, and the boundary below keeps `path` and
// `patch` out of it.
const SECRET_WORDS = "bearer|authorization|api[-_ ]?key|password|pwd|secret|token|pat|credentials?";

// `basic` comes BEFORE `named`: "Authorization: Basic <base64>" otherwise has
// its first word masked by `named` and its base64 -- the credential itself --
// left standing after it.
export const SECRETS = [
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, as: "[token]" },
  { name: "basic", re: /\bbasic\s+[A-Za-z0-9+/]{8,}={0,2}/gi, as: "Basic [redacted]" },
  { name: "named", re: new RegExp(`\\b(${SECRET_WORDS})\\b["']?\\s*[:=]\\s*(?:bearer\\s+)?(?:"[^"]*"|'[^']*'|[^\\s,;}]+)`, "gi"), as: "$1 [redacted]" },
  { name: "bearer", re: /\bbearer\s+(?!\[redacted\])[^\s,;"'}]+/gi, as: "Bearer [redacted]" },
  // An environment ASSIGNMENT of a secret-named variable, `GITHUB_PAT=…`: `named`
  // cannot see it, because `_` is a word character and `\bPAT` never matches
  // inside `GITHUB_PAT`. A shell dump or an error quoting an env line is the
  // likeliest way a token reaches a log.
  { name: "assign", re: /\b([A-Z][A-Z0-9_]*(?:PAT|TOKEN|SECRET|PASSWORD|PWD|API_?KEY|CREDENTIALS?))\s*=\s*(?!\[redacted\])[^\s,;"'}]+/g, as: "$1=[redacted]" },
  { name: "conn", re: /\b(Server|Data Source|User ID|Uid|Pwd|Password)=[^;\s]+/gi, as: "$1=[redacted]" },
  // Anchored at the start of a run of the characters a local part may hold: a leftmost match begins there anyway, so what
  // is masked is unchanged, and a long run with no `@` in it (a token, a base64 blob) is tried once instead of from every
  // position -- the unanchored form cost the square of the run's length, seconds for a 60 KB line a live console reads.
  // The chain after it keeps what the unanchored form masked when two addresses are joined by `+` or `-`
  // (`a@b.cc-x@y.zz`): it resumed right after the first and took the second, and the lookbehind alone would refuse that.
  { name: "upn", re: /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.]{2,}(?:[+-][\w.+-]*@[\w-]+\.[\w.]{2,})*/g, as: "[upn]" },
  { name: "blob", re: /\b[A-Fa-f0-9]{32,}\b/g, as: "[hex]" },
];

export const scrub = (text) => SECRETS.reduce((s, p) => s.replace(p.re, p.as), String(text ?? ""));

// The same masks, keeping every line end a mask swallowed: a value written on the line after its name is masked exactly
// as `scrub` masks it, and the text keeps its line count, so a reader that shows a log a line at a time (a live console,
// src/runtime/sandbox/view.mjs) can say which line of the file each masked line is.
export const scrubLines = (text) => SECRETS.reduce((s, p) => s.replace(p.re, keptLines(p.as)), String(text ?? ""));

const keptLines = (as) => (match, ...rest) => `${as.replace(/\$1/g, () => (typeof rest[0] === "string" ? rest[0] : ""))}${"\n".repeat(match.split("\n").length - 1)}`;

// Which line a QUOTED secret value begins on that nothing after it closes yet, or -1. `named` masks a quoted value whole,
// up to the quote that closes it however many lines later, so a reader that shows a log before the end is written must
// not show the lines of a value still open: the whole-log read masks them once the quote is written. Found with `named`'s
// OWN pairing -- the same words, the same leftmost scan, the same alternatives in the same order, a quoted one allowed to
// run to the end of the text -- over the text the patterns before it have already masked (a line kept for every line).
const NAMED = SECRETS.findIndex((p) => p.name === "named");
const OPEN_VALUE = new RegExp(`\\b(${SECRET_WORDS})\\b["']?\\s*[:=]\\s*(?:bearer\\s+)?(?:"[^"]*("|$)|'[^']*('|$)|[^\\s,;}]+)`, "gi");

export function openSecretLine(text) {
  const before = SECRETS.slice(0, NAMED).reduce((s, p) => s.replace(p.re, keptLines(p.as)), String(text ?? ""));
  const open = [...before.matchAll(OPEN_VALUE)].find((m) => m[2] === "" || m[3] === "");
  return open ? before.slice(0, open.index).split("\n").length - 1 : -1;
}

// Masking by VALUE, for a caller that KNOWS the secret -- a runner that resolved
// a credential a moment ago. A shape cannot recognise every token a provider
// will ever issue; the value itself can, in every spelling it travels in: as
// typed, in base64 (with and without the ":" of Basic auth) and percent-encoded.
// Too short a value is not masked: it would mask ordinary words instead.
export const maskValues = (text, values = []) => spellings(values).reduce((s, v) => s.split(v).join("[redacted]"), String(text ?? ""));

const spellings = (values) => values.filter((v) => typeof v === "string" && v.length >= 8).flatMap((v) => [v, b64(`:${v}`), b64(v), encodeURIComponent(v)]).sort((a, b) => b.length - a.length);

const b64 = (v) => Buffer.from(v, "utf8").toString("base64");

// Masking by the SHAPES a caller declares -- a provider's published token
// prefixes, which are product knowledge and so arrive as data (a pack's own
// catalog), never as a row here.
export const maskShapes = (text, shapes = []) => shapes.reduce((s, source) => s.replace(new RegExp(source, "g"), "[redacted]"), String(text ?? ""));

export function scrubbed(value) {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map(scrubbed);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(entry));
  return value;
}

// A secret inside a RECORD is a key and a value in two different strings, so
// the `named` pattern above never sees it: `{"PASSWORD": "hunter2"}` matched
// nothing, and a password handed to a case as a parameter went into the ledger,
// into a lesson's evidence and into the report that gets mailed -- in full.
// The same word list, asked of the key.
// Not `\b`: an underscore is a word character, so `\bsecret\b` finds nothing in
// `client_secret` -- the single most common way a key is actually spelled. The
// boundary that matters here is "not a letter or a digit", which also lets the
// separator-optional `api[-_ ]?key` catch `apiKey`.
export const SECRET_NAME = new RegExp(`(^|[^a-z0-9])(${SECRET_WORDS})($|[^a-z0-9])`, "i");

const entry = ([k, v]) => [k, SECRET_NAME.test(k) ? "[redacted]" : scrubbed(v)];

// Which fields of each thing the corpus holds are FREE TEXT -- declared here,
// beside each other, rather than in the two modules that write them.
//
// A run record: what a command line gave, what SQL returned, what a step read off
// the page, who was signed in, and why it stopped. The same list
// learn/evidence.mjs refuses to READ, so one declaration covers both doors.
export const FREE_TEXT = ["params", "resolved", "captured", "report", "identity", "failure"];

// A note: what a person typed. `about` is the key recall matches on, and a masked
// key matches nothing.
export const NOTE_TEXT = ["title", "body"];

// An architecture fact: the three fields built from prose rather than from a
// path or a hash. `because` is where a quoted line out of somebody's README
// lands, which is the one place a connection string could realistically arrive.
//
// Everything else on a fact is deliberately absent from this list, and
// `fingerprint` and `commit` are why the list exists at all rather than the
// whole record going through `scrubbed`: both are long hex, both look exactly
// like the `blob` pattern, and masking either would leave nothing able to say
// whether a fact still describes the tree. Same reasoning as `fe_commit` below.
export const ARCH_TEXT = ["statement", "because", "unknowns"];

// An engineering fact: the same three prose fields as an architecture fact,
// plus the prose only engineering kinds carry -- when a pattern applies, when
// to avoid it, the shape siblings share, and what each example is FOR. All of
// it is written by an observer, so all of it is somewhere a quoted line could
// land. `support`, `fingerprint` and `commit` stay out for the same reason as
// ever: they are counters and hashes, and masking any of them would leave
// nothing able to say whether a fact still describes the tree or how many
// sessions actually confirmed it.
export const ENG_TEXT = ["statement", "because", "unknowns", "appliesWhen", "avoidWhen", "pattern", "examples"];

// A project intelligence fact: the architecture fact's three prose fields, plus
// the two carrying words lifted out of source code -- the identifiers that
// settled a usage, and a registration's own name. Analysers only ever emit
// identifier-shaped strings, never a literal, so neither should hold a secret;
// this is the second lock on that door. `dependencies` stays out: a package
// name is structural, and masking one that happened to look like hex would
// leave a manifest fact unable to say what it declares.
export const INTEL_TEXT = ["statement", "because", "unknowns", "signals", "name"];

// A runtime fact (src/runtime/): the architecture fact's prose fields, plus the
// ones that carry a line out of a project's own files -- a command as its
// manifest spells it, a probe target, an image reference, a version range as
// written, and the summary of an environment definition. A command line is the
// likeliest place in a repository for a credential to be typed (`TOKEN=… start`),
// which is why `text` is here and why a command with an environment prefix is
// never run (src/runtime/discover/commands.mjs). `fingerprint`, `commit` and
// `checkout` stay out for the reason every hash field does.
export const RUNTIME_TEXT = ["statement", "because", "unknowns", "text", "target", "image", "range", "definition"];

// A project knowledge claim: the only prose it carries -- why this confidence,
// and what it could not settle. Its subject, relation, object and context are
// IDENTITY (its id is a hash of them), so a secret-shaped one is refused at the
// door rather than masked here: masking an identity field would quietly make it
// a different claim.
export const KNOW_TEXT = ["because", "unknowns"];

// Everything NOT listed is left alone deliberately. `fe_commit` is a commit sha,
// and a long enough sha is indistinguishable from the `blob` pattern -- masking
// the build a verdict was taken on would leave coverage unable to tell a current
// PASS from a stale one.
export function scrubFields(value, keys) {
  const carried = keys.filter((k) => value?.[k] != null);
  return { ...value, ...Object.fromEntries(carried.map((k) => [k, scrubbed(value[k])])) };
}

export const scrubRecord = (record) => scrubFields(record, FREE_TEXT);

export const scrubNote = (note) => scrubFields(note, NOTE_TEXT);

export const scrubFact = (fact) => scrubFields(fact, ARCH_TEXT);

export const scrubEngineering = (fact) => scrubFields(fact, ENG_TEXT);

export const scrubIntelligence = (fact) => scrubFields(fact, INTEL_TEXT);

export const scrubKnowledge = (claim) => scrubFields(claim, KNOW_TEXT);

export const scrubRuntime = (fact) => scrubFields(fact, RUNTIME_TEXT);
