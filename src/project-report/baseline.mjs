// A BASELINE: the earlier run this one may honestly be compared with -- or a
// sentence saying why there is none.
//
// Comparable means the same question asked of an earlier moment: the same
// source and scope (their identity hash), the same kind and length of window,
// a cut-off strictly before this one's, and -- metric by metric -- the same
// definition version. Only rates, shares and medians are compared; a TOTAL
// depends on how long the window was and is shown side by side, never as a
// change. A report never compares itself with a run from its own future.
export const BASELINE_STATES = ["compared", "none", "not-comparable"];

// current: { runId, identity, window, metrics } · records: run records, newest first
export function baselineOf(current, records) {
  const earlier = records.filter((r) => r.runId !== current.runId && !r.unreadable && r.window && r.render?.metrics);
  if (!windowKey(current.window)) return { status: "not-comparable", reason: "an all-history report has no fixed window to compare with another" };
  const match = earlier.find((r) => !mismatch(current, r));
  if (match) return compared(current, match);
  return earlier.length ? { status: "not-comparable", reason: `no earlier run asked the same question: the newest (${earlier[0].runId}) ${mismatch(current, earlier[0])}` } : { status: "none", reason: "This is the first report of this scope and window; the next comparable one will compare against it." };
}

// The first difference that makes two runs incomparable, as the end of a sentence.
const MISMATCH = [
  { differs: (c, r) => r.identity !== c.identity, says: () => "read a different source or scope" },
  { differs: (c, r) => windowKey(r.window) !== windowKey(c.window), says: (c, r) => `covered ${describe(r.window)}, not ${describe(c.window)}` },
  { differs: (c, r) => !(Date.parse(r.window.cutoffUtc) < Date.parse(c.window.cutoffUtc)), says: () => "does not end before this one does" },
];

function mismatch(current, record) {
  const row = MISMATCH.find((m) => m.differs(current, record));
  return row ? row.says(current, record) : null;
}

// Whole months are compared with whole months of the same count; a free range
// with a range of the same number of days; history with nothing.
export function windowKey(w) {
  if (!w || w.mode === "all") return null;
  if (w.mode === "range") return `days:${Math.round((Date.parse(w.toUtc) - Date.parse(w.fromUtc)) / 86400000)}`;
  return `months:${w.months}`;
}

const describe = (w) => (w.mode === "range" ? `${windowKey(w).slice(5)} days` : w.mode === "all" ? "all history" : `${w.months} month(s)`);

function compared(current, record) {
  const before = new Map(record.render.metrics.map((m) => [m.id, m]));
  const deltas = current.metrics.filter((m) => before.has(m.id)).map((m) => deltaOf(m, before.get(m.id)));
  return { status: "compared", previous: { runId: record.runId, from: record.window.from, to: record.window.to }, deltas };
}

function deltaOf(now, then) {
  const comparable = now.compare === "rate" && now.version === then.version && isNumber(now.value) && isNumber(then.value);
  const delta = comparable ? round(now.value - then.value) : null;
  return { id: now.id, label: now.label, unit: now.unit, previous: then.value ?? null, current: now.value ?? null, comparable, delta, better: comparable ? betterOf(now.direction, delta) : null, why: whyNot(now, then, comparable) };
}

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v) => Math.round(v * 100) / 100;
const betterOf = (direction, delta) => (delta === 0 || !direction ? null : (direction === "higher") === (delta > 0));

function whyNot(now, then, comparable) {
  if (comparable) return null;
  if (now.version !== then.version) return `its definition changed (v${then.version} → v${now.version})`;
  return now.compare === "rate" ? "one of the two runs has no value" : "a total depends on the window's length, so it is shown, not compared";
}
