// `learn where` and `learn auto` -- the two questions about the store itself.
//
// `where` prints every candidate, including the ones that lost and why. A memory
// tool that will not say where it keeps things, or quietly writes somewhere other
// than you expect, is one nobody can audit -- and auditing it is the whole reason
// the resolution is a table rather than a chain of ifs.
import { out } from "../../query/format.mjs";
import { Refused } from "../../errors.mjs";
import { has, words } from "../args.mjs";

// `--root` is the path and nothing else, so a script
// `query check` prints -- can name the store without parsing a report meant for
// a person. Adding it as a flag rather than a command keeps the one sentence
// about where things live in one place.
export function where(ctx, args) {
  const found = ctx.store;
  if (has(args ?? [], "root")) return void out(found.root);
  out(`store      ${found.root}   (${found.source})`);
  out(`  why      ${found.why}`);
  said(ctx, found);
}

function said(ctx, found) {
  out(`  key      ${found.key}   (${found.layout === 3 ? "Git repository identity" : "explicit data directory identity"})`);
  out("considered");
  for (const c of found.considered) out(`  ${c.source.padEnd(8)} ${String(c.dir ?? "—").padEnd(52)} ${c.verdict}: ${c.why}`);
  projection(ctx);
  out(`switch     ${ctx.learn.auto().on ? "on" : `off — ${ctx.learn.auto().why}`}`);
}

function projection() {
  out("recall     directly from Orbit memory; host-memory projection is retired");
}

// Turning learning off must not blind a session to what it already learned:
// `recall`, `lessons` and `why` keep working. Only deriving stops.
export function auto(ctx, args) {
  const [want] = words(args);
  if (!["on", "off"].includes(want)) throw new Refused("learn auto on | learn auto off");
  ctx.learn.setAuto(want === "on", `learn auto ${want}`);
  out(`auto-learning: ${want}`);
  out(want === "on" ? "  analyse will derive lessons again." : "  analyse will refuse until `learn auto on`. recall, lessons and why still work.");
}
