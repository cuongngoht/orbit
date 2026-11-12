// WHO SETTLES a session's governed work, and the few lines the hooks say about it (0.5.0, B22 M3, ADR 0050).
//
// The follow-through a plugin has (design §2): one line at a session's start, one after an Agent call returns or an
// Orbit command fails, and a bounded hold at Stop. Each names the OWNER whose record settles the work -- a coordinated
// workflow, a goal, an engineering task, an investigation or a Satellite mission -- with that owner's own command, read
// off ONE table, so the four lines cannot name an owner four ways:
//
//   read        where it stands and what comes next: what the session runs to go on
//   reconcile   an action that never settled, read back from its owner -- never sent again
//   settle      (a workflow) a step the host ran, settled on the evidence its owner keeps
//
// A LEAF. Every line is built from table words and ids the composition root read off the owners' journals (an owner is
// `{ kind, id, lifecycle, ready, open, run }`), never from a prompt, a transcript or what an agent said; `<engine>` is
// the plugin root the root names, read by the one leaf (src/engined.mjs) before a line is clipped to its budget. A line a
// hook adds is a pointer to evidence, never evidence itself.
import { engined } from "../engined.mjs";

export const OWNERS = {
  workflow: { noun: "workflow", read: (id) => `node <engine>/cli/automation.mjs context ${id}`, reconcile: (id) => `node <engine>/cli/automation.mjs reconcile ${id}`, settle: (id) => `node <engine>/cli/automation.mjs settle ${id}` },
  goal: { noun: "goal", read: (id) => `node <engine>/cli/orbit.mjs goal resume ${id}`, reconcile: (id) => `node <engine>/cli/orbit.mjs goal resume ${id}` },
  task: { noun: "engineering task", read: (id) => `node <engine>/cli/autonomous-engineering.mjs context ${id}`, reconcile: (id) => `node <engine>/cli/autonomous-engineering.mjs reconcile ${id}` },
  investigation: { noun: "investigation", read: (id) => `node <engine>/cli/autonomous-qa.mjs context --investigation=${id}`, reconcile: (id) => `node <engine>/cli/autonomous-qa.mjs reconcile --investigation=${id}` },
  mission: { noun: "mission", read: (id) => `node <engine>/satellite/cli/satellite.mjs mission context ${id}`, reconcile: (id) => `node <engine>/satellite/cli/satellite.mjs mission reconcile ${id}`, report: (id, run) => `node <engine>/satellite/cli/satellite.mjs agent report ${id} ${run}` },
};

export const OWNER_KINDS = Object.keys(OWNERS);

// How many words of a list a line names before it counts the rest.
export const LIST_NAMED = 4;

// What a session-start line may cost the context, at most (design §5.10).
export const CAPABILITY_BYTES = 300;

const LINE_BYTES = 600;

const bytes = (text) => Buffer.byteLength(text);

// A line clipped to a byte budget on a character boundary, never mid-character.
export const clipped = (text, max) => (bytes(text) <= max ? text : `${[...text].reduce((kept, ch) => (bytes(`${kept}${ch}…`) <= max ? `${kept}${ch}` : kept), "")}…`);

export const named = (list) => `${list.slice(0, LIST_NAMED).join(", ")}${list.length > LIST_NAMED ? ` (+${list.length - LIST_NAMED})` : ""}`;

const ownerOf = (owner) => OWNERS[owner?.kind] ?? null;

const said = (owner) => `${ownerOf(owner).noun} ${owner.id} (${owner.lifecycle ?? "state unknown"})`;

const stepsSaid = (ready) => `${ready.length === 1 ? "step" : "steps"} ${named(ready)} ${ready.length === 1 ? "is" : "are"} ready`;

// ---- the session-start line: what Orbit can do here (families, usable counts, what a person switched off, STATUS) ----

const LABELS = { skills: "skills", agents: "agents", mcp: "MCP", tools: "CLI tools", capabilities: "capabilities" };

const countsOf = (summary) => (summary ?? []).filter((f) => f.total > 0).map((f) => `${LABELS[f.family] ?? f.family} ${f.available}/${f.total}`).join(" · ");

const offOf = (off, n) => (!off.length ? "" : n > 0 ? `; switched off: ${off.slice(0, n).join(", ")}${off.length > n ? ` (+${off.length - n})` : ""}` : `; ${off.length} switched off`);

const capabilityWith = (f, n) => `Orbit here: ${countsOf(f.summary) || "nothing"} usable${offOf(f.off ?? [], n)}; project STATUS ${f.status ?? "unknown"}.`;

// facts: { summary: summarize(effective), off: [ids a person switched off], status: the context's STATUS word }
export const capabilityLine = (facts) => ((lines) => lines.find((l) => bytes(l) <= CAPABILITY_BYTES) ?? clipped(lines.at(-1), CAPABILITY_BYTES))([LIST_NAMED, 2, 1, 0].map((n) => capabilityWith(facts ?? {}, n)));

// ---- a resumed session's open work, and its next step ---------------------------------------------------------------

const nextOf = (owner) => ((owner.ready ?? []).length ? `, next: ${named(owner.ready)}` : "");

export const openWorkLine = (owner, engine) => (ownerOf(owner) ? clipped(engined(`Orbit: this session's open work is ${said(owner)}${nextOf(owner)} -- ${ownerOf(owner).read(owner.id)} says where it stands.`, engine), LINE_BYTES) : null);

// ---- an Orbit command that failed under a governed work: the owner's one recovery row --------------------------------

export const recoveryRow = (owner, engine) => (ownerOf(owner) ? clipped(engined(`Orbit: this command ran under ${said(owner)}. An action that did not settle is read back with ${ownerOf(owner).reconcile(owner.id)} -- never sent again.`, engine), LINE_BYTES) : null);

// ---- after an Orbit agent returns: which owner record settles its work --------------------------------------------

// A mission settles a run by the report its agent hands in; a workflow with a step open settles that step; otherwise the
// owner's own read says where its work stands. The agent's words are its report, never the evidence.
const RETURNS = [
  { when: (o) => o.kind === "mission" && Boolean(o.run), how: (o) => `${OWNERS.mission.report(o.id, o.run)} hands in run ${o.run}'s report, and the mission judges it on its owners' records` },
  { when: (o) => o.kind === "workflow" && (o.open ?? []).length > 0, how: (o) => `${OWNERS.workflow.settle(o.id)} settles step ${named(o.open)} on the evidence its owner keeps` },
  { when: () => true, how: (o) => `${ownerOf(o).read(o.id)} says where its work stands` },
];

const howOf = (owner) => RETURNS.find((r) => r.when(owner)).how(owner);

export const returnLine = (agent, owner, engine, launched = false) => (ownerOf(owner) ? clipped(engined(`Orbit: ${agent} ${launched ? "was launched" : "returned"} -- what it says is its report, not evidence. Its work is settled by ${said(owner)}: ${howOf(owner)}.`, engine), LINE_BYTES) : null);

// ---- the Stop hold's reason ------------------------------------------------------------------------------------------

export const holdReason = (owner, count, max, engine) => (ownerOf(owner) ? clipped(engined(`Orbit holds this turn (${count} of ${max} for this prompt): ${said(owner)} is still running and ${stepsSaid(owner.ready ?? [])}. Take the next one -- ${ownerOf(owner).read(owner.id)} says how -- or say in one sentence why you stop here.`, engine), LINE_BYTES) : null);
