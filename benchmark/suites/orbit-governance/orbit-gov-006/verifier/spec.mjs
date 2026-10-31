// THE SPEC of ORBIT-GOV-006: a call is attributed only by evidence. settle() comes to its word by its ordered table --
// CONFLICTING whenever two different agents are named for one run, by any mix of sources, then HOST_OBSERVED, REPORTED
// and UNATTRIBUTED -- names every agent it was told of and chooses none, and moves nothing onto whatever else rides
// along; envelopeRefOf() reads a qualified run reference only off a text carrying the envelope's mark and exactly one
// mission and one run. Written from the contract (AGENTS.md "A run knows its identity, and a call is attributed only by
// evidence", the header of src/attribution.mjs, ADR 0044), kept beside the probe and handed to no runner; it never
// imports the subject. Both directions are checked: attributing every call fails as surely as attributing none.
//
// The fixed rows carry answers written by hand; the seeded rows -- evidence at random, envelopes at random and some
// made to disagree -- are answered by the reference model, which selfTest holds to every answer written by hand.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the rows written by hand from the contract
export const CASE = "ORBIT-GOV-006";

export const GROUPS = {
  "observed": "an agent the hooks observed, and nothing else, is HOST_OBSERVED, naming that agent",
  "reported": "an agent somebody reported, and nothing observed, is REPORTED, naming that agent",
  "agreeing": "an observed agent and a report of the same agent agree: HOST_OBSERVED, one agent",
  "observed-and-reported-disagree": "an observed agent and a report of a different one are CONFLICTING, and both are named: neither is chosen",
  "two-observed": "two different agents observed for one run are CONFLICTING, and both are named",
  "two-reported": "two different agents reported for one run are CONFLICTING, and both are named",
  "same-id-twice": "the same id given twice is one agent",
  "nothing-said": "no evidence, or only empty ids, is UNATTRIBUTED and names no agent",
  "nothing-guessed": "a latest skill, a nearest run or a closest agent riding along moves no word and names no agent",
  "seeded-settle": "observed and reported agents at random: the word the ordered table gives, every agent named once",
  "envelope-read": "an envelope's mark with exactly one well-formed mission and run gives the qualified reference, pretty-printed or not, prose around it or not",
  "envelope-refused": "no mark, two missions, two runs, no well-formed mission or run, or no text at all: no reference",
  "envelope-scan": "nothing past the first 262144 characters is read: a mark there is no mark, and ids there disagree with nothing",
  "seeded-envelope": "envelopes at random, some made to disagree or malformed: the reference exactly when one mission and one run are named",
};

// ---- the reference model: the ordered table, and the two ids an envelope carries -----------------------------------

const ids = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && x !== ""))];

// Ordered: the first that holds decides, and the last always does.
const WORDS = [
  ["CONFLICTING", (s) => s.agents.length > 1],
  ["HOST_OBSERVED", (s) => s.observed.length > 0],
  ["REPORTED", (s) => s.reported.length > 0],
  ["UNATTRIBUTED", () => true],
];

const evidenceOf = (sources) => ({ observed: ids(sources?.observed), reported: ids(sources?.reported), agents: ids([...ids(sources?.observed), ...ids(sources?.reported)]) });

export const settledIds = (sources) => ((s) => [WORDS.find(([, holds]) => holds(s))[0], ...s.agents.map((a) => `agent:${a}`)])(evidenceOf(sources));

const MARK = '"orbit.satellite.envelope/v1"';

const SCANNED = 262144;

const MISSION = /"missionId"\s*:\s*"(msn-[0-9a-f]{12})"/g;

const RUN = /"agentRunId"\s*:\s*"(arn-[1-9][0-9]{0,4})"/g;

const onlyOne = (text, re) => ((found) => (found.length === 1 ? found[0] : null))([...new Set([...text.matchAll(re)].map((m) => m[1]))]);

const refIn = (t) => ((mission, run) => (mission && run ? [`${mission}/${run}`] : ["none"]))(onlyOne(t, MISSION), onlyOne(t, RUN));

const scannedText = (text) => (typeof text === "string" ? text.slice(0, SCANNED) : "");

export const envelopeIds = (text) => ((t) => (t.includes(MARK) ? refIn(t) : ["none"]))(scannedText(text));

// The text an input describes: its parts joined, a run of spaces standing for padding.
export const textFor = (i) => (Array.isArray(i.parts) ? i.parts.map((p) => (typeof p === "string" ? p : " ".repeat(Number(p?.spaces) || 0))).join("") : i.value);

// ---- the checks written by hand ------------------------------------------------------------------------------------

const A = "claude:00000000000000aa";
const B = "claude:00000000000000bb";
const C = "codex:00000000000000cc";

const settled = (group, sources, words) => ({ group, input: sources === undefined ? { call: "settle" } : { call: "settle", sources }, expect: { exactly: [words[0], ...words.slice(1).map((a) => `agent:${a}`)] } });

