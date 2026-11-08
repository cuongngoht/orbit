// THE AGREEMENT RULE (the activation benchmark, §4): which skills and agents a session started, by two sources that must
// say the same -- the host's stream (each Skill and Agent call, `hostOf` v2) and the session trail Orbit's own hooks
// wrote (`skill.invoked`, `agent.invoked`), read through the trail's own command, `cli/trace.mjs turns --json`, by the
// inspection and never by importing it. Neither is believed alone: a call the trail never saw, or a trail line no call
// made, is CONFLICTING -- the evidence of a row that rests on it is insufficient. An arm with no Orbit (`none`) has no
// trail and expects none: there, any trail line and any `orbit:*` call are CONFLICTING.
//
// The turns view keeps at most MAX_STEPS steps of one turn, and a benchmark session is one turn. Past that -- or when the
// view could not be read -- what the trail lacks cannot be told from what the view left out, so the trail's uncapped
// usage is compared instead (`trace.mjs usage --json`, the inspection's trace.json): the skills and the agents the
// stream started, in all -- and BY NAME wherever usage keeps names (every skill it lists, started or refused), with
// every line the capped view does show held to its call. Counts alone would let either source be rewritten alone, a call
// renamed keeping every count. Usage keeps no agent by name, so past the cap an agent is held by its count and the lines
// the view shows. With neither readable, a call the view does not show is UNDETERMINED -- never AGREES. Usage counts
// every session the store's trail holds: a caller hands it the calls of every round so far.
//
//   agreementOf(uses, trail = { turns, usage }, o = { arm, session }) -> { verdict, by, stream, trail, missing }
//   VERDICTS · OURS
import { hostSession } from "../../../src/memory/session.mjs";
import { MAX_STEPS } from "../../../src/trace/projections/turns.mjs";

export const VERDICTS = ["AGREES", "CONFLICTING", "UNDETERMINED"];

// A component of Orbit's own plugin, as a host names it.
export const OURS = /^orbit:/;

const KINDS = ["skill", "agent"];

// What the stream says a session started: every Skill and Agent call, as `<kind> <name>`.
const streamed = (uses) => uses.filter((u) => u.skill || u.agent).map((u) => (u.skill ? `skill ${u.skill}` : `agent ${u.agent}`));

const turnsIn = (doc, session) => (doc?.json?.turns ?? []).filter((t) => !session || t.session === hostSession("claude", session));

// What the trail says: every skill and agent step of the session's turns, as `<kind> <name>`.
const trailed = (turns) => turns.flatMap((t) => t.steps ?? []).filter((s) => KINDS.includes(s.kind)).map((s) => `${s.kind} ${s.label}`);

const tally = (names) => names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map());

// What `a` holds more of than `b`, one entry per call too many.
const beyond = (a, b) => ((tb) => [...tally(a)].flatMap(([n, k]) => Array(Math.max(0, k - (tb.get(n) ?? 0))).fill(n)))(tally(b));

const read = (doc) => doc?.exit === 0 && doc?.json !== null && typeof doc?.json === "object";

const countsOf = (names) => ({ skills: names.filter((n) => n.startsWith("skill ")).length, agents: names.filter((n) => n.startsWith("agent ")).length });

const capped = (turns) => turns.some((t) => (t.steps ?? []).length >= MAX_STEPS);

const answer = (verdict, by, s, t, missing) => ({ verdict, by, stream: countsOf(s), trail: t, missing });

// An arm with no Orbit: no `orbit:*` call, and no trail at all.
function noOrbit(s, turns) {
  const forged = trailed(turns);
  const ours = s.filter((n) => OURS.test(n.split(" ")[1] ?? ""));
  return answer(forged.length || ours.length ? "CONFLICTING" : "AGREES", "arm", s, countsOf(forged), { trail: ours, stream: forged });
}

// Named, call for call, where the turns view shows the whole session.
function byName(s, t) {
  const missing = { trail: beyond(s, t), stream: beyond(t, s) };
  return answer(missing.trail.length || missing.stream.length ? "CONFLICTING" : "AGREES", "turns", s, countsOf(t), missing);
}

// A skill as the trail's usage keys it: its bare name, the plugin's prefix left off (src/trace/projections/usage.mjs).
const bare = (name) => String(name).split(":").at(-1);

const streamSkills = (s) => tally(s.filter((n) => n.startsWith("skill ")).map((n) => bare(n.slice("skill ".length))));

// Every skill the trail's usage lists, by its bare name, with every time it was started or refused -- a list cut at its
// top rows still names each row it keeps whole.
const usageSkills = (usage) => (Array.isArray(usage.json.skills) ? usage.json.skills : []).map((r) => [String(r.id), Number(r.invoked ?? 0) + Number(r.refused ?? 0)]);

// The skills the usage names that the stream started more, or less, often than the trail says.
const skillsApart = (s, usage) => ((st) => usageSkills(usage).filter(([id, n]) => (st.get(id) ?? 0) !== n).map(([id, n]) => ({ name: `skill ${id}`, trail: n, stream: st.get(id) ?? 0 })))(streamSkills(s));

const missingOf = (apart, extra) => ({ trail: apart.filter((x) => x.stream > x.trail).map((x) => x.name), stream: [...extra, ...apart.filter((x) => x.trail > x.stream).map((x) => x.name)] });

// Where a turn reached the view's cap: the trail's uncapped totals, each skill usage names by its name, and every line the
// capped view shows (`shown`) held to its call.
function byCount(s, usage, shown) {
  const t = { skills: Number(usage.json.totals?.skills ?? 0), agents: Number(usage.json.totals?.agents ?? 0) };
  const c = countsOf(s);
  const missing = missingOf(skillsApart(s, usage), beyond(shown, s));
  const same = c.skills === t.skills && c.agents === t.agents && !missing.trail.length && !missing.stream.length;
  return answer(same ? "AGREES" : "CONFLICTING", "usage", s, t, missing);
}

// A capped turn with no readable counts: a trail line no call made is still CONFLICTING; a call the view does not show is
// UNDETERMINED.
const unsettled = (s, t) => ((extra) => answer(extra.length ? "CONFLICTING" : "UNDETERMINED", "turns-capped", s, countsOf(t), { trail: [], stream: extra }))(beyond(t, s));

// Named where the turns view was read and shows the whole session; else counted, by name where usage keeps names; else
// not settled either way.
const released = (s, turns, trail) => (read(trail.turns) && !capped(turns) ? byName(s, trailed(turns)) : read(trail.usage) ? byCount(s, trail.usage, trailed(turns)) : unsettled(s, trailed(turns)));

export function agreementOf(uses, trail = {}, o = {}) {
  const s = streamed(uses ?? []);
  const turns = turnsIn(trail.turns, o.session);
  return o.arm === "none" ? noOrbit(s, turns) : released(s, turns, trail);
}
