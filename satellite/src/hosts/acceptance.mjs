// NATIVE HOST ACCEPTANCE: what a person recorded from a real host session, keyed to the exact source it ran on. A
// receipt for another source counts for nothing -- the same rule docs/backend-acceptance.json holds Orbit's adapters
// to. Written only by satellite/acceptance/record-host-acceptance.mjs; read here.
//
//   { schema: 1, doc, receipts: [{ kit: "host", host: { id, version, code }, system: { emulated: false }, at,
//                                  results: [{ id: "<host>:<capability>", ops: [..], outcome: "passed"|"failed" }] }] }
import { canonicalJson, sha } from "../../../src/hash.mjs";
import { isObject, list } from "../store/text.mjs";

export const ACCEPTANCE_SCHEMA = 1;

export const ACCEPTANCE_FILE = "host-acceptance.json";

// What the source IS: every file the digest covers, by its repository-relative path (always "/") and its LF text.
export const sourceDigestOf = (files) => sha(canonicalJson(files.map((f) => [f.rel.split("\\").join("/"), sha(String(f.text).replace(/\r\n/g, "\n"))]).sort((a, b) => a[0].localeCompare(b[0]))));

const receiptOk = (r, digest) => isObject(r) && r.kit === "host" && r.host?.code === digest && r.system?.emulated === false && Array.isArray(r.results);

// The result ids that passed, on this source.
export const passedOn = (doc, digest) => new Set(list(doc?.receipts).filter((r) => receiptOk(r, digest)).flatMap((r) => r.results.filter((x) => x?.outcome === "passed").map((x) => x.id)));

export const staleReceipts = (doc, digest) => list(doc?.receipts).filter((r) => isObject(r) && r.host?.code !== digest).length;

// ---- recording (satellite/acceptance/record-host-acceptance.mjs): a person's account of a live run, held to shape ----

export const ACCEPTANCE_DOC = "What a person saw a REAL host session do with Satellite, written only by satellite/acceptance/record-host-acceptance.mjs. The host matrix (satellite/src/hosts/matrix.mjs) counts a claimed capability verified only while a receipt for THIS source digest says its result passed; an edit to satellite/src, satellite/cli, skills/satellite or agents/satellite-* makes every receipt stale.";

const RESULT = /^([a-z][a-z0-9-]{0,39}):([a-z][a-z0-9-]{0,63}):([^:]{1,600}):(passed|failed)$/;

const OP = /^[A-Za-z][A-Za-z0-9_.()|-]{0,47}$/;

const VERSION = /^[A-Za-z0-9][A-Za-z0-9 ._+()-]{0,79}$/;

// "<host>:<test>:<op>,<op>…:<passed|failed>" -> { id, ops, outcome } | null
export const resultOf = (text) => ((m) => (m && m[3].split(",").every((op) => OP.test(op)) && m[3].split(",").length <= 12 ? { id: `${m[1]}:${m[2]}`, ops: m[3].split(","), outcome: m[4] } : null))(RESULT.exec(String(text ?? "")));

// What is wrong with a recording, each said once; an empty list records.
export const RECORD_RULES = Object.freeze([
  { id: "HOST", fails: (r, hosts) => !hosts.includes(r.host), say: (r, hosts) => `--host is one of ${hosts.join(", ")}` },
  { id: "VERSION", fails: (r) => !VERSION.test(String(r.version ?? "")), say: () => "--version is the host's own version, as it prints it" },
  { id: "RESULTS", fails: (r) => r.results.length === 0, say: () => "at least one --result=<host>:<test>:<op>,<op>…:<passed|failed>" },
  { id: "RESULT_SHAPE", fails: (r) => r.results.some((x) => !x.parsed), say: (r) => `not <host>:<test>:<ops>:<passed|failed>: ${r.results.filter((x) => !x.parsed).map((x) => x.text).join(", ")}` },
  { id: "RESULT_HOST", fails: (r) => r.results.some((x) => x.parsed && !x.parsed.id.startsWith(`${r.host}:`)), say: (r) => `every result belongs to --host=${r.host}` },
  { id: "RESULT_TWICE", fails: (r) => new Set(r.results.map((x) => x.parsed?.id)).size !== r.results.length, say: () => "each result id once" },
]);

export const recordProblems = (r, hosts) => RECORD_RULES.filter((rule) => rule.fails(r, hosts)).map((rule) => ({ id: rule.id, say: rule.say(r, hosts) }));

// r: { host, version, results: [{ parsed }] }; code: sourceDigestOf(the source); at, system: the machine's own words
export const receiptOf = (r, code, at, system) => ({ kit: "host", host: { id: r.host, version: r.version, code }, system: { emulated: false, ...system }, at, results: r.results.map((x) => x.parsed) });

// One receipt per host: this one in place of the host's last, every other host's kept as it was (stale or not).
export const recordedDoc = (doc, receipt) => ({ schema: ACCEPTANCE_SCHEMA, doc: ACCEPTANCE_DOC, receipts: [...list(doc?.receipts).filter((x) => x?.host?.id !== receipt.host.id), receipt].sort((a, b) => String(a.host?.id).localeCompare(String(b.host?.id))) });
