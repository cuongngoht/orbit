// What has moved under this plan, and how sure the tool is about each answer.
import { planFor } from "../load.mjs";
import { impactOf } from "../impact.mjs";
import { bullet, noPlan, out } from "../format.mjs";
import { planWorld } from "../world.mjs";

export function impact(ctx, args) {
  const ref = args.find((a) => !a.startsWith("--"));
  const p = ref ? planFor(ctx, ref) : null;
  return p ? body(ctx, p, args) : noPlan(ref ?? "");
}

// `--now=REQ1=v3,TICKET=42` is what the caller KNOWS now. Nothing is fetched:
// somebody read the ticket, and this compares what they read with what the plan
// recorded.
const revisions = (args) => Object.fromEntries((args.find((a) => a.startsWith("--now="))?.slice(6) ?? "").split(",").filter(Boolean).map((pair) => pair.split("=")));

const changed = (args) => (args.find((a) => a.startsWith("--changed="))?.slice(10) ?? "").split(",").filter(Boolean);

function body(ctx, p, args) {
  const world = planWorld(ctx, { drafts: Boolean(p._draft) });
  const found = impactOf(p, world, { ...world, revisions: revisions(args), changed: changed(args) });
  sources(found);
  map(found);
  work(found);
}

function sources(found) {
  out("\nrequirements");
  for (const s of found.sources) out(bullet(`${s.id} [${s.confidence}] ${s.say}`));
  if (!found.sources.length) out(bullet("the plan lists no sources — nothing can be compared"));
}

const map = (found) => out(`\nmap\n${bullet(`[${found.map.confidence}] ${found.map.say}`)}`);

function work(found) {
  if (found.touched.length) out("\nscenarios driving a control that changed");
  for (const t of found.touched) out(bullet(`${t.id} [${t.confidence}] ${t.say}`));
  rerun(found);
}

function rerun(found) {
  if (!found.rerun.length) return out("\nevidence: every linked case has a current run");
  out("\nevidence that no longer covers this revision");
  for (const r of found.rerun) out(bullet(`${r.scenario} / ${r.case} [${r.confidence}] ${r.say}`));
}
