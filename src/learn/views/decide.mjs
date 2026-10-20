// What a person decided about a recommendation, written back onto the lesson that
// produced it.
//
// It lives on the lesson rather than in a table of its own because a
// recommendation has no existence apart from the lesson that justifies it -- it is
// recomputed from that lesson every time. The DECISION is the only part worth
// keeping, and keeping it next to its reason means neither can be read without
// the other.
//
// `rejected` records the session count at the time, which is what lets a rejected
// recommendation come back on strictly more evidence and not before. Anything
// looser and "no" would mean "ask again next week".
import { out } from "../../query/format.mjs";
import { Refused } from "../../errors.mjs";
import { flag, words } from "../args.mjs";
import { quote } from "../../quote.mjs";
import { ranked } from "../recommend.mjs";

const SAYS = {
  accepted: "  it stays in the list until you mark it applied.",
  rejected: "  it will not be suggested again until strictly more independent sessions support it.",
  applied: "  from now on `learn analyse` compares the runs before and after this, and says what it finds.",
};

export const accept = (ctx, args) => decide(ctx, args, "accepted");

export const reject = (ctx, args) => decide(ctx, args, "rejected");

export const applied = (ctx, args) => decide(ctx, args, "applied");

function decide(ctx, args, state) {
  const [id] = words(args);
  const rec = ranked(ctx.learn.all()).find((r) => r.id === id) ?? any(ctx, id);
  if (!rec) throw new Refused(`no recommendation "${id}" — \`learn why <lesson id>\` prints them with their ids`);
  record(ctx, rec, state, args);
  said(rec, state);
}

const any = (ctx, id) => ctx.learn.all().flatMap((l) => (l.decisions ?? []).filter((d) => d.rec === id).map(() => ({ id, lesson: l.id, sessions: l.sessions }))).at(0) ?? null;

function record(ctx, rec, state, args) {
  const lesson = ctx.learn.find(rec.lesson);
  const decision = { rec: rec.id, state, at: nowOf(ctx), by: ctx.learn.host, why: flag(args, "because") ? quote(flag(args, "because"), 200) : null, sessionsAt: rec.sessions ?? 0, commit: flag(args, "commit") ?? null };
  ctx.learn.save({ ...lesson, decisions: [...(lesson.decisions ?? []), decision] });
}

const nowOf = (ctx) => new Date(ctx.now?.() ?? Date.now()).toISOString();

function said(rec, state) {
  out(`${state}: ${rec.id}`);
  out(SAYS[state]);
}
