// AUTHORIZE: the one question every executable side effect can ask -- may this action cross, now?
//
//   authorize(action)            the boundary row it meets (src/protected/boundaries.mjs), or AUTO. Pure: it reads
//                                the action and nothing else, so an executor, Orbit Control, Live and a test all get
//                                the same answer for the same action
//   requestOf(verdict, base)     what a TASK asks a person for when the verdict is approve-once: the fields of
//                                `request-approval` (src/task/ops.mjs), the boundary riding along
//   actionFingerprint(verdict)   the protected action alone, as a capability call carries it once the task that asked
//                                consumed its approval (src/capability/invoke.mjs `boundary` gate)
//   crossing(verdict, actor, w)  a DENY that a person's own act may cross -- only through Orbit Control's door, as
//                                a composition root established it, never as a caller says
//   personAct(actor, …)          the test-data home's own transfer rule (storage export): Control, or a person
//                                typing at a terminal -- a data home a person chose, never a protected boundary
//
// An approval is never a permission for an agent, a skill, a session, a task or a kind of action: it is ONE action's
// fingerprint, asked for, granted once in Orbit Control and spent once (src/task/approvals.mjs). Nothing here grants.
import { canonicalJson, short } from "../hash.mjs";
import { printable } from "../printable.mjs";
import { scrub } from "../scrub.mjs";
import { BOUNDARIES, DECISIONS } from "./boundaries.mjs";
import { tierOf } from "./environments.mjs";

// What a person approves: a hash of the action's type, tool, environment and parameters -- the parameters hashed and
// never kept, so a changed action has another fingerprint and cannot spend the approval. (src/task/approvals.mjs reads
// it from here, so a task and every executor hash one action one way.)
export const fingerprintOf = ({ type, tool, environment, params }) => short(canonicalJson({ type: type ?? null, tool: tool ?? null, environment: environment ?? null, params: params ?? null }), 16);

export const AUTO = Object.freeze({ decision: DECISIONS.AUTO });

const TEXT_MOST = 240;
const SHOWN_MOST = 120;
const SHOWN_FIELDS = 8;

const oneLine = (value, most) => scrub(printable(String(value))).replace(/\s+/g, " ").trim().slice(0, most);

// A whole commit or digest is shown the way a person reads one, by its first twelve characters -- the action is bound
// to all of it by the fingerprint, and a long hex string would be masked as a secret on its way to the journal.
const readable = (value) => (/^[0-9a-f]{40,64}$/.test(String(value)) ? String(value).slice(0, 12) : value);

const present = (v) => v !== undefined && v !== null && v !== "";

const picked = (a, fields) => Object.fromEntries(fields.map((f) => [f, a[f] ?? null]));

const shownOf = (a, fields) => Object.fromEntries(fields.filter((f) => present(a[f])).slice(0, SHOWN_FIELDS).map((f) => [f, oneLine(readable(a[f]), SHOWN_MOST)]));

const verdictOf = (row, a) => ({ decision: row.decision, boundary: row.id, kind: row.kind(a), destructive: row.destructive === true, person: row.person === true, environment: tierOf(a.environment), params: picked(a, row.fingerprint), shows: shownOf(a, row.shows), title: row.title, risk: oneLine(row.risk(a), TEXT_MOST) });

const actionOf = (action) => (action && typeof action === "object" && !Array.isArray(action) ? action : {});

export function authorize(action) {
  const a = actionOf(action);
  const row = BOUNDARIES.find((b) => b.when(a));
  return row ? verdictOf(row, a) : AUTO;
}

export const isAuto = (verdict) => verdict.decision === DECISIONS.AUTO;

export const needsApproval = (verdict) => verdict.decision === DECISIONS.APPROVE_ONCE || verdict.decision === DECISIONS.APPROVE_ONCE_DESTRUCTIVE;

export const isDenied = (verdict) => verdict.decision === DECISIONS.DENY;

