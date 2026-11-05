// The learning fold and the session-start recall -- the behaviour
// cli/learn-hook.mjs had before the dispatcher existed, moved here unchanged.
//
// session-start   a bounded index of lessons, one line about architecture and
//                 one about engineering memory. Reads only; never scans, never
//                 writes, never discovers host memory.
// post-tool       a case just finished: fold it in (`learn analyse`).
// post-tool-failure
//                 hands back the commands that turn an exit code into evidence,
//                 and WRITES NOTHING: the host cannot tell a command that could
//                 not start from a run whose product misbehaved (`run-case` exits
//                 1 for FAIL on purpose), and the run already recorded itself.
// pre-tool        whatever the host adapter says (Antigravity answers with a
//                 permission decision; Claude Code with nothing).
//
// What a host's JSON looks like is the adapter's business: this asks
// `world.host` to format and to recognise a watched command, and never reads
// the host's fields itself.
//
// 0.5.0 (B22 M3, ADR 0050) -- two more lines, JOINED into the one payload this
// subscriber answers, because the dispatcher hears only the first answer:
//
// session-start   FIRST, one capability line of at most 300 bytes: what Orbit can
//                 do here (each family's usable count of all, what a person
//                 switched off) and the project's STATUS word -- and on a session
//                 that picks up a conversation (`resumed`: resume or compact),
//                 this session's open work and its next step. `world.digest`
//                 composes them (cli/learn-hook.mjs); a digest that cannot be read
//                 costs its own lines and nothing else
// post-tool-failure
//                 when an Orbit command failed while this session holds governed
//                 work, the owner's ONE recovery row -- an action that did not
//                 settle is read back with `reconcile`, never resent -- after the
//                 diagnosis a watched command gets (`world.recovery`)
import { architecturePaths, createArchitecture } from "../../architecture/store.mjs";
import { createEngineering } from "../../engineering/store.mjs";
import { indexText } from "../../learn/recall.mjs";
import { runLearn } from "../../learn/index.mjs";
import { capabilityLine, openWorkLine, recoveryRow } from "../owners.mjs";

export const WATCHED = ["run-case.mjs", "run-awake.mjs", "review.mjs", "note.mjs"];

const DIAGNOSE = [
  "A orbit command exited non-zero, and the exit code is itself the answer:",
  "1 FAIL (the product) · 2 REFUSED (usage or a precondition) · 3 BLOCKED (environment or a spent budget — never a defect) · 4 INCONCLUSIVE (nothing ruled on the product).",
  "A non-zero exit is not by itself a product defect, and the run has already recorded its own verdict in the ledger — do not record it again.",
  "To turn it into evidence: `query.mjs triage` for what this run shows, may be, and cannot tell; `query.mjs doctor` for whether the tooling is usable here; `learn.mjs recall <case>` for whether it has happened before.",
].join(" ");

const HANDLERS = {
  "session-start": sessionStart,
  "pre-tool": (event, world) => world.host.formatPreTool(world.input),
  "post-tool": afterTool,
  "post-tool-failure": afterFailure,
};

export const learning = { name: "learning", on: Object.keys(HANDLERS), records: false, run: (event, world) => HANDLERS[event.event](event, world) };

function sessionStart(event, world) {
  const ctx = world.light();
  if (!ctx) return null;
  return world.host.formatSessionStart([...digestOf(event, world), sessionText(ctx)].filter(Boolean).join("\n\n"), world.input);
}

// The session's digest (0.5.0): the capability line, then -- on a resumed session -- its open work. Each part is null
// when the composition root could not read it, and is then simply not said.
const digestOf = (event, world) => ((d) => [d?.capabilities ? capabilityLine(d.capabilities) : null, event.resumed === true && d?.owner ? openWorkLine(d.owner, world.engine) : null])(world.digest?.(event) ?? null);

function sessionText(ctx) {
  const lessons = indexText(ctx.learn.all(), { project: ctx.config.name });
  const facts = createArchitecture(ctx.store.root, ctx.io).all();
  const architecture = facts.length ? `Orbit architecture: ${facts.length} stored facts; use architecture ensure --dry, facts and why before scanning source.` : missingSnapshot(ctx);
  return [lessons, architecture, engineeringLine(ctx)].filter(Boolean).join("\n\n");
}

function missingSnapshot(ctx) {
  if (!ctx.io.exists(ctx.project.graphDir)) return "";
  const there = ctx.io.exists(architecturePaths(ctx.store.root).model);
  return there ? "" : "No architecture snapshot exists for this project yet. `node <plugin>/cli/architecture.mjs ensure` reads it once, and every session after this one reuses that instead of scanning the repository.";
}

// Bounded on purpose: a count and a pointer, never the facts themselves. The
// facts that bear on a task are `engineering recall --for=…`'s to choose.
function engineeringLine(ctx) {
  const all = createEngineering(ctx.store.root, ctx.io).all();
  if (!all.length) return "";
  const by = (k, v) => all.filter((f) => f[k] === v).length;
  return `Orbit engineering memory: ${all.length} fact(s) — ${by("strength", "enforced")} enforced · ${by("strength", "adopted")} adopted · ${by("status", "stale")} stale; use engineering recall --for="<the task>" before assuming how this project builds code.`;
}

function afterTool(event, world) {
  if (!world.host.isWatched(world.input, WATCHED)) return null;
  analysed(world.full());
  return world.host.formatPostTool(null, world.input);
}

function analysed(ctx) {
  if (!ctx || !ctx.learn.auto().on) return;
  runLearn(ctx, "analyse", ["--quiet"]);
}

// ONE payload: the diagnosis a watched command gets, then the governing owner's recovery row (0.5.0).
function afterFailure(event, world) {
  const lines = [world.host.isWatched(world.input, WATCHED) ? DIAGNOSE : null, recoveryOf(event, world)].filter(Boolean);
  return lines.length ? world.host.formatFailure(lines.join("\n"), world.input) : null;
}

const recoveryOf = (event, world) => ((owner) => (owner ? recoveryRow(owner, world.engine) : null))(world.recovery?.(event) ?? null);
