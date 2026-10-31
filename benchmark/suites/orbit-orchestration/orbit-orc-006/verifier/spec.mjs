// THE SPEC of ORBIT-ORC-006: an id never moves a failure signature. A signature is what failed, "normalised so that what
// changes between two runs of the SAME failure -- a timestamp, an absolute path, an id, a duration, the order lines
// arrive in -- does not move it, and a different failing test does" (the header of src/orchestration/failure.mjs); the
// task counts repeats of it, and three in a row is NO_PROGRESS. The id a failing line prints most often is a UUID: a
// request, an order, a tenant, a correlation. Written from that contract, never from the code; kept beside the probe and
// handed to no runner, and it never imports the subject.
//
// Every check is two runs and an expectation over what the subject's signatures of them say: `SAME` or `DIFFERENT`,
// and `HEX12` when both are 12 hex characters. Seeded runs print one failure twice with fresh UUIDs -- lower or upper
// case, at the start of a line, in braces, after `=`, one or several to a line -- or two failures that differ in what
// the contract says moves a signature, UUIDs and all.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-ORC-006";

export const GROUPS = {
  "uuid-volatile": "two runs of one failure whose failing lines differ only in the UUIDs they print sign the same",
  "uuid-anywhere": "a UUID moves no signature wherever it stands in a failing line, in either case, one or several of them",
  "still-different": "with UUIDs in its lines, a different failing test or the same test failing differently still signs differently",
  "still-volatile": "what moved no signature before -- a timestamp, a duration, an absolute path, a long hash -- still moves none",
  "seeded-uuid": "random runs of one failure and of different failures, printing fresh UUIDs: the same signature exactly when the failure is the same",
};

// ---- the reference model: the contract, as data ---------------------------------------------------------------------

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// Two outputs are one failure when, every UUID read as the id it is, they print the same lines in any order.
const lineSet = (lines) => JSON.stringify([...new Set(lines.map((l) => l.replace(UUID, "<id>")))].sort());

export const sameFailureRef = (a, b) => a.purpose === b.purpose && a.command === b.command && lineSet(a.lines) === lineSet(b.lines);

const SAME_SIG = { has: ["SAME", "HEX12"], lacks: ["DIFFERENT"] };
const DIFFERENT_SIG = { has: ["DIFFERENT", "HEX12"], lacks: ["SAME"] };

const expectOf = (a, b) => (sameFailureRef(a, b) ? SAME_SIG : DIFFERENT_SIG);

// ---- a seeded generator, the same numbers for the same seed --------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const hexOf = (r, n) => Array.from({ length: n }, () => pick(r, [..."0123456789abcdef"])).join("");

export const uuidOf = (r) => ((u) => (r() < 0.3 ? u.toUpperCase() : u))(`${hexOf(r, 8)}-${hexOf(r, 4)}-4${hexOf(r, 3)}-${pick(r, ["8", "9", "a", "b"])}${hexOf(r, 3)}-${hexOf(r, 12)}`);

const NAMES = ["rejects_amount_over_paid", "accepts_amount_within_paid", "refunds_only_once", "keeps_the_currency", "names_the_approver", "blocks_a_closed_period"];

const SUITES = ["RefundTests", "LedgerSpec", "ApprovalSuite"];

const REASONS = ["amount over paid", "currency changed", "approval missing", "period closed", "tenant mismatch"];

// Failing lines with a place for an id: where a UUID stands in what a test runner prints.
const TEMPLATES = [
  (u, f) => `Error: request ${u} failed: ${f.reason}`,
  (u, f) => `  at handler (order ${u}) expected ${f.reason} to be refused`,
  (u, f) => `${u} FAIL ${f.suite}.${f.name}`,
  (u, f) => `Error: tenant {${u}} saw ${f.reason}`,
  (u, f) => `Error: id=${u} not found while ${f.reason}`,
  (u, f, v) => `Error: correlation ${u} and session ${v} failed: ${f.reason}`,
];

const failureOf = (r) => ({ suite: pick(r, SUITES), name: pick(r, NAMES), reason: pick(r, REASONS), slots: TEMPLATES.filter(() => r() < 0.45).concat([TEMPLATES[0]]) });

// One run of a failure: its FAIL line, a line for each place an id stands -- each printing ids of its own -- and a tally.
const runOf = (r, f, over = {}) => ({ purpose: "test", command: "rt-command-0000a7e5", lines: [`FAIL ${f.suite}.${f.name}`, ...f.slots.map((t) => t(uuidOf(r), f, uuidOf(r))), "Tests: 1 failed, 9 passed"], status: 1, ...over });

const pair = (group, a, b) => ({ group, input: { call: "signature", a, b }, expect: expectOf(a, b) });

const DIFFERENCES = [
  (r, f) => ({ ...f, name: pick(r, NAMES.filter((n) => n !== f.name)) }),
  (r, f) => ({ ...f, reason: pick(r, REASONS.filter((x) => x !== f.reason)) }),
];

const samePair = (r, group) => ((f) => pair(group, runOf(r, f), runOf(r, f)))(failureOf(r));

const differentPair = (r, group, difference = pick(r, DIFFERENCES)) => ((f) => pair(group, runOf(r, f), runOf(r, difference(r, f))))(failureOf(r));

// ---- fixed runs -------------------------------------------------------------------------------------------------------