// `base`: { tool, environment? } -- the executor's own words for where it acts. The type IS the protected kind, so the
// action a task records and the approval it spends name the same thing.
export const requestOf = (verdict, base = {}) => ({ type: verdict.kind, tool: base.tool, environment: base.environment ?? verdict.environment, params: { boundary: verdict.boundary, ...verdict.params }, risk: verdict.risk, boundary: verdict.boundary, destructive: verdict.destructive, shows: verdict.shows });

export const actionFingerprint = (verdict) => short(canonicalJson({ kind: verdict.kind ?? null, environment: verdict.environment ?? null, params: verdict.params ?? null }), 16);

// ---- a person's own act --------------------------------------------------------------------------------------------

// `actor`: { door, human, tty, confirmed } -- what the composition root could ESTABLISH: Orbit Control sets door
// "control" after its mutation token; a terminal is a person only when one is typing in it and types back exactly what
// was shown. An agent's shell has no terminal, so `--human` there is refused, naming the command a person runs. `w`:
// { lead, what, command } -- the sentence that says what was refused, what was shown, and what a person runs.
// Ordered; the first that matches decides, and the last always does.
export const PERSON_ACTS = Object.freeze([
  { id: "CONTROL", when: (a) => a?.door === "control", allowed: true, says: () => "a person, through Orbit Control" },
  { id: "NOT_HUMAN", when: (a) => a?.human !== true, allowed: false, says: (a, expected, w) => `${w.lead} A person runs, in a terminal of their own:\n  ${w.command}` },
  { id: "NO_TERMINAL", when: (a) => a?.tty !== true, allowed: false, says: (a, expected, w) => `--human needs a terminal a person is typing in, and this one has none (an agent's shell never does) — nothing written. A person runs, in a terminal of their own:\n  ${w.command}` },
  { id: "NOT_TYPED", when: (a, expected) => a.confirmed !== expected, allowed: false, says: (a, expected, w) => `what was typed is not ${expected}, ${w.what} the preview showed — nothing written` },
  { id: "TYPED", when: () => true, allowed: true, says: (a, expected, w) => `a person at this terminal, who typed ${w.what}'s id` },
]);

export const personAct = (actor, expected, w) => ((row) => ({ allowed: row.allowed, by: row.id, says: row.says(actor, expected, w) }))(PERSON_ACTS.find((r) => r.when(actor, expected)));

const needsAnApproval = (verdict) => ({ allowed: false, by: "APPROVAL", says: `${verdict.title}: ${verdict.risk} — only an approval of exactly this action, given once in Orbit Control, lets it run` });

// A DENY a person's own act may cross is crossed ONLY through Orbit Control's door: the one door that proves a person
// (its mutation token was checked before the context was built). A terminal is not one -- an agent can type at a
// pseudo-terminal it made, and it knows every id it was shown -- so no flag, prompt or typed-back id crosses it.
export const BOUNDARY_DOOR = "control";

const deniedHere = (verdict, w) => ({ allowed: false, by: "DENIED", says: `${verdict.title}: ${verdict.risk} — a protected boundary Orbit never crosses on its own, and no terminal can prove a person. ${w.lead ?? ""}${w.where ? ` A person does it themselves, in ${w.where}` : ""}`.trim() });

// -> { allowed, by, says }: whether `actor` may do, now, what `verdict` decided -- AUTO always, a person's DENY only
// through Orbit Control's door, anything else never here (an approve-once goes through a task's approval).
export function crossing(verdict, actor, w = {}) {
  if (isAuto(verdict)) return { allowed: true, by: "AUTO", says: "autonomous" };
  if (!isDenied(verdict) || verdict.person !== true) return needsAnApproval(verdict);
  return actor?.door === BOUNDARY_DOOR ? { allowed: true, by: "CONTROL", says: "a person, through Orbit Control" } : deniedHere(verdict, w);
}
