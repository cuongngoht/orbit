// `learn remember` and `learn forget` -- the two places a PERSON changes what the
// tool thinks.
//
// `remember` writes a `said` lesson. It enters validated because somebody said
// so, it is labelled as an instruction everywhere it appears, it is never
// promoted into an inference, and no recommendation may cite it as evidence. The
// same command with `--id=` is how a lesson is CORRECTED: a correction that is not
// an upsert is just a duplicate with newer wording.
//
// `forget` is the one operation that destroys something, so it is the one that
// has to be careful. In order: fingerprint it while it still exists, write the
// tombstone, delete the file and its backup, then re-project -- because a lesson
// left behind in Claude Code's memory directory would keep being read into every
// new session long after it was forgotten here.
import { out } from "../../query/format.mjs";
import { Refused } from "../../errors.mjs";
import { flag, has, words } from "../args.mjs";
import { makeLesson } from "../lesson.mjs";
import { quote } from "../../quote.mjs";
import { tombstoneFor } from "../forget.mjs";

export function remember(ctx, args) {
  const [about, statement] = words(args);
  if (!about || !statement) throw new Refused('learn remember <about> "<what you want remembered>" [--not="<when it does not apply>"] [--id=<id>]');
  const lesson = dictated(ctx, about, statement, args);
  ctx.learn.save(lesson);
  told(lesson);
}

// Through `quote()` like any other text that did not come from a template: a
// person can type a backtick or a heading marker, and this file has to survive it.
function dictated(ctx, about, statement, args) {
  const notWhen = flag(args, "not");
  const fields = { kind: "said", family: "notes", topic: "orbit-ui-feedback", about, key: quote(statement, 60), statement: quote(statement, 300), applies: [`anything touching ${about}`], notWhen: notWhen ? [quote(notWhen)] : [], state: "validated" };
  return makeLesson({ ...fields, ...carried(ctx, args), ...confirmed(ctx) }, { host: ctx.learn.host });
}

const carried = (ctx, args) => (flag(args, "id") ? { id: flag(args, "id") } : {});

const confirmed = (ctx) => ({ because: `a person said so on ${today(ctx)} — an instruction, not an inference`, sessions: 0, firstSeen: nowOf(ctx), confirmed: nowOf(ctx), fe_commit: ctx.frontend.commit(), evidence: { sessions: [], runs: [], notes: [], missing: ["nothing was measured — this is something a person asserted"] } });

const nowOf = (ctx) => new Date(ctx.now?.() ?? Date.now()).toISOString();

const today = (ctx) => nowOf(ctx).slice(0, 10);

function told(lesson) {
  out(`remembered: ${lesson.id}`);
  out("  said     a person said so — an instruction, not an inference");
  out(`  applies  ${lesson.applies.join(" · ")}`);
  if (lesson.notWhen.length) out(`  not when ${lesson.notWhen.join(" · ")}`);
  out("  It will never be promoted into an inference, and no recommendation may cite it as evidence.");
}

export function forget(ctx, args) {
  const [id, reason] = words(args);
  const lesson = ctx.learn.find(id);
  if (!lesson) throw new Refused(`no lesson "${id}" — \`learn lessons\` lists them`);
  buried(ctx, lesson, reason, args);
  gone(ctx, lesson, args);
}

function buried(ctx, lesson, reason, args) {
  const scope = has(args, "forever") ? "always" : "evidence";
  ctx.learn.addTombstone(tombstoneFor(lesson, { scope, why: reason ? quote(reason, 120) : null }));
  ctx.learn.remove(lesson.id);
}

function gone(ctx, lesson, args) {
  out(`forgotten: ${lesson.id}`);
  out("  the lesson file is deleted, and no backup of it was kept");
  out(`  a tombstone remains: the subject, a one-way hash of the claim, and the dates. Not one word of what it said.`);
  out(has(args, "forever") ? "  analyse will not derive it again, whatever happens." : "  analyse will not derive it again from the history it already knows. New runs can bring it back, and it will say so.");
  reproject(ctx);
}

// Otherwise it stays in Claude Code's memory directory and keeps being read into
// every new session, which is the opposite of forgetting it.
function reproject(ctx) {
  if (!ctx.reproject) return;
  const done = ctx.reproject();
  out(done.done ? `  removed from ${done.dir} too` : `  not in Claude Code's memory — ${done.why}`);
}
