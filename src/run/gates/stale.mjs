import { Refused } from "../errors.mjs";

// A case's steps encode how the screen behaved at ONE frontend commit.
export function staleGate(ctx, run) {
  if (!run.c.fe_commit) return ctx.warn(`! ${run.c.id} is undated (seen:${run.c.seen}) — record fe_commit once this run passes`);
  const moved = run.head && run.head !== run.c.fe_commit && !run.args.staleOk;
  if (moved) throw new Refused(`stale: ${run.c.id} recorded @ ${run.c.fe_commit}, frontend is @ ${run.head} — re-verify (query verify) or pass --stale-ok`);
}
