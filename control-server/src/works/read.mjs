// Reading one checkout's tracked works: the list, and one work as the page shows it. Through the SAME modules `cli/track.mjs`
// runs -- the list's rows and `workViewOf`, the one read model -- so a page, a terminal and Orbit Live tell one story. A read
// writes nothing, starts nothing and probes nothing; and no route in this folder takes a body.
import { listTrackedWorks, readWorkView, scanWorks, trackedFold, workOwnedBy } from "../core.mjs";
import { guarded, missing } from "../errors.mjs";
import { workIdOf, worksOf } from "./project.mjs";

const CODE = "WORK_READ_FAILED";

export const listWorks = (ctx, ids) => guarded(CODE, () => ((w) => ({ works: listTrackedWorks(scanWorks(w.works), w.checkout) }))(worksOf(ctx, ids)));

// Unknown, another checkout's and one nobody tracked are the same answer: this checkout has no such tracked work.
function known(w, id) {
  const records = w.works.exists(id) ? w.works.read(id) : null;
  if (records && workOwnedBy(trackedFold(records), w.checkout)) return id;
  throw missing("WORK_UNKNOWN", "no tracked work like that is kept for this checkout");
}

export const readWork = (ctx, ids) => guarded(CODE, () => ((w) => ({ work: readWorkView(w, known(w, workIdOf(ids[2])), scanWorks(w.works)) }))(worksOf(ctx, ids)));