const UUIDS = ["550e8400-e29b-41d4-a716-446655440000", "9b2c4e1a-7f30-4d5e-b8a1-0c6f2d9e4b37", "1f0e5d2c-3b4a-4987-a6f5-e4d3c2b1a098", "C0FFEE11-2233-4455-8677-8899AABBCCDD"];

const run = (lines, over = {}) => ({ purpose: "test", command: "rt-command-0000a7e5", lines, status: 1, ...over });

// A fixed pair says what the contract makes of it: the same failure, or a different one.
const fixed = (group, a, b, expect) => ({ group, input: { call: "signature", a: run(a), b: run(b) }, expect });

const FIXED = [
  fixed("uuid-volatile", [`Error: request ${UUIDS[0]} failed for order`], [`Error: request ${UUIDS[1]} failed for order`], SAME_SIG),
  fixed("uuid-volatile", [`Error: request ${UUIDS[1]} failed for order`], [`Error: request ${UUIDS[2]} failed for order`], SAME_SIG),
  fixed("uuid-volatile", ["FAIL RefundTests.rejects_amount_over_paid", `Error: order ${UUIDS[2]} was refunded twice`], ["FAIL RefundTests.rejects_amount_over_paid", `Error: order ${UUIDS[0]} was refunded twice`], SAME_SIG),
  fixed("uuid-anywhere", [`${UUIDS[0]} FAIL LedgerSpec.keeps_the_currency`], [`${UUIDS[3]} FAIL LedgerSpec.keeps_the_currency`], SAME_SIG),
  fixed("uuid-anywhere", [`Error: tenant {${UUIDS[1]}} saw another tenant's invoice`], [`Error: tenant {${UUIDS[3]}} saw another tenant's invoice`], SAME_SIG),
  fixed("uuid-anywhere", [`Error: id=${UUIDS[2]} not found`], [`Error: id=${UUIDS[1].toUpperCase()} not found`], SAME_SIG),
  fixed("uuid-anywhere", [`Error: correlation ${UUIDS[0]} and session ${UUIDS[1]} failed`], [`Error: correlation ${UUIDS[2]} and session ${UUIDS[3]} failed`], SAME_SIG),
  fixed("still-different", [`FAIL RefundTests.rejects_amount_over_paid`, `Error: request ${UUIDS[0]} failed`], [`FAIL RefundTests.refunds_only_once`, `Error: request ${UUIDS[1]} failed`], DIFFERENT_SIG),
  fixed("still-different", [`Error: request ${UUIDS[0]} failed: amount over paid`], [`Error: request ${UUIDS[1]} failed: approval missing`], DIFFERENT_SIG),
  fixed("still-different", [`Error: request ${UUIDS[0]} failed`], [`Error: request ${UUIDS[1]} failed`, "FAIL LedgerSpec.keeps_the_currency"], DIFFERENT_SIG),
  fixed("still-volatile", ["2026-10-07T10:00:01Z FAIL RefundTests.rejects_amount_over_paid (12 ms)"], ["2026-11-08T23:59:59Z FAIL RefundTests.rejects_amount_over_paid (340 ms)"], SAME_SIG),
  fixed("still-volatile", ["Error: cannot open /home/alice/work/fixtures/refund.json"], ["Error: cannot open /srv/build/agent/fixtures/refund.json"], SAME_SIG),
  fixed("still-volatile", ["Error: request 3f9a1c0b7e21aa failed"], ["Error: request 9c0d1e2f3a4b5c failed"], SAME_SIG),
  fixed("still-volatile", ["Tests: 1 failed, 9 passed", "Expected: false  Received: true"], ["Expected: false  Received: true", "Tests: 1 failed, 9 passed"], SAME_SIG),
];

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(8, samples) }, () => (r() < 0.6 ? samePair(r, "seeded-uuid") : differentPair(r, "seeded-uuid")))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["one failure, two request ids", [`Error: request ${UUIDS[0]} failed`], [`Error: request ${UUIDS[1]} failed`], true],
  ["one failure, ids in either case", [`Error: request ${UUIDS[3]} failed`], [`Error: request ${UUIDS[3].toLowerCase()} failed`], true],
  ["one failure, lines in another order", ["a", `b ${UUIDS[0]}`], [`b ${UUIDS[2]}`, "a"], true],
  ["another test failing", ["FAIL x.one"], ["FAIL x.two"], false],
  ["one test failing differently", [`Error: ${UUIDS[0]} amount over paid`], [`Error: ${UUIDS[0]} currency changed`], false],
  ["an id that is not a whole UUID", ["Error: request 550e8400-e29b failed"], ["Error: request 9b2c4e1a-7f30 failed"], false],
];

const uuidRows = () => FIXED.filter((c) => c.group !== "still-volatile").filter((c) => (sameFailureRef(c.input.a, c.input.b) ? SAME_SIG : DIFFERENT_SIG) !== c.expect).map((c) => `a fixed pair is not what the reference model derives: ${c.group}`);

const handRows = () => HAND.filter(([, a, b, same]) => sameFailureRef(run(a), run(b)) !== same).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

export const selfTest = () => [...handRows(), ...uuidRows(), ...(new RegExp(UUID.source, "i").test(uuidOf(mulberry32(1))) ? [] : ["the generator makes something that is not a UUID"])];
