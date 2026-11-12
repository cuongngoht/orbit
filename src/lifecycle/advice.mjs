// ADVICE FROM EVIDENCE (0.6.0, P2): after a tool call FAILED, at most ONE line naming a fact about the session's work
// that holds (src/routing/facts.mjs), its subject, the component that handles it -- chosen by the EXISTING resolver over
// the registry here (src/routing/resolve.mjs `reactingTo`), never a name written in this file -- and the one call that
// brings it in, with why. The host reasons; the engine derives the fact, bounds what is said and keeps the evidence
// (`advice.given` on the trail: the fact, the subject, the provider and its kind, never a sentence).
//
// It speaks only when EVERY row of SILENCE lets it, in order, cheapest first, the last always answering:
//
//   the host cannot carry a line after a failed call (its adapter's `formatFailure` drops the text)
//   nothing is bound here (no known checkout, no session)
//   the trail is off -- without it nothing can tell what was said already, so nothing is said
//   the prompt carried a halt cue (its `halt` MARK, src/routing/intents.mjs): a person said to stop
//   no fact holds
//   every fact that holds was said already this session, about the same subject
//   this prompt already had its line (MAX_PER_PROMPT)
//   the session's governed work is paused, cancelled, waiting for a person or blocked (cli/governed.mjs STATES)
//   no component here reacts to the fact (switched off, refused by policy, not provided)
//
// Nothing is said on a successful tool call: the caller is the failure path alone (src/lifecycle/subscribers/
// learning.mjs `afterFailure`, which joins the line into its one payload, because the dispatcher hears one answer per
// event). The same facts reach the NEXT prompt's decision through the router's hook (`observed`), so a fact found after
// the prompt shapes the next suggestion. Every port is the composition root's (cli/learn-hook.mjs binds `world.advice`),
// read only when its row is reached; one that fails answers null, and a row that cannot tell stays silent.
import { engined } from "../engined.mjs";
import { checksOf } from "../engineering/working-set/checks.mjs";
import { FACTS } from "../routing/facts.mjs";
import { invocationOf } from "../routing/strategy.mjs";
import { lastTurnOf } from "../trace/projections/turns.mjs";

export const MAX_PER_PROMPT = 1;

// Where a governed work stands when advice keeps quiet beside it: a person's pause or cancel, a wait for a person, a block.
export const QUIET = ["paused", "cancelled", "waiting", "blocked"];

export const LINE_BYTES = 420;

const PROBE = "orbit-advice-probe";

// What the composition root read of the session, in the shape a FACTS row derives from (src/routing/facts.mjs).
export const seenOf = (lines, needs) => ({ checks: checksOf(lines ?? []), needs: needs ?? [] });

function once(fn) {
  const memo = {};
  return () => ("value" in memo ? memo.value : (memo.value = quietly(fn)));
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

const given = (events) => (events ?? []).filter((e) => e.type === "advice.given");

const sameAs = (o) => (e) => e.data?.fact === o.fact && e.data?.subject === o.subject;

// The facts not yet said this session about the same subject, read off the session's own trail events -- the one
// definition of "said already", which the composition root also asks BEFORE it loads the owners, the registry and the
// resolver, so a failure whose every fact was said costs only the reads that found that out.
export const unsaidOf = (observed, events) => (observed ?? []).filter((o) => !given(events).some(sameAs(o)));

// The facts a row may ask for, each read once and only when a row reaches it.
function factsOf(event, world) {
  const port = once(() => world.advice?.() ?? null);
  const session = once(() => port()?.session() ?? null);
  const turn = once(() => lastTurnOf(session() ?? [], event.session));
  const unsaid = once(() => unsaidOf(port()?.observed() ?? [], session()));
  return { event, world, port, session, turn, unsaid, chosen: once(() => firstChosen(port(), unsaid())), owner: once(() => port()?.owner() ?? null) };
}

// The first fact not yet said whose component the resolver chooses here.
const firstChosen = (port, unsaid) => unsaid.map((o) => ({ ...o, provider: port.resolve(o) })).find((o) => o.provider) ?? null;

const carries = (host, input) => typeof host?.formatFailure === "function" && JSON.stringify(host.formatFailure(PROBE, input) ?? null).includes(PROBE);

export const SILENCE = [
  { row: "host-cannot-speak", when: (f) => !carries(f.world.host, f.world.input) },
  { row: "unbound", when: (f) => !f.event.session || !f.port() },
  { row: "trail-off", when: (f) => !f.session() },
  { row: "halted", when: (f) => (f.turn()?.prompt?.data?.marks ?? []).includes("halt") },
  { row: "nothing-observed", when: (f) => !(f.port().observed() ?? []).length },
  { row: "said-already", when: (f) => !f.unsaid().length },
  { row: "cap-spent", when: (f) => given(f.turn()?.events).length >= MAX_PER_PROMPT },
  { row: "work-quiet", when: (f) => QUIET.includes(f.owner()?.state) },
  { row: "unresolved", when: (f) => !f.chosen() },
  { row: "speak", speaks: true, when: () => true },
];

export const SILENCE_ROWS = SILENCE.map((r) => r.row);

// The row that decides this failure.
export const adviceRowOf = (event, world) => ((f) => SILENCE.find((r) => r.when(f)))(factsOf(event, world));

const bytes = (text) => Buffer.byteLength(text);

const clipped = (text) => (bytes(text) <= LINE_BYTES ? text : `${[...text].reduce((kept, ch) => (bytes(`${kept}${ch}…`) <= LINE_BYTES ? `${kept}${ch}` : kept), "")}…`);

const sayOf = (fact) => FACTS.find((f) => f.fact === fact)?.say ?? "";

export const adviceText = (chosen, plugin, engine) => clipped(engined(`Orbit noticed ${chosen.fact} -- ${chosen.subject}: ${sayOf(chosen.fact)}. ${chosen.provider.id} handles it: ${invocationOf(chosen.provider, plugin)}.`, engine));

// ONE line, or null -- and when a line is said, `advice.given` is kept for it. A port that throws costs the line, never
// the payload it joins.
export const adviceLine = (event, world) => quietly(() => spoken(event, world));

function spoken(event, world) {
  const f = factsOf(event, world);
  if (!SILENCE.find((r) => r.when(f)).speaks) return null;
  const chosen = f.chosen();
  quietly(() => f.port().said({ fact: chosen.fact, subject: chosen.subject, provider: chosen.provider.id, kind: chosen.provider.kind }));
  return adviceText(chosen, world.plugin, world.engine);
}
