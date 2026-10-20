// An investigation as a live SOURCE, as the investigation subject itself answers it: how its journal's
// lines are kept (store.mjs journalLine), what each says as QA activity (activity.mjs, an allow-list),
// and which investigations were begun against a task (discover.mjs). The live core (src/live/) imports no
// subject, so a composition root hands it this and `open`, the store of one project's investigations.
import { activityOf } from "./activity.mjs";
import { investigationsOf, MAX_FOLLOWED, stampOf } from "./discover.mjs";
import { createInvestigations, journalLine } from "./store.mjs";

export const QA_SOURCE = Object.freeze({ line: journalLine, activityOf, investigationsOf, stampOf, MAX_FOLLOWED, open: createInvestigations });
