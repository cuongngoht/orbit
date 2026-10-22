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
