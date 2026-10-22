// The steps of a mission a test drives, each one decision through the real engine -- the host's half, scripted.
import { contextOf } from "../../src/mission/context.mjs";
import { step } from "../../src/mission/loop.mjs";
import { decided } from "./world.mjs";

let counter = 0;

export const nextDecision = () => `dec-${++counter}`;

// One step on the revision the mission is at now.
export const act = async (w, id, action, extra = {}) => step(w, id, decided(nextDecision(), contextOf(w, id).revision, action, extra));

export const intentFor = (goalDigest, extra = {}) => ({ facts: [{ statement: "the nightly build log shows a timeout", sourceRef: `goal@${goalDigest.slice(0, 8)}` }], hypotheses: [{ statement: "the client's retry loop exceeds the job's deadline" }], acceptanceCriteria: [{ statement: "the cause of the timeout is named with the file that shows it", verification: "an explore run cites the file" }], unknowns: [{ statement: "whether the deadline is configured per job" }], ...extra });

export const exploreUnit = (extra = {}) => ({ key: "explore", kind: "explore", objective: "find where the nightly timeout comes from", acceptanceCriteriaRefs: ["acc-1"], ...extra });

export const explorerRole = (unit = "wu-1", extra = {}) => ({ unit, responsibilities: [{ activity: "explore", subject: "repository" }], profile: "READ_ONLY", purpose: "Investigate the repository to find what the goal touches.", restrictions: ["It changes nothing and reads only."], completionCriteria: ["Every finding names the file that shows it."], ...extra });
