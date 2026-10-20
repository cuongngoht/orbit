import { Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { normalizeSpec, specRecord, titleOf } from "./spec.mjs";
import { persistIntake } from "./intake-persist.mjs";
import { GOAL_SCHEMA } from "./vocab.mjs";

export { persistIntake };

export function goalId(ctx, specDigest, now) {
  return `goal-${short(`${ctx.project}\u0000${ctx.checkout}\u0000${specDigest}\u0000${now}`, 12)}`;
}

export function intakeFromText(ctx, text, opts = {}) {
  const body = normalizeSpec(text);
  const record = specRecord(body, opts.revision ?? 1);
  const id = goalId(ctx, record.digest, opts.now ?? Date.now());
  return { id, title: titleOf(body), meta: metaOf(ctx, id, titleOf(body), record, opts), spec: record };
}

function metaOf(ctx, id, title, record, opts) {
  return { id, title, project: ctx.project, checkout: ctx.checkout, sourceType: opts.sourceType ?? "paste", sourceRef: opts.sourceRef ?? null, specDigest: record.digest, by: "session", session: ctx.session, host: ctx.host, schema: GOAL_SCHEMA };
}

export function intakeRefusedEmpty(ref) {
  if (ref && String(ref).trim()) return null;
  throw new Refused("name the goal: paste a specification on stdin, use --file, or --ref=<work item>");
}
