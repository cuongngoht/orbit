// Anything that CHANGES data owes the same five sentences, whether it creates,
// updates, deletes or moves a status along.
//
// The engine's own case rule only ever asked this of `creates`, because that is
// the field a case declares. An update that writes the wrong row and a delete
// that removes two are the same class of bug, and neither one declares
// `creates` -- so the obligation is stated here, over what the SCENARIO says it
// changes, and the witness layers come from the verb table exactly as they do
// for a case: a screen can show a write that never reached the database.
import { LAYERS } from "../../dsl/verbs.mjs";
import { WITNESSES, isRequired, needOf } from "../commit.mjs";
import { advice, error } from "../finding.mjs";
import { MUTATION, mutationsWhere } from "../vocab.mjs";
import { at, filled, listed, needs, scenariosOf } from "./common.mjs";

const WRITES = mutationsWhere("writes");

// The sentences a change owes, as a table: the next one is a row.
const STATE = { before: "the state before", action: "the action", after: "the state after", onRefusal: "what happens when it is refused or fails part way" };
const LIFECYCLE = { data: "where the data comes from (per-run, fixture, existing, none)", cleanup: "how it is put back", onFailure: "what is left behind when it stops half way" };

export const mutationFindings = (p, world) => scenariosOf(p).flatMap((s) => oneScenario(p, s, world));

function oneScenario(p, s, world) {
  if (!WRITES.has(s.mutation?.kind)) return [...asyncFindings(p, s), ...effectFindings(p, s, world)];
  const owed = [...stateFindings(p, s), ...lifecycleFindings(p, s), ...witnessFindings(p, s)];
  return [...owed, ...asyncFindings(p, s), ...effectFindings(p, s, world)];
}

function stateFindings(p, s) {
  const missing = needs(s.mutation, STATE, (say) => error(at(p, s), `${MUTATION.get(s.mutation.kind).name} scenario does not say ${say}`));
  const unchanged = listed(s.mutation.unchanged) ? [] : [error(at(p, s), "does not say what must be UNCHANGED — the half people forget, and where a scoping bug is caught")];
  return [...missing, ...unchanged];
}

// Data that is not this scenario's own is data another scenario can change
// underneath it, and the failure looks like a product bug on whichever one runs
// second. SQL here is read-only by design, so cleanup is a UI action, a fixture
// reset or a person -- never a written statement.
function lifecycleFindings(p, s) {
  const missing = needs(s.data, LIFECYCLE, (say) => error(at(p, s), `changes data but does not say ${say}`));
  const keyed = s.data?.data === "existing" || filled(s.data?.key) || filled(s.data?.record);
  return [...missing, ...(keyed ? [] : [error(at(p, s), "names no business key or record id — nothing identifies the row this scenario is about")])];
}

// The obligation the case rule derives for `creates`, applied to every kind of
// change: at least one layer BELOW the screen has to answer, or the scenario has
// to say, layer by layer, why none can.
function witnessFindings(p, s) {
  const silent = WITNESSES.filter((l) => !needOf(s.expect?.[l]));
  const witnessed = WITNESSES.some((l) => isRequired(s.expect?.[l]));
  if (silent.length) return silent.map((l) => error(at(p, s), `changes data and says nothing about ${l} — required, n-a or unverifiable, with a reason`));
  return witnessed ? [] : [advice(at(p, s), `changes data and no layer below the screen rules on it — every witness is n-a or unverifiable, so this scenario proves the screen only`)];
}

// Work that finishes after the response. The deadline is the number a team tunes
// until the test goes green, so it owes a source; and "the page reloaded" is not
// a commit, which is why what is OBSERVED is a list of layers rather than prose.
function asyncFindings(p, s) {
  if (!s.async) return [];
  const said = needs(s.async, { complete: "what counts as finished, in business terms" }, (say) => error(at(p, s), `is asynchronous but does not say ${say}`));
  const watched = listed(s.async.observe) ? [] : [error(at(p, s), `is asynchronous but names no layer to watch for completion — one of ${LAYERS.join(", ")}`)];
  return [...said, ...watched, ...deadlineFindings(p, s), ...reloadFindings(p, s)];
}

const deadlineFindings = (p, s) => (s.async.deadline === undefined || filled(s.async.because) ? [] : [error(at(p, s), `waits ${s.async.deadline}s for completion with no reason given — a deadline with no source is tuned until the test passes`)]);

function reloadFindings(p, s) {
  const below = (s.async.observe ?? []).filter((l) => WITNESSES.includes(l));
  if (below.length || !WRITES.has(s.mutation?.kind)) return [];
  return [error(at(p, s), `watches only the screen for completion. A reload shows what the screen was served; it does not show that ${WITNESSES.join(" or ")} ever committed`)];
}

// The map already recorded what a control does below the UI. A plan that cites
// the edge gets that for free -- and a plan citing an edge the map does not have
// is pointing at a control nobody has recorded.
function effectFindings(p, s, world) {
  const on = s.mutation?.effect;
  if (!filled(on) || !world?.graph) return [];
  if (!world.graph.edgeOn.has(on)) return [error(at(p, s), `mutation.effect names ${on}, which is not a control in the map — record it first, or correct the key`)];
  return world.graph.effectOn.has(on) ? [] : [advice(at(p, s), `mutation.effect names ${on}, which the map has no effect record for — a run touching it can report the UI only`)];
}