const SETTLE_ROWS = [
  settled("observed", { observed: [A] }, ["HOST_OBSERVED", A]),
  settled("observed", { observed: [A], reported: [] }, ["HOST_OBSERVED", A]),
  settled("observed", { observed: [A, null, ""] }, ["HOST_OBSERVED", A]),
  settled("reported", { reported: [B] }, ["REPORTED", B]),
  settled("reported", { observed: [], reported: [B] }, ["REPORTED", B]),
  settled("reported", { observed: [""], reported: [B, null] }, ["REPORTED", B]),
  settled("agreeing", { observed: [A], reported: [A] }, ["HOST_OBSERVED", A]),
  settled("agreeing", { observed: [A, A], reported: [A, ""] }, ["HOST_OBSERVED", A]),
  settled("observed-and-reported-disagree", { observed: [A], reported: [B] }, ["CONFLICTING", A, B]),
  settled("observed-and-reported-disagree", { observed: [B], reported: [A] }, ["CONFLICTING", A, B]),
  settled("observed-and-reported-disagree", { observed: [A, A], reported: [C, C] }, ["CONFLICTING", A, C]),
  settled("observed-and-reported-disagree", { observed: [A], reported: [A, C] }, ["CONFLICTING", A, C]),
  settled("two-observed", { observed: [A, B] }, ["CONFLICTING", A, B]),
  settled("two-observed", { observed: [A, B], reported: [A] }, ["CONFLICTING", A, B]),
  settled("two-reported", { reported: [A, C] }, ["CONFLICTING", A, C]),
  settled("two-reported", { observed: [], reported: [B, C] }, ["CONFLICTING", B, C]),
  settled("same-id-twice", { observed: [A, A] }, ["HOST_OBSERVED", A]),
  settled("same-id-twice", { reported: [C, C, C] }, ["REPORTED", C]),
  settled("nothing-said", undefined, ["UNATTRIBUTED"]),
  settled("nothing-said", {}, ["UNATTRIBUTED"]),
  settled("nothing-said", { observed: [], reported: [] }, ["UNATTRIBUTED"]),
  settled("nothing-said", { observed: [null, ""], reported: [null] }, ["UNATTRIBUTED"]),
  settled("nothing-guessed", { observed: [], reported: [], latestSkill: "orbit-qa", nearestRun: "msn-0123456789ab/arn-3", closestAgent: A, startedAt: "2026-10-31T09:00:00.000Z" }, ["UNATTRIBUTED"]),
  settled("nothing-guessed", { reported: [B], latestSkill: "orbit-qa", nearestRun: "msn-0123456789ab/arn-3", closestAgent: A }, ["REPORTED", B]),
  settled("nothing-guessed", { observed: [A], closestAgent: B, latestAgent: C }, ["HOST_OBSERVED", A]),
];

const MARK_WORD = "orbit.satellite.envelope/v1";

const envelope = (over = {}, pretty = true) => JSON.stringify({ api: MARK_WORD, missionId: "msn-0123456789ab", agentRunId: "arn-2", instruction: { text: "read the release notes" }, report: { command: "node satellite.mjs agent report msn-0123456789ab arn-2", example: { agentRunId: over.agentRunId ?? "arn-2" } }, ...over }, null, pretty ? 2 : 0);

const read = (group, parts, want) => ({ group, input: { call: "envelope", parts }, expect: { exactly: [want] } });

const valued = (value) => ({ group: "envelope-refused", input: value === undefined ? { call: "envelope" } : { call: "envelope", value }, expect: { exactly: ["none"] } });

const REF = "msn-0123456789ab/arn-2";

const ENVELOPE_ROWS = [
  read("envelope-read", [envelope()], REF),
  read("envelope-read", [envelope({}, false)], REF),
  read("envelope-read", ["Run this envelope exactly:\n", envelope(), "\nthen report."], REF),
  read("envelope-read", [envelope({ missionId: "msn-abcdef012345", agentRunId: "arn-17" })], "msn-abcdef012345/arn-17"),
  read("envelope-read", [envelope({ agentRunId: "arn-99999" }, false)], "msn-0123456789ab/arn-99999"),
  read("envelope-read", [envelope(), "\n", envelope({}, false)], REF),
  read("envelope-refused", [envelope().replace(MARK_WORD, "something/else")], "none"),
  read("envelope-refused", [`mark ${MARK_WORD} `, envelope().replace(`"${MARK_WORD}"`, '"x"')], "none"),
  read("envelope-refused", [envelope(), "\n", envelope({ missionId: "msn-ba9876543210" })], "none"),
  read("envelope-refused", [envelope(), "\n", envelope({ agentRunId: "arn-9" })], "none"),
  read("envelope-refused", [JSON.stringify({ api: MARK_WORD, missionId: "msn-0123456789ab", agentRunId: "arn-0" })], "none"),
  read("envelope-refused", [JSON.stringify({ api: MARK_WORD, missionId: "msn-0123456789ab", agentRunId: "arn-012" })], "none"),
  read("envelope-refused", [JSON.stringify({ api: MARK_WORD, missionId: "msn-0123456789ab", agentRunId: "arn-123456" })], "none"),
  read("envelope-refused", [JSON.stringify({ api: MARK_WORD, missionId: "msn-0123456789AB", agentRunId: "arn-3" })], "none"),
  read("envelope-refused", [JSON.stringify({ api: MARK_WORD, missionId: "msn-0123456789a", agentRunId: "arn-3" })], "none"),
  read("envelope-refused", [JSON.stringify({ api: MARK_WORD, missionId: "msn-0123456789ab" })], "none"),
  read("envelope-refused", [JSON.stringify({ api: MARK_WORD, agentRunId: "arn-3" })], "none"),
  valued(undefined),
  valued(null),
  valued(42),
  valued({ api: MARK_WORD, missionId: "msn-0123456789ab", agentRunId: "arn-2" }),
  read("envelope-scan", [{ spaces: 300000 }, envelope()], "none"),
  read("envelope-scan", [envelope(), { spaces: 300000 }, envelope({ missionId: "msn-ba9876543210" })], REF),
  read("envelope-scan", [{ spaces: 1000 }, envelope()], REF),
];

