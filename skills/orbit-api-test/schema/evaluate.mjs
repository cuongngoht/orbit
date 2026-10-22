// Applying a schema the scan already read to one instance. Every keyword the schema holds is applied -- nothing is
// skipped because an earlier keyword failed -- so the errors say everything wrong, up to the cap. Three limits stop a
// hostile schema rather than a run: nesting depth, total work, and a `$ref` cycle re-entering the same schema at the
// same instance location. A limit is a gap, and the caller then reports no verdict at all.
import { CHECKS } from "./keywords.mjs";

export const MAX_ERRORS = 20;

export function evaluate(ctx, schema, instance, path, depth) {
  if (typeof schema === "boolean") return schema || fail(ctx, path, "false", "the schema is false, which nothing satisfies");
  if (overLimit(ctx, schema, path, depth)) return false;
  return within(ctx, activeKey(ctx, schema, path), () => applied(ctx, schema, instance, path, depth));
}

const applied = (ctx, schema, instance, path, depth) => Object.keys(schema).filter((k) => Object.hasOwn(CHECKS, k)).map((k) => CHECKS[k](ctx, schema[k], instance, { schema, path, depth })).every(Boolean);

export function fail(ctx, path, keyword, message) {
  if (ctx.errors.length < MAX_ERRORS) ctx.errors.push({ path, keyword, message });
  return false;
}

// A branch whose own errors must not stand: anyOf, oneOf, not, if and contains judge it and say one thing about it.
export function quiet(ctx, run) {
  const mark = ctx.errors.length;
  const result = run();
  ctx.errors.length = mark;
  return result;
}

function within(ctx, key, run) {
  ctx.active.add(key);
  const result = run();
  ctx.active.delete(key);
  return result;
}

const idOf = (ctx, schema) => ctx.ids.get(schema) ?? ctx.ids.set(schema, ctx.ids.size).get(schema);
const activeKey = (ctx, schema, path) => `${idOf(ctx, schema)}|${path}`;

const LIMITS = [
  { hit: (ctx) => ctx.stopped, why: null },
  { hit: (ctx, schema, path, depth) => depth > ctx.limits.depth, why: (ctx) => `evaluation nests deeper than ${ctx.limits.depth} levels` },
  { hit: (ctx) => ++ctx.work > ctx.limits.work, why: (ctx) => `evaluation takes more than ${ctx.limits.work} steps` },
  { hit: (ctx, schema, path) => ctx.active.has(activeKey(ctx, schema, path)), why: () => "a $ref cycle re-enters the same schema at the same instance location" },
];

function overLimit(ctx, schema, path, depth) {
  const row = LIMITS.find((l) => l.hit(ctx, schema, path, depth));
  if (row?.why) stop(ctx, path, row.why(ctx));
  return Boolean(row);
}

function stop(ctx, path, why) {
  ctx.stopped = true;
  ctx.gaps.push({ keyword: "limits", path, why });
}
