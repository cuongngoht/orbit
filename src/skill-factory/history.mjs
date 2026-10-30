// A declared playbook's HISTORY (0.0.4): every run the project's coordinated workflows carried of it, as records a
// review reads (review.mjs) -- derived on every look from what a composition root hands in: each coordinator task's
// view and journal lines, the live core's one reading of a run off them (src/live/plan.mjs skillRunsOf), and the
// projection of each pinned workflow. Pure: nothing here reads a task, a journal or a file, and nothing is kept.
//
//   historyOf({ id, tasks: [{ view, events, session }], skillRunsOf, projectionOf }) -> [run record], newest first
//     record: { task, run, pin, word, at, session, host, steps: [{ id, word, block, required, calls, retries, waiting, bound, providers }] }
//     `host` (0.3.0) is the machine the task ran on, and `block` the reason word a step that could not run starts its
//     receipt with (skill-run-vocab.mjs BLOCKS) -- what an improvement campaign tells an environment from a definition by
const receiptLines = (events, domain) => events.filter((e) => e.kind === "receipt" && e.domain === domain);

// The provider a step was bound to when it started, and every provider its calls went through.
const providersOf = (events, ref) => ({ bound: receiptLines(events, "skillstep").filter((e) => e.ref === ref && e.providerKey).at(-1)?.providerKey ?? null, providers: [...new Set(receiptLines(events, "invocation").filter((e) => e.ref.startsWith(`${ref}.`) && e.providerKey).map((e) => e.providerKey))] });

const blockOf = (because) => /^([A-Z][A-Z_]{2,}):/.exec(String(because ?? ""))?.[1] ?? null;

const stepRecord = (events, run) => (s) => ({ id: s.id, word: s.word, block: blockOf(s.because), required: s.required, calls: s.calls, retries: s.retries, waiting: s.waiting, ...providersOf(events, `${run}.${s.id}`) });

const recordOf = (t) => (r) => ({ task: t.view.task.id, run: r.run, pin: r.pin, word: r.word, at: r.at, session: t.session ?? null, host: t.view.task.host ?? null, steps: r.steps.map(stepRecord(t.events, r.run)) });

const mine = (id) => (r) => String(r.pin ?? "").startsWith(`${id}:`);

// The pinned workflow of each of this skill's runs in a task, as its projection: what the run's steps are read against.
const pinnedOf = (view, id, projectionOf) => Object.fromEntries((view.receipts ?? []).filter((r) => r.domain === "skillrun").filter(mine(id)).map((r) => [r.pin, projectionOf(r.pin)]).filter(([, v]) => v));

const runsIn = (x) => (t) => x.skillRunsOf(null, t.view, t.events, pinnedOf(t.view, x.id, x.projectionOf)).filter(mine(x.id)).map(recordOf(t));

export const historyOf = (x) => x.tasks.flatMap(runsIn(x)).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
