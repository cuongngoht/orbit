// Ids. A mission's is a short hash of what it is and when it began; every id INSIDE a mission is counted over the
// lines that introduce one (under the mission's lock, so two writers never hand out the same one). An event id is a
// line's index and is never stored: it is derived, so a replay and a live viewer name every event the same way.
import { short } from "../../../src/hash.mjs";

export const missionIdOf = ({ project, checkout, goalDigest, at }) => `msn-${short(`${project}\0${checkout}\0${goalDigest}\0${at}`, 12)}`;

export const PREFIX = Object.freeze({ "unit.created": "wu", "agentrun.created": "arn", "action.proposed": "act", "evidence.linked": "evd", "handoff.published": "hof" });

export const ID_PATTERNS = Object.freeze({ unit: /^wu-[1-9][0-9]{0,4}$/, run: /^arn-[1-9][0-9]{0,4}$/, action: /^act-[1-9][0-9]{0,5}$/, evidence: /^evd-[1-9][0-9]{0,5}$/, handoff: /^hof-[1-9][0-9]{0,4}$/ });

export const nextId = (model, kind) => `${PREFIX[kind]}-${(model.counts[kind] ?? 0) + 1}`;

export const eventIdOf = (n) => `evt-${n}`;
