// WHAT A SHIP SAYS, in words for a person and as JSON for a pipeline -- the result of a ship, where one stands, and
// whether what it qualified may be published. Every number a host reported is said as reported; a delivery that waits
// for a person says the exact commands, and says that nothing was pushed.
//
//   saidResult(r) -> text      saidStatus(s) -> text      saidEvidence(e) -> text      saidOptional(rows) -> [text]
const WORDS = { SHIPPABLE: "SHIPPABLE", NOT_SHIPPABLE: "NOT SHIPPABLE", BLOCKED: "BLOCKED", BUDGET_EXHAUSTED: "BUDGET EXHAUSTED", NO_PROGRESS: "NO PROGRESS", REFUSED: "REFUSED", PAUSED: "PAUSED", CANCELLED: "CANCELLED", PRECHECK_HELD: "PRECHECK HELD", PRECHECK_FAILED: "PRECHECK FAILED" };

const deliveryLines = (d) => (d?.patch ? [`  delivery  the qualified source holds repairs this ship integrated in its own workspace -- nothing was pushed or`, `            written into your checkout. Apply them yourself: git am ${d.patch}`, `            (or: git fetch ${d.bundle} HEAD), then node skills/orbit-release/ship.mjs --evidence says whether it is publishable`] : []);

export const saidOptional = (rows) => rows.map((r) => `  optional  ${r.name}: ${r.ok ? "held" : "not held"} -- ${r.detail} (not required to ship)`);

// A recorded row (ADR 0051): held or not, with its run's room -- recorded by a release, never required by it.
export const saidRecorded = (rows) => rows.map((r) => `  recorded  ${r.id}: ${r.held ? "held" : `not held (${r.state})`}${r.runsAgain ? ", runs again" : ""} -- ${r.room ?? "no run"} (recorded, not required)`);

export const saidResult = (r) => [`RESULT    ${WORDS[r.outcome] ?? r.outcome} -- ${r.summary}`, `  ship      ${r.ship} (task ${r.task}: node cli/task.mjs show ${r.task}; Orbit Live and Mission Control show it)`, `  room      ${r.room}`, ...(r.evidence ? [`  evidence  ${r.evidence}`] : []), ...deliveryLines(r.delivery), ...(r.exit === 3 ? [`  resume    node skills/orbit-release/ship.mjs --resume=${r.ship} (once what blocked it is fixed)`] : []), ...(r.failures ?? []).flatMap(saidDiagnosis), ...saidRecorded(r.recorded ?? []), ...(r.optional ? saidOptional(r.optional) : [])].join("\n");

// ---- a failed model-carried row's diagnosis bundle, as its run's own report says it (0.5.0, B6) ----------------------

const said = (v) => (v === null || v === undefined || v === "" ? "unknown" : v);

const finishSaid = (f) => `    finish  round ${said(f.round)}: ${f.reason}${f.turns === null ? "" : `, ${f.turns} turns`}${f.toolCalls === null ? "" : `, ${f.toolCalls} tool calls`}${f.error ? ` -- ${f.error}` : ""}`;

const budgetSaid = (b) => `    budget  ${said(b.usd.used)} of ${said(b.usd.cap)} USD (reported), ${said(b.minutes.used)} of ${said(b.minutes.cap)} minutes, ${b.rounds.used} of ${said(b.rounds.cap)} round(s)`;

const relaySaid = (r) => (r ? [`    relay   ${r.requests} request(s), ${r.refused} refused, ${r.stopped} stopped by the engine`, ...r.refusals.map((x) => `            refused \`${said(x.sub)}\`: ${said(x.why)}`), ...r.stops.map((x) => `            stopped \`${said(x.sub)}\` (exit ${said(x.exit)}): ${said(x.why)}`)] : []);

const stoppedSaid = (x) => `    stopped step ${said(x.step)} ${said(x.do)} ${said(x.capability)} ${said(x.as)} (${said(x.outcome)} ${said(x.rule)}): ${said(x.says)}`;

const bundleSaid = (d) => (d ? [...d.finish.map(finishSaid), budgetSaid(d.budget), ...relaySaid(d.relay), ...(d.stopped ?? []).map(stoppedSaid)] : ["            its run's report says no diagnosis"]);

export const saidDiagnosis = (d) => [`  diagnose  ${d.row} ${d.state} -- ${d.says}`, `    room    ${d.room ?? "none: the run never began"}`, ...bundleSaid(d.diagnosis)];

// Runs whose cost nobody can know -- a restart interrupted them -- said beside what was spent, never added into it.
const unknownSaid = (spent) => (spent.unknown ? `; and ${spent.unknown} run(s) a restart interrupted, whose cost is unknown (never charged at their cap)` : "");

// Which cycle a ship's rows are said of: the open one, or -- for a ship whose cycle closed -- the newest it ran.
const cycleSaid = (s) => (s.cycleOpen ? "this cycle" : s.cycle > 0 ? `in cycle ${s.cycle}, which closed` : "(no cycle has run)");

export const saidStatus = (s) => (!s.found ? s.says : [`SHIP      ${s.ship} -- ${s.lifecycle}${s.stage ? ` · ${s.stage}` : ""} (${s.mode}), task ${s.task}`, `  from      ${s.start.branch ?? "detached"}@${s.start.commit.slice(0, 12)}; release commit now ${s.commit.slice(0, 12)}; cycle ${s.cycle}`, `  rows      ${s.rows.held}/${s.rows.total} held ${cycleSaid(s)}${s.rows.failed.length ? `; not held: ${s.rows.failed.slice(0, 6).join(", ")}${s.rows.failed.length > 6 ? ` and ${s.rows.failed.length - 6} more` : ""}` : ""}`, ...saidRecorded(s.rows.recorded ?? []), ...(s.diagnoses ?? []).flatMap(saidDiagnosis), ...(s.repairs.length ? [`  repairs   ${s.repairs.join(", ")}`] : []), `  spent     ${s.spent.usd} of ${s.limits.usd} USD, ${s.spent.minutes} of ${s.limits.minutes} minutes${unknownSaid(s.spent)}`, ...(s.next ? [`  next      ${s.next}`] : []), ...(s.ending ? [`  ended     ${s.ending.outcome}: ${s.ending.summary}`] : []), ...(s.evidence ? [`  evidence  ${s.evidence}`] : []), `  room      ${s.room}`].join("\n"));

export const saidEvidence = (e) => [`${e.publishable ? "PUBLISHABLE" : `NOT PUBLISHABLE (${e.code})`} -- ${e.says}`, ...saidRecorded(e.recorded ?? [])].join("\n");
