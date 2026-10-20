// The SQL half: what is actually true in the data, whatever the screen drew.
import { readOnlyProblem } from "../../dsl/sql-text.mjs";
import { oneValue } from "../capture.mjs";
import { Blocked, StepError, trunc } from "../errors.mjs";
import { verdict } from "../verdict.mjs";

export default {
  name: "sql",
  label: (s) => trunc(s.why ?? s.query, 60),
  act(ctx, run, s) {
    refuseWrite(s.query);
    const res = ctx.db.query(s.query);
    if (!res.ok) throw new Blocked(`the database could not be read — ${res.error}`);
    verdict(s, res.rows);
    return res.rows;
  },
  tail: (s, r) => `${r.result.length} row(s)`,
  logged: (r) => ({ rows: r.result }),
  capture: (step, rows) => oneValue(step, cell(step, rows)),
};

// Stricter than `resolve`, which has a `col`: `SELECT Id FROM …` already says
// which value it means, so anything else is the query, not the binding.
function cell(step, rows) {
  if (rows.length !== 1) throw new StepError(`into ${step.into}: the query returned ${rows.length} row(s) — a binding is one value, so select exactly one`);
  const cols = Object.values(rows[0]);
  if (cols.length !== 1) throw new StepError(`into ${step.into}: the query returned ${cols.length} columns — select just the one you mean to bind`);
  return cols[0];
}

// The belt to the braces. `check` already held this query to being one read-only
// statement, but that was the TEMPLATE; this is the text the database will see,
// with every ${PARAM} substituted. No value can turn a SELECT into two
// statements here without being caught. Blocked, not StepError: nothing was
// asked of the product, so nothing about it was proved wrong.
function refuseWrite(query) {
  const problem = readOnlyProblem(query);
  if (problem) throw new Blocked(`refusing to run this query — it ${problem}`);
}
