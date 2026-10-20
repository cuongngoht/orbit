// Resolve targets from SQL BEFORE anything else. A case names the SHAPE of the
// row it needs, not an id: ids come and go, and a probe pinned to a deleted one
// silently passes. No row is BLOCKED, never FAIL: the precondition is absent,
// so the case did not run.
import { interpolate, placeholders } from "../dsl/interpolate.mjs";
import { readOnlyProblem } from "../dsl/sql-text.mjs";
import { Blocked, Refused, trunc } from "./errors.mjs";

export function resolveTargets(ctx, c, values) {
  return (c.resolve ?? []).map((r) => resolveOne(ctx, r, values));
}

function resolveOne(ctx, r, values) {
  const sql = runnable(r, interpolate(r.sql, values, "sql"));
  const value = String(pick(firstRow(ctx.db.query(sql), r, sql), r));
  values[r.as] = value;
  return { as: r.as, value, sql };
}

// The hazard this whole file's header warns about, on the one path that had no
// guard: a resolve whose ${X} nothing filled ran the LITERAL text `${X}` against
// the database, matched nothing, and the empty answer read like a result.
// What will actually be sent, once it has been proved worth sending.
function runnable(r, sql) {
  refuseUnbound(r, sql);
  refuseWrite(r, sql);
  return sql;
}

function refuseUnbound(r, sql) {
  const names = [...new Set(placeholders(sql))];
  if (names.length) throw new Refused(`resolve ${r.as}: ${names.map((n) => `\${${n}}`).join(", ")} is not a param, and no EARLIER resolve fills it`);
}

// The template was checked at validate time; this is the text the database will
// actually see, with every value substituted.
function refuseWrite(r, sql) {
  const problem = readOnlyProblem(sql);
  if (problem) throw new Blocked(`resolve ${r.as}: refusing to run this query — it ${problem}`);
}

function pick(row, r) {
  const val = r.col ? row[r.col] : Object.values(row)[0];
  if (val === undefined) throw new Blocked(`resolve ${r.as}: column ${r.col ?? "(first)"} is not in the result — got ${Object.keys(row).join(", ")}`);
  return val;
}

function firstRow(res, r, sql) {
  if (!res.ok) throw new Blocked(`resolve ${r.as}: the database could not be read — ${res.error}`);
  if (!res.rows.length) throw new Blocked(`resolve ${r.as}: no row matched — the precondition this case needs is not in the data.\n  ${trunc(sql, 200)}`);
  return res.rows[0];
}
