// INSPECT (`o`): every generated test the investigations this viewer follows have said something about, one row per
// OBLIGATION -- its shape and target, where it stands, the word its latest attempt earned and the RESULT row that gave
// it, and how many attempts it took -- from their allow-listed activity only (src/investigation/activity.mjs), folded
// once by eventId (src/live/current.mjs). Enter shows one test's fields; a field the activity did not carry says NOT
// RECORDED. A retry is the same test again, never a new one; nothing here reads a design, a case or a result's body,
// and nothing infers a pass: a word is the one the host's own check earned, or the state the test is in.
import { ABSENT, dim, joined, row, seg, str } from "../sections/parts.mjs";

const TONES = { SATISFIED: "success", CONTRADICTED: "danger", FLAKY: "warning", AMBIGUOUS: "warning", INCONCLUSIVE: "subtle", running: "info", discovered: "subtle" };

export const INSPECT_FIELDS = Object.freeze(["investigation", "obligation", "shape", "target", "authority", "state", "outcome", "cause", "execution", "attempt", "attempts", "at"]);

const investigationsOf = (d) => ({ ...(d?.child?.qa ?? {}), ...(d?.root?.qa ?? {}) });

// -> [{ investigation, obligation, attempts, shape, target, authority, state, outcome, cause, execution, attempt, at }]
export const inspectItems = (d) => Object.values(investigationsOf(d)).flatMap((q) => Object.entries(q.tests?.obligations ?? {}).map(([id, o]) => ({ investigation: q.id, obligation: id, attempts: attemptsOf(q.tests, id), ...o })));

// The executions started for an obligation: each one an attempt of a version a design of it froze.
const attemptsOf = (t, id) => Object.values(t.executions ?? {}).filter((version) => t.designs?.[t.versions?.[version]] === id).length;

const wordOf = (it) => (it.state === "evaluated" ? it.outcome ?? ABSENT.unrecorded : it.state ?? ABSENT.unrecorded);

const itemRow = (it) => row([seg((str(it.shape) ?? "test").padEnd(30), "label"), seg(` ${wordOf(it)}`, TONES[wordOf(it)]), it.cause ? dim(` (${it.cause})`) : null, dim(`  ${it.attempts} attempt${it.attempts === 1 ? "" : "s"} · ${str(it.target) ?? ABSENT.unrecorded}`)]);

const valueOf = (it, field) => (it[field] === null || it[field] === undefined || it[field] === "" ? ABSENT.unrecorded : String(it[field]));

// Each field's label is padded past the longest one, so a value never runs into its name.
const LABEL = Math.max(...INSPECT_FIELDS.map((f) => f.length)) + 2;

const detailRows = (it) => (it ? [row([dim("─".repeat(8))]), ...INSPECT_FIELDS.map((f) => row([dim(`  ${f.padEnd(LABEL)}`), seg(valueOf(it, f), valueOf(it, f) === ABSENT.unrecorded ? "subtle" : undefined)]))] : []);

const NONE = [row([dim("no investigation this viewer follows has said anything about a generated test yet")])];

export function inspectOverlay(state, d) {
  const items = inspectItems(d);
  const lead = [row(joined([seg(`${items.length} generated test${items.length === 1 ? "" : "s"}`, "brand"), dim("one row per obligation; a retry is the same test again; a word is what the host's own check earned")]))];
  return { title: "TESTS", lead, rows: items.length ? items.map(itemRow) : NONE, selectable: items.length > 0, after: detailRows(items[state.viewer.detail ?? -1]) };
}
