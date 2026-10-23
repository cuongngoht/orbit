// The WORLD one look at a mission sees: its journal, the model folded from it, and an `append` that writes a line
// AND folds it into the same model -- so everything decided later in one step sees what was written earlier in it.
// Built inside the mission's lock whenever it will write, so it always holds the latest line.
import { Refused } from "../../../src/errors.mjs";
import { concurrencyOf } from "../hosts/matrix.mjs";
import { createJournal } from "../store/journal.mjs";
import { missionDirOf } from "../store/rooms.mjs";
import { refused } from "../store/text.mjs";
import { foldInto, modelOf } from "./fold.mjs";
import { spentOf, unitStates } from "./state.mjs";
import { FREE_TEXT, KINDS, MISSION_SCHEMA } from "./vocab.mjs";

const BUSY = "another session is writing this mission — try again in a moment";

export const journalOf = (ports, id) => createJournal(ports.io, missionDirOf(ports.rooms, id), { kinds: KINDS, freeText: FREE_TEXT, noun: "mission", busy: BUSY });

const unknown = (id) => refused(Refused, "MISSION_UNKNOWN", `no mission ${id} in this project's store`);

function readable(m, id) {
  if (!m.meta) throw refused(Refused, "MISSION_UNREADABLE", `${id}'s journal does not begin with mission.created; it is kept unchanged`);
  if (m.meta.schema > MISSION_SCHEMA) throw refused(Refused, "NEWER_MISSION", `${id} was written by a newer Satellite (schema ${m.meta.schema}); it is kept unchanged`);
}

const lower = (a, b) => (a === null || a === undefined ? b : b === null || b === undefined ? a : Math.min(a, b));

// The limits a mission works within NOW: what it was created with, narrowed by whatever a person tightened since.
export const limitsOf = (ports, m) => ((b, p, v) => ({ maxAttempts: lower(b.attempts, v.execution.maxAttempts), maxActions: lower(b.actions, v.execution.maxActions), maxMinutes: lower(b.minutes, v.execution.maxMinutes), maxReplans: lower(b.replans, v.execution.maxReplans), maxAgentRuns: lower(b.agentRuns, p.maxAgentRuns), maxConcurrency: lower(b.concurrency, concurrencyOf(ports.hostRow, p.maxConcurrency)), maxDepth: lower(b.depth, p.maxDepth), maxGeneratedDefinitions: lower(b.generated, p.maxGeneratedDefinitions), maxUnits: lower(b.units, Math.min(p.maxUnits, v.execution.maxPlanSteps)), maxHandoffs: lower(b.handoffs, p.maxHandoffs) }))(m.meta?.budget ?? {}, ports.policy.limits, ports.limits.values);

// The budget a mission is created with: Orbit's own limits (a person's) and Satellite's policy, never wider.
export const budgetOf = (ports) => ((p, v) => ({ attempts: v.execution.maxAttempts, actions: v.execution.maxActions, minutes: v.execution.maxMinutes ?? null, replans: v.execution.maxReplans, agentRuns: p.maxAgentRuns, concurrency: concurrencyOf(ports.hostRow, p.maxConcurrency), depth: p.maxDepth, generated: p.maxGeneratedDefinitions, units: Math.min(p.maxUnits, v.execution.maxPlanSteps), handoffs: p.maxHandoffs }))(ports.policy.limits, ports.limits.values);

function worldFrom(ports, id, journal, m) {
  readable(m, id);
  const lw = { id, ports, journal, m, action: null, limits: limitsOf(ports, m), spent: () => spentOf(m, ports.nowMs()), states: () => unitStates(m) };
  lw.append = (kind, record) => appendedTo(lw, kind, record);
  return lw;
}

function appendedTo(lw, kind, record) {
  const line = lw.journal.append(kind, record);
  foldInto(lw.m, line);
  return line;
}

export function worldOf(ports, id) {
  const journal = journalOf(ports, id);
  const records = journal.read();
  if (records === null) throw unknown(id);
  return worldFrom(ports, id, journal, modelOf(records));
}

// One writer at a time: the world is built INSIDE the lock, so what it judges is what is on disk.
export const locked = (ports, id, fn) => journalOf(ports, id).transact(() => fn(worldOf(ports, id)));
