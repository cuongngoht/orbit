// What the orchestrator's rules READ off a task: its view (src/task/views.mjs, handed in) and its
// journal lines in order. Pure, and nothing here is kept: every answer is derived from the task's
// own record again on every read, so it can never disagree with what Mission Control shows.
//
// `lw` (the loop's world, src/orchestration/loop.mjs) carries `view` and `events` (each line with
// its position `n`), plus what the ports said this time: the declared checks, the workspace, the
// requirement's movement.
import { ACTION, PRODUCTION_KINDS } from "../protected/boundaries.mjs";
import { DOMAIN, PURPOSES } from "./vocab.mjs";

// A journal TYPE back to the action kind that wrote it: a check is recorded by its purpose, an
// invocation by what it asks -- and, once a person approved one that crosses a production boundary, by the protected
// kind it was approved as (src/protected/); every other kind is its own type.
const TYPE_KIND = { ...Object.fromEntries(PURPOSES.map((p) => [p, "check"])), "capability.invoke": "invoke", ...Object.fromEntries(PRODUCTION_KINDS.map((k) => [k, "invoke"])), [ACTION.PUSH]: "push" };

export const kindOf = (action) => TYPE_KIND[action?.type] ?? action?.type ?? null;

export const openActions = (lw) => lw.view.actions.filter((a) => a.state === "running");

export const openOf = (lw, kind) => openActions(lw).find((a) => kindOf(a) === kind) ?? null;

export const lastOf = (lw, kind) => lw.view.actions.filter((a) => kindOf(a) === kind).at(-1) ?? null;

const startedLine = (lw, id) => lw.events.find((e) => e.kind === "action-started" && e.id === id) ?? null;

export const positionOf = (lw, id) => startedLine(lw, id)?.n ?? -1;

// Where the code last changed: the position of the last `file-changed` line, or -1.
export const lastChange = (lw) => lw.events.filter((e) => e.kind === "file-changed").at(-1)?.n ?? -1;

export const changed = (lw) => lastChange(lw) >= 0;

// Where the code FIRST changed: before it, the workspace was the pinned base revision, and a check run
// there is a baseline. With no change yet, everything so far is before it.
export const firstChange = (lw) => lw.events.find((e) => e.kind === "file-changed")?.n ?? Infinity;

// The stage the task was in when line `n` was written.
export const stageAt = (lw, n) => lw.events.filter((e) => e.kind === "stage" && e.n < n).at(-1)?.stage ?? null;

// The receipt of a check's action: its word (succeeded, failed, failed-as-before, unstarted) and the source
// tree it ran on.
const receiptOf = (lw, a) => lw.view.receipts.find((r) => a.receipts?.includes(`${r.domain}:${r.ref}`) && r.domain === DOMAIN.CHECK) ?? null;

// Every check that ran: which declared command, for what purpose, how it came out, on which tree, where.
export const checkRuns = (lw) => lw.view.actions.filter((a) => kindOf(a) === "check").map((a) => ((r) => ({ id: a.id, purpose: a.type, command: a.tool, state: a.state, word: r?.outcome ?? null, tree: r?.sourceTree ?? null, at: positionOf(lw, a.id) }))(receiptOf(lw, a)));

// A BASELINE is a run on the pinned base revision itself: before the code first changed, AND on the very
// tree the base revision holds. A run on a workspace somebody edited without recording it is not one --
// otherwise a failure made on purpose before the change could be passed off as one that was already there.
// Nor is one that ran beside a file the tree leaves out because something ignores it (`unpinned`, kept with
// the run in the task's room).
export const pinned = (lw, run) => run.at < firstChange(lw) && Boolean(run.tree) && run.tree === (lw.baseTree?.() ?? null) && lw.unpinned?.(run) !== true;

export const blockedBy = (lw) => lw.view.blocked?.stop ?? null;

export const currentAttempt = (lw) => (lw.view.attempt.open ? lw.view.attempt.current : null);

export const lastAttempt = (lw) => lw.view.attempts.at(-1) ?? null;

// The fingerprints a person REJECTED in this task: never asked again.
export const rejectedFingerprints = (lw) => new Set(lw.view.approvals.filter((a) => a.state === "rejected").map((a) => requestedLine(lw, a.id)?.fingerprint).filter(Boolean));

const requestedLine = (lw, id) => lw.events.find((e) => e.kind === "approval-requested" && e.id === id) ?? null;

export const approvalOf = (lw, id) => lw.view.approvals.find((a) => a.id === id) ?? null;

export const fingerprintAsked = (lw, id) => requestedLine(lw, id)?.fingerprint ?? null;

// The linked receipts of one domain, newest last.
export const receiptsOf = (lw, domain) => lw.view.receipts.filter((r) => r.domain === domain);

// ---- what a task keeps of its sandbox ------------------------------------------------------------

// The one receipt a task's sandbox has, rewritten as it moves (receipts key on domain and ref).
export const sandboxReceipt = (lw) => receiptsOf(lw, DOMAIN.SANDBOX).at(-1) ?? null;

// The runtime sessions of that sandbox -- the receipts that name an environment, which a session
// of the developer's own checkout never does.
export const sandboxSessions = (lw) => receiptsOf(lw, DOMAIN.RUNTIME).filter((r) => r.environment);

// The source trees the world can name: the workspace's own, now, and the one the last
// `record-changes` read back. Lazy, because naming a tree asks git.
export const treeNow = (lw) => lw.tree?.() ?? { live: null, recorded: null };

// The commit this task last made in its own workspace (its full id), or null: what a push sends.
export const lastCommit = (lw) => receiptsOf(lw, DOMAIN.COMMIT).at(-1)?.ref ?? null;

// What the checkout declares a sandbox could start (component keys). Lazy: it asks understanding.
export const startableNow = (lw) => lw.startable?.() ?? [];

// Why a step that needs the task's workspace cannot run yet, or null.
export const workspaceProblem = (lw) => (lw.workspace?.ready ? null : "the task's workspace is not ready — prepare-workspace first");

// Every `start-sandbox` that ran, shaped like a check run: how it came out, and where.
export const startRuns = (lw) => lw.view.actions.filter((a) => kindOf(a) === "start-sandbox").map((a) => ({ id: a.id, purpose: "run", command: a.tool, state: a.state, at: positionOf(lw, a.id) }));
