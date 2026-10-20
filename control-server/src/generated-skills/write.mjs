// A PERSON's moves on a generated playbook, each its own route: test it again against today's contract,
// activate it (only while its files are what was verified), disable it, retire it, roll it back to an earlier
// version (verified again, registered as the next), or archive it. There is no delete: the engine never
// deletes a playbook, because a task that pinned a version must still read it. A playbook's identity is its
// own (`project:<id>`): nothing here can reach a shipped skill.
import { conflict, guarded, invalid, missing } from "../errors.mjs";
import { factoryFor, generatedSkill, skillIdOf } from "./read.mjs";

const CONFLICTS = ["SF_MOVE", "SF_QUARANTINED"];

const translated = (e) => (CONFLICTS.includes(e?.code) ? conflict(e.code, e.message) : e?.code === "SF_UNKNOWN" ? missing(e.code, e.message) : e);

// The engine's refusal, as this server says it: a move that cannot be made now is a 409, an unknown playbook a
// 404, anything else the request's fault (400) -- `guarded` passes a translated error through as it is.
const moved = (fn) => guarded("SKILL_ACTION_INVALID", () => translatedCall(fn));

const answered = (ctx, key, id, result) => ({ result, ...generatedSkill(ctx, key, id) });

export const revalidateSkill = async (ctx, key, id) => ({ verdict: factoryFor(ctx, key).revalidate(skillIdOf(id)) });

export const moveSkill = (status) => async (ctx, key, id) => answered(ctx, key, id, await moved(() => factoryFor(ctx, key).status(skillIdOf(id), status)));

export const archiveSkill = async (ctx, key, id) => ({ result: await moved(() => factoryFor(ctx, key).archive(skillIdOf(id))) });

export async function rollbackSkill(ctx, key, id, body) {
  if (!/^\d+\.\d+\.\d+$/.test(String(body?.version ?? ""))) throw invalid("SKILL_ACTION_INVALID", "send { version } -- the version to roll back to");
  const result = await moved(() => factoryFor(ctx, key).rollback(skillIdOf(id), body.version));
  return result.ok ? answered(ctx, key, id, result) : { result };
}

function translatedCall(fn) {
  try { return fn(); }
  catch (e) { throw translated(e); }
}