const FIXED = [...SETTLE_ROWS, ...ENVELOPE_ROWS];

// ---- a seeded generator, the same evidence and envelopes for the same seed --------------------------------------------

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

const AGENTS = [A, B, C, A, B, "", null];

const someOf = (r) => Array.from({ length: Math.floor(r() * 3) }, () => pick(r, AGENTS));

const RIDERS = [{}, {}, { latestSkill: "orbit-qa" }, { nearestRun: "msn-0123456789ab/arn-3", closestAgent: B }];

const seededSettle = (r) => ((sources) => ({ group: "seeded-settle", input: { call: "settle", sources }, expect: { exactly: settledIds(sources) } }))({ observed: someOf(r), reported: someOf(r), ...pick(r, RIDERS) });

const hex = (r, n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");

const missionOf = (r) => `msn-${hex(r, 12)}`;

const runOf = (r) => `arn-${1 + Math.floor(r() * 99999)}`;

// Ways a seeded envelope can go wrong -- or not at all.
const TWISTS = [
  () => [],
  () => [],
  (r, e) => ["\n", envelope({ missionId: missionOf(r), agentRunId: e.agentRunId })],
  (r, e) => ["\n", envelope({ missionId: e.missionId, agentRunId: runOf(r) })],
  (r, e) => ["\n", envelope(e, false)],
];

const seededParts = (r, e) => [pick(r, ["", "Run this envelope exactly:\n"]), envelope(e, r() < 0.5), ...pick(r, TWISTS)(r, e)];

const unmarked = (r, parts) => (r() < 0.15 ? parts.map((p) => p.replace(`"${MARK_WORD}"`, '"orbit.satellite.envelope/v0"')) : parts);

const seededEnvelope = (r) => ((parts) => ({ group: "seeded-envelope", input: { call: "envelope", parts }, expect: { exactly: envelopeIds(textFor({ parts })) } }))(unmarked(r, seededParts(r, { missionId: missionOf(r), agentRunId: runOf(r) })));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seededSettle(r)), ...Array.from({ length: Math.max(8, Math.floor(samples / 2)) }, () => seededEnvelope(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["the host's own word alone", settledIds({ observed: [A] }), ["HOST_OBSERVED", `agent:${A}`]],
  ["somebody's word alone", settledIds({ reported: [A] }), ["REPORTED", `agent:${A}`]],
  ["the host and a report disagree", settledIds({ observed: [A], reported: [B] }), ["CONFLICTING", `agent:${A}`, `agent:${B}`]],
  ["one run launched twice", settledIds({ observed: [A, B] }), ["CONFLICTING", `agent:${A}`, `agent:${B}`]],
  ["an empty id is no id", settledIds({ observed: [null, ""], reported: [null] }), ["UNATTRIBUTED"]],
  ["an envelope names its run", envelopeIds(envelope()), [REF]],
  ["the ids alone are not an envelope", envelopeIds(envelope().replace(MARK_WORD, "x")), ["none"]],
  ["two missions disagree", envelopeIds(`${envelope()}\n${envelope({ missionId: "msn-ba9876543210" })}`), ["none"]],
];

const answerOf = (i) => (i.call === "settle" ? settledIds(i.sources) : envelopeIds(textFor(i)));

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const handFindings = () => HAND.filter(([, got, want]) => !sameIds(got, want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

const fixedFindings = () => FIXED.filter((c) => !sameIds(answerOf(c.input), c.expect.exactly)).map((c) => `the reference model disagrees with a row written by hand in ${c.group}: ${JSON.stringify(c.input).slice(0, 200)}`);

export const selfTest = () => [...handFindings(), ...fixedFindings()];
