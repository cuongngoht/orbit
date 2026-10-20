// What past runs suggest about this plan. Suggestions only: a lesson is evidence
// about the product as built, and an acceptance criterion is what somebody
// decided the product should do. Nothing here may turn one into the other.
import { learnContext } from "../../learn/context.mjs";
import { planFor } from "../load.mjs";
import { bullet, noPlan, out } from "../format.mjs";
import { suggestionsFrom } from "../suggest.mjs";

export function suggest(ctx, args) {
  const ref = args.find((a) => !a.startsWith("--"));
  const p = ref ? planFor(ctx, ref) : null;
  return p ? body(ctx, p) : noPlan(ref ?? "");
}

function body(ctx, p) {
  const learn = learnContext(ctx).learn;
  const found = suggestionsFrom(learn.all(), p);
  if (!found.length) return out("no lesson has anything to say about this plan yet");
  out(`\n${found.length} suggestion(s) from what past sessions learned. Each one is a proposal with its source — none of them changes a criterion or an expected result.`);
  for (const s of found) one(s);
}

function one(s) {
  out(`\n${s.kind}  [${s.confidence}, ${s.sessions} session(s)]`);
  out(bullet(s.says));
  out(bullet(`because: ${s.because || s.evidence}`));
  out(bullet(`source: ${s.source}${s.scenarios.length ? ` · touches ${s.scenarios.join(", ")}` : ""}`));
}
