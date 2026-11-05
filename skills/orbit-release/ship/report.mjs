// WHAT A SHIP SAYS, in words for a person and as JSON for a pipeline -- the result of a ship, where one stands, and
// whether what it qualified may be published. Every number a host reported is said as reported; a delivery that waits
// for a person says the exact commands, and says that nothing was pushed.
//
//   saidResult(r) -> text      saidStatus(s) -> text      saidEvidence(e) -> text      saidOptional(rows) -> [text]
const WORDS = { SHIPPABLE: "SHIPPABLE", NOT_SHIPPABLE: "NOT SHIPPABLE", BLOCKED: "BLOCKED", BUDGET_EXHAUSTED: "BUDGET EXHAUSTED", NO_PROGRESS: "NO PROGRESS", REFUSED: "REFUSED", PAUSED: "PAUSED", CANCELLED: "CANCELLED" };

const deliveryLines = (d) => (d?.patch ? [`  delivery  the qualified source holds repairs this ship integrated in its own workspace -- nothing was pushed or`, `            written into your checkout. Apply them yourself: git am ${d.patch}`, `            (or: git fetch ${d.bundle} HEAD), then node skills/orbit-release/ship.mjs --evidence says whether it is publishable`] : []);

export const saidOptional = (rows) => rows.map((r) => `  optional  ${r.name}: ${r.ok ? "held" : "not held"} -- ${r.detail} (not required to ship)`);

export const saidResult = (r) => [`RESULT    ${WORDS[r.outcome] ?? r.outcome} -- ${r.summary}`, `  ship      ${r.ship} (task ${r.task}: node cli/task.mjs show ${r.task}; Orbit Live and Mission Control show it)`, `  room      ${r.room}`, ...(r.evidence ? [`  evidence  ${r.evidence}`] : []), ...deliveryLines(r.delivery), ...(r.exit === 3 ? [`  resume    node skills/orbit-release/ship.mjs --resume=${r.ship} (once what blocked it is fixed)`] : []), ...(r.optional ? saidOptional(r.optional) : [])].join("\n");

// Runs whose cost nobody can know -- a restart interrupted them -- said beside what was spent, never added into it.
const unknownSaid = (spent) => (spent.unknown ? `; and ${spent.unknown} run(s) a restart interrupted, whose cost is unknown (never charged at their cap)` : "");

// Which cycle a ship's rows are said of: the open one, or -- for a ship whose cycle closed -- the newest it ran.
const cycleSaid = (s) => (s.cycleOpen ? "this cycle" : s.cycle > 0 ? `in cycle ${s.cycle}, which closed` : "(no cycle has run)");

export const saidStatus = (s) => (!s.found ? s.says : [`SHIP      ${s.ship} -- ${s.lifecycle}${s.stage ? ` · ${s.stage}` : ""} (${s.mode}), task ${s.task}`, `  from      ${s.start.branch ?? "detached"}@${s.start.commit.slice(0, 12)}; release commit now ${s.commit.slice(0, 12)}; cycle ${s.cycle}`, `  rows      ${s.rows.held}/${s.rows.total} held ${cycleSaid(s)}${s.rows.failed.length ? `; not held: ${s.rows.failed.slice(0, 6).join(", ")}${s.rows.failed.length > 6 ? ` and ${s.rows.failed.length - 6} more` : ""}` : ""}`, ...(s.repairs.length ? [`  repairs   ${s.repairs.join(", ")}`] : []), `  spent     ${s.spent.usd} of ${s.limits.usd} USD, ${s.spent.minutes} of ${s.limits.minutes} minutes${unknownSaid(s.spent)}`, ...(s.next ? [`  next      ${s.next}`] : []), ...(s.ending ? [`  ended     ${s.ending.outcome}: ${s.ending.summary}`] : []), ...(s.evidence ? [`  evidence  ${s.evidence}`] : []), `  room      ${s.room}`].join("\n"));

export const saidEvidence = (e) => `${e.publishable ? "PUBLISHABLE" : `NOT PUBLISHABLE (${e.code})`} -- ${e.says}`;
