// ATTRIBUTION (0.2.2, ADR 0044): which run an invocation belongs to, and how anybody knows it. A LEAF with no imports,
// for the reason src/policy.mjs is one: the session trail, Orbit Live, Satellite and Orbit Control must say the same
// word about the same call, and none of them may import another to agree on it.
//
// Five words, each earned by its own kind of evidence, in the order a reader trusts them:
//
//   RUNTIME_BOUND   Orbit itself bound the invocation to the run when it made the call -- a declared skill's step, an
//                   engineering task's action: the run's own journal names it
//   HOST_OBSERVED   the host's own payload carried the link -- the agent id on a subagent's tool event, the Agent call
//                   that launched it -- observed by the hooks, never said by the agent
//   REPORTED        an agent or the session SAID which run it was, and nothing independent observed it
//   UNATTRIBUTED    nothing says which run: the call is shown where it was observed (the session, the project), and
//                   never moved onto the nearest root, the latest skill or the run that started closest in time
//   CONFLICTING     two sources name different runs (or one run, different agents), and neither is chosen for the reader
//
// A word is never authority. A run id, an agent id or one of these words grants nothing: no gate, approval or
// protected boundary reads them (test/protected-bypass.test.mjs).
//
// A Satellite agent run's id is unique only inside its mission, so outside the mission it is said QUALIFIED:
// `msn-<12 hex>/arn-<n>`. The dispatch envelope Orbit hands a host names both under its API mark, and `envelopeRefOf`
// reads those two ids off a text that carries the mark -- nothing else of it, and nothing at all when its ids disagree.

export const ATTRIBUTION = Object.freeze([
  { id: "RUNTIME_BOUND", rank: 1, say: "Orbit bound this invocation to the run when it made the call" },
  { id: "HOST_OBSERVED", rank: 2, say: "the host's own payload links this invocation to the run" },
  { id: "REPORTED", rank: 3, say: "an agent or the session said so; nothing independent observed it" },
  { id: "UNATTRIBUTED", rank: 4, say: "nothing says which run made it: shown where it was observed" },
  { id: "CONFLICTING", rank: 5, say: "two sources name different runs; neither is chosen" },
]);

export const ATTRIBUTION_WORDS = Object.freeze(ATTRIBUTION.map((a) => a.id));

export const attributionOf = (id) => ATTRIBUTION.find((a) => a.id === id) ?? ATTRIBUTION.find((a) => a.id === "UNATTRIBUTED");

// What a run's link to an agent comes to, from what the hooks OBSERVED and what somebody REPORTED: ordered, the first
// row that holds, the last always. Two different agents named for one run, by any mix of sources, is CONFLICTING.
const distinct = (list) => [...new Set((list ?? []).filter((x) => typeof x === "string" && x))];

export const SETTLE = Object.freeze([
  { word: "CONFLICTING", when: (s) => s.agents.length > 1 },
  { word: "HOST_OBSERVED", when: (s) => s.observed.length > 0 },
  { word: "REPORTED", when: (s) => s.reported.length > 0 },
  { word: "UNATTRIBUTED", when: () => true },
]);

export function settle({ observed, reported } = {}) {
  const s = { observed: distinct(observed), reported: distinct(reported), agents: distinct([...(observed ?? []), ...(reported ?? [])]) };
  return { word: SETTLE.find((r) => r.when(s)).word, agents: s.agents, observed: s.observed, reported: s.reported };
}

// ---- the qualified run reference ------------------------------------------------------------------------------------

export const RUN_REF = /^(msn-[0-9a-f]{12})\/(arn-[1-9][0-9]{0,4})$/;

export const runRefOf = (mission, run) => (RUN_REF.test(`${mission}/${run}`) ? `${mission}/${run}` : null);

export const parseRunRef = (text) => ((m) => (m ? { mission: m[1], run: m[2] } : null))(RUN_REF.exec(String(text ?? "")));

// ---- the two ids an envelope carries --------------------------------------------------------------------------------

export const ENVELOPE_MARK = "orbit.satellite.envelope/v1";

// An envelope is a few tens of kilobytes at most (satellite/src/hosts/envelope.mjs SLICE_LIMITS); past this, nothing is read.
export const ENVELOPE_SCAN_CHARS = 262144;

const MISSION_FIELD = /"missionId"\s*:\s*"(msn-[0-9a-f]{12})"/g;

const RUN_FIELD = /"agentRunId"\s*:\s*"(arn-[1-9][0-9]{0,4})"/g;

const onlyOne = (text, re) => ((found) => (found.length === 1 ? found[0] : null))(distinct([...text.matchAll(re)].map((m) => m[1])));

export function envelopeRefOf(text) {
  const t = typeof text === "string" ? text.slice(0, ENVELOPE_SCAN_CHARS) : "";
  if (!t.includes(`"${ENVELOPE_MARK}"`)) return null;
  return runRefOf(onlyOne(t, MISSION_FIELD), onlyOne(t, RUN_FIELD));
}
