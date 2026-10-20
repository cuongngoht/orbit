// For ONE component: which provider runs it, and if none, why not.
//
// Compatibility is a fact about a machine and a way of running things; a
// preference is a person's choice among the ways that WORK. They are kept apart
// on purpose, and in this order: every provider is asked whether it can run the
// component, independent of what anybody prefers, and only then does a
// preference choose among the ones that said yes. So `native` preferred on a
// machine where the component is incompatible with native is still
// incompatible, and says so -- the preference narrows the choice, it can never
// widen what is possible, and it never quietly falls back to another provider
// the person did not ask for.
//
// What comes out is a state with a reason:
//
//   ready          a provider can run it, and a file declares how to start it
//   blocked        it could run once something is done -- a tool installed, an
//                  environment built, a start command chosen. `blocking` says what
//   unresolved     no way of running it exists on this machine
//   unknown        nothing could tell, which is not the same as no
//   not-startable  it is code others use, or a tool that runs and exits: there is
//                  nothing to start, and it never holds the project back
import { startCommand } from "../components.mjs";
import { agoSaid } from "../connectivity/states.mjs";
import { startsKind } from "../vocab.mjs";

export const STATES = ["ready", "blocked", "unresolved", "unknown", "not-startable"];

// What a provider says that means "after somebody acts".
const AFTER_ACTION = ["needs-host", "needs-environment", "unreachable"];

// -> { state, provider, because, command?, alternatives, blocking, candidates }
export function select(component, world, settings, providers) {
  if (!startsKind(component.kind)) return { state: "not-startable", provider: null, because: `a ${component.kind} is not something to start`, alternatives: [], blocking: [], candidates: [] };
  const wanted = wantedOf(component, settings);
  const candidates = reached(askedOf(providers, component, world), wanted, world.reach?.[component.key] ?? {});
  const { chosen, considered } = choose(candidates, wanted);
  return { ...(chosen ? runnable(component, chosen, settings) : declared(component, settings, unrunnable(considered, wanted))), candidates, alternatives: candidates.filter((c) => c !== chosen).map(({ provider, state, because }) => ({ provider, state, because })) };
}

// A provider that DELEGATES (a sandbox places a component on the way a person would run it) answers with one
// candidate per way, each saying which provider launches it (`via`). In a sandbox's world only such a provider is
// asked directly -- the ways it places on are asked through it -- and in a person's world never one.
const servedIn = (p, world) => Boolean(p.composite) === Boolean(world.sandbox);

const askedOf = (providers, component, world) => providers.filter((p) => servedIn(p, world)).flatMap((p) => (p.candidates ? p.candidates(component, world, providers) : [{ provider: p.id, ...p.compatibility(component, world) }]));

// What cannot run HERE still says how it would start, when a file declares that: blocked is news about
// this machine, and never a reason to say no file declares a way to start it. Only `ready` is started.
const declared = (component, settings, outcome) => ({ ...outcome, command: startCommand(component, settings.components?.[component.key]?.command ?? null).command ?? null });

const wantedOf = (component, settings) => settings.components?.[component.key]?.provider ?? settings.strategy ?? "auto";

// Under `auto`, a way that is compatible but whose before-start reach target was FRESHLY seen
// unreachable from there (src/runtime/connectivity/observations.mjs `reachOf`, handed in as data --
// nothing here asks the network) is passed over for a way where it was reachable. Never on a stale,
// unknown or unchecked answer, which says nothing; and never for a provider a person NAMED -- that one
// is held to, and a start's gate says why it cannot start.
const reached = (candidates, wanted, reach) => (wanted === "auto" ? candidates.map((c) => unreached(c, reach[c.provider])) : candidates);

const unreached = (c, r) => (c.state === "compatible" && r?.state === "UNREACHABLE" ? { ...c, state: "unreachable", because: `${c.because}; but ${r.label} (${r.host}:${r.port}) was not reachable from ${c.provider} when last checked, ${agoSaid(r.age)}`, blocking: [`make ${r.label} reachable from ${c.provider}, or check again: runtime retry ${r.target}`] } : c);

// A named provider is the ONLY one considered: a preference never falls back.
function choose(candidates, wanted) {
  const considered = wanted === "auto" ? candidates : candidates.filter((c) => c.provider === wanted);
  return { considered, chosen: considered.find((c) => c.state === "compatible") ?? null };
}

function runnable(component, chosen, settings) {
  const start = startCommand(component, settings.components?.[component.key]?.command ?? null);
  if (start.command) return { state: "ready", provider: chosen.via ?? chosen.provider, execution: chosen.via ? chosen.provider : null, because: chosen.because, command: start.command, startAlternatives: start.alternatives, blocking: [] };
  return { state: "blocked", provider: chosen.provider, because: `${chosen.provider} can run it, but ${start.none}`, blocking: [start.none] };
}

// What no provider could run is named by the FIRST provider, in preference order, that is not ruled
// out: if it could work after an action the component is blocked on that action, if nobody could tell
// it is unknown, and only when every way is ruled out is it `unresolved`. The order matters: a native
// way that cannot be judged is not made "blocked" by a container route that would need Docker, and
// nobody is told to install a thing for a component that may well run as it is. What must be DONE is
// that provider's list alone: another way that would also work is an alternative, shown beside it,
// and never a second thing to do.
const OUTCOMES = [
  { state: "blocked", picks: (c) => AFTER_ACTION.includes(c.state), names: true },
  { state: "unknown", picks: (c) => c.state === "unknown", names: false },
];

function unrunnable(considered, wanted) {
  if (!considered.length) return { state: "unresolved", provider: null, because: `${wanted} is not a provider this engine has`, blocking: [] };
  const first = considered.find((c) => c.state !== "incompatible");
  const row = OUTCOMES.find((o) => first && o.picks(first));
  const said = row ? considered.filter(row.picks) : considered;
  return { state: row?.state ?? "unresolved", provider: row?.names ? first.provider : null, because: said.map((c) => `${c.provider}: ${c.because}`).join("; "), blocking: row?.names ? first.blocking ?? [] : [] };
}
