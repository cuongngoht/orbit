// Where the ENGINEERING room is kept, and what considered candidates lost to
// it -- src/architecture/views/store.mjs's identical question for a second
// subject, over the SAME store resolution (one store, one set of rooms).
import { out } from "../../query/format.mjs";

export function where(ctx) {
  const found = ctx.store;
  out(`store      ${ctx.eng.paths.root}   (${found.source})`);
  out(`  why      ${found.why}`);
  said(ctx, found);
}

function said(ctx, found) {
  out(`  key      ${found.key}`);
  out("  note     ORBIT_STORE_DIR relocates this whole machine store, not only the lessons — one store, one variable");
  out("considered");
  for (const c of found.considered) out(`  ${c.source.padEnd(8)} ${String(c.dir ?? "—").padEnd(52)} ${c.verdict}: ${c.why}`);
  roots(ctx);
}

function roots(ctx) {
  out(`source     ${ctx.source.root ?? "(no readable checkout)"}`);
  out(`  commit   ${ctx.source.commit() ?? "unknown — nothing here can be dated"}`);
  out("  nothing this command writes ever lands in the repository it reads");
}
