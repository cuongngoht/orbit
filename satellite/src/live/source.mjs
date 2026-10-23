// The mission as a SOURCE Orbit Live's follower registry can poll (src/live/subjects.mjs activitySubject): the journal's
// one keep-rule for a line, an empty projection, the fold that pushes one line into it, and the view drawn from it.
// The accumulator is the engine's own model plus the events it named, so a viewer and the engine never disagree.
import { createProjection } from "../projection/fold.mjs";
import { journalLine } from "../store/line.mjs";
import { liveViewOf } from "./view.mjs";

export const MISSION_SOURCE = Object.freeze({ version: 1, line: journalLine, empty: () => createProjection(), fold: (acc, record) => acc.push(record), view: (acc) => liveViewOf(acc.model(), acc.events()) });
