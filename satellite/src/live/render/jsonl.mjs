// One frame as ONE JSON line, for a program that follows a mission: `satellite-event` (an orbit.satellite.event/v1
// event, its id the cursor after it), `mission-view` (the live view, when it moved) and `end`. JSON escapes what C0
// holds; the C1 controls and the characters that reorder text around them are escaped too, so a line is safe to
// print whatever a journal held.
export const JSONL_VERSION = 1;

export const FRAMES = Object.freeze(["satellite-event", "mission-view", "end"]);

const ESCAPED = /[\u0080-\u009f‎‏‪-‮⁦-⁩]/g;

export const jsonlLine = (frame) => (FRAMES.includes(frame?.event) ? JSON.stringify({ v: JSONL_VERSION, ...frame }).replace(ESCAPED, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) : null);
