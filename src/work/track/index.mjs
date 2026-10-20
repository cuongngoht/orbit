// The commands of UNIFIED WORK TRACKING (1.8.8): follow one request from /orbit-help to what it came to, whoever does it.
// A command table, every other subsystem's shape:
//
//   writes   `nothing`, or `store` (this project's machine store -- never a repository)
//   needs    `store` (the work room and the session), or `view` (that, and the session's working set and the linked tasks,
//            so what was OBSERVED can be read back)
//
// `run` answers with DATA and `say` puts it in words. Tracking adds identity, links and a reported lifecycle to the work
// journal, and nothing else: it turns no Automation on, creates no task or sandbox, grants nothing and runs no workflow.
import { Refused } from "../../errors.mjs";
import { flag, has, words } from "../../learn/args.mjs";
import { ID_SPEC } from "../store.mjs";
import { coverageOf, limitsOf } from "./coverage.mjs";
import { currentOf, listOf, scanOf } from "./resolve.mjs";
import { readView } from "./read.mjs";
import { coverageText, listText, viewText } from "./say.mjs";
import { handoff, link, report, state, track } from "./write.mjs";

const many = (args, name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));

const WORK = new RegExp(ID_SPEC.pattern);

// The work a command is about: the one named first (a w- id), else the session's own current work.
function workOf(ctx, args) {
  const named = words(args)[0];
  if (named !== undefined && !WORK.test(named)) refuse("name the work by its id: w- followed by twelve hex characters (or leave it out for this session's current work)");
  return named ?? currentOf(scanOf(ctx.works), ctx.session, ctx.checkout)?.id ?? null;
}

const refuse = (why) => {
  throw new Refused(why);
};

const needed = (ctx, args) => workOf(ctx, args) ?? refuse("no work is tracked for this session: name one (a w- id) or track the request first");

// ---- track ---------------------------------------------------------------------------------------------

const specOf = (args) => ({ objective: words(args).join(" "), ref: flag(args, "ref"), continue: flag(args, "continue"), route: flag(args, "route"), because: flag(args, "because"), skill: flag(args, "skill"), mode: flag(args, "mode"), eid: flag(args, "eid") });

const sayTracked = (r) => (r.tracked ? [`WORK       ${r.work} ${r.created ? "tracked (new)" : r.reopened ? "continued (reopened)" : "tracked"} · ${r.mode}${r.route ? ` · routed to ${r.route}` : ""}`, ...r.warnings.map((w) => `NOTE       ${w}`)] : ["WORK       not tracked", ...r.warnings.map((w) => `NOTE       ${w}`)]).join("\n");

// ---- status, current, list, coverage --------------------------------------------------------------------

const status = (ctx, args) => ((id) => (id ? { tracked: true, ...readView(ctx, id) } : { tracked: false, work: null, warnings: ["no work is tracked for this session"] }))(workOf(ctx, args));

const sayStatus = (r) => (r.tracked ? viewText(r) : `WORK       none tracked for this session\nNOTE       ${r.warnings[0]}`);

const current = (ctx) => ((c) => (c ? { tracked: true, work: c.id, title: c.fold.meta?.objective ?? null, mode: c.fold.handoffs.at(-1)?.to ?? c.fold.bindings.at(-1)?.mode ?? "developer", since: c.at } : { tracked: false, work: null }))(currentOf(scanOf(ctx.works), ctx.session, ctx.checkout));

const sayCurrent = (r) => (r.tracked ? `WORK       ${r.work} — ${r.title ?? ""} · ${r.mode}` : "WORK       none tracked for this session");

const list = (ctx) => ({ works: listOf(scanOf(ctx.works), ctx.checkout) });

const coverage = (ctx, args) => ((c) => ({ coverage: { ...c, limits: limitsOf(c, ctx.workingSet?.source ?? "ok") } }))(coverageOf(flag(args, "host") ?? ctx.host ?? null));

// ---- the moments ----------------------------------------------------------------------------------------

const linkSpec = (ctx, args) => ((pairs) => ({ work: needed(ctx, args), what: pairs[0]?.[0], target: pairs[0]?.[1], role: flag(args, "role"), eid: flag(args, "eid"), extra: pairs.length }))(["task", "workflow", "investigation"].map((w) => [w, flag(args, w)]).filter(([, v]) => v !== undefined));

const oneLink = (spec) => (spec.extra === 1 ? spec : refuse("link names exactly one thing: --task=tsk-…, --workflow=tsk-… or --investigation=inv-…"));

const linkRun = (ctx, args) => link(ctx, oneLink(linkSpec(ctx, args)));

const handoffRun = (ctx, args) => handoff(ctx, { work: needed(ctx, args), to: flag(args, "to"), task: flag(args, "task"), what: flag(args, "workflow") ? "workflow" : "task", because: flag(args, "because"), eid: flag(args, "eid") });

const stateRun = (ctx, args) => state(ctx, { work: needed(ctx, args), state: flag(args, "state"), wait: flag(args, "wait"), why: flag(args, "why"), occurred: flag(args, "occurred"), reopen: has(args, "reopen"), eid: flag(args, "eid") });

const reportRun = (ctx, args) => report(ctx, { work: needed(ctx, args), outcome: flag(args, "outcome"), summary: flag(args, "summary"), proved: many(args, "proved"), unverified: many(args, "unverified"), blocked: many(args, "blocked"), evidence: many(args, "evidence"), eid: flag(args, "eid") });

const sayChange = (r) => `WORK       ${r.work} ${r.changed ? "updated" : `unchanged — ${r.because}`}${r.what ? ` · ${r.what} ${r.target}` : ""}${r.to ? ` · ${r.from} → ${r.to}` : ""}${r.state ? ` · ${r.state}${r.wait ? ` (${r.wait})` : ""}` : ""}${r.outcome ? ` · reported ${r.outcome}` : ""}`;

export const COMMANDS = {
  track: { run: (ctx, args) => track(ctx, specOf(args)), say: sayTracked, writes: "store", needs: "store" },
  status: { run: status, say: sayStatus, writes: "nothing", needs: "view" },
  current: { run: current, say: sayCurrent, writes: "nothing", needs: "store" },
  link: { run: linkRun, say: sayChange, writes: "store", needs: "store" },
  handoff: { run: handoffRun, say: sayChange, writes: "store", needs: "store" },
  state: { run: stateRun, say: sayChange, writes: "store", needs: "store" },
  report: { run: reportRun, say: sayChange, writes: "store", needs: "view" },
  list: { run: list, say: listText, writes: "nothing", needs: "store" },
  coverage: { run: coverage, say: (r) => coverageText(r), writes: "nothing", needs: "store" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
