// The Verify half of a scripted step. Anything the browser can see becomes a
// command; anything it cannot is printed as a checklist rather than faked.
import { describe, layerItems, layersOf, timingOf } from "../graph/index.mjs";
import { comment, sh } from "./shell.mjs";

export function verifyBlock(fx, meta) {
  const L = [comment(`^ THIS IS THE COMMIT ACTION — ${fx.api ?? "no backend call"} [${fx.backend}], timing: ${fx.timing}`)];
  if (fx.backend === "none") return [...L, comment(`Persists nothing on its own${fx.persistedBy ? `; the write happens at ${fx.persistedBy}` : ""}. Do not assert a row after this step.`)];
  return [...L, ...timingNotes(fx, meta), `playwright-cli --raw eval ${sh("document.body.innerText.slice(0,400)")}`, ...manualChecks(fx, meta)];
}

// What a deferred timing means is the project's sentence, written once in
// graph/meta.json: "the HTTP 200 is not success" is true of one product's queue
// and nonsense for another's.
function timingNotes(fx, meta) {
  const t = timingOf(meta, fx.timing);
  const L = t?.note ? [comment(`Deferred: ${t.note}`)] : [];
  if (fx.note) L.push(comment(`NOTE: ${fx.note}`));
  return L;
}

function manualChecks(fx, meta) {
  const manual = layersOf(meta).flatMap((l) => layerItems(fx, l.key).map((i) => `${l.label.toUpperCase()}: ${describe(l, i)} — ${i.src}`));
  if (!manual.length) return [];
  return [comment("NOT VERIFIABLE FROM THE BROWSER — hand these to the manual-test planner, do not guess them:"), ...manual.map((m) => comment(m, ""))];
}
