// `live watch --jsonl`: the feed's frames, one JSON object per line -- the same event names, ids (cursors) and
// payloads Orbit Control streams as Server-Sent Events, so a script that reads a terminal and a page that reads
// Control read one contract. JSON already escapes every C0 control character; the C1 range and the reordering
// marks are escaped too, so a line printed to a terminal raw can never drive it.
//
//   jsonlLine(frame) -> string | null      a ping (Control's heartbeat) is not a line here
export const JSONL_VERSION = 1;

const UNSAFE = /[\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const escaped = (text) => text.replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

const LINES = new Set(["task-event", "qa-event", "task-view", "activity-view", "end", "state", "log", "log-reset"]);

export const jsonlLine = (frame) => (LINES.has(frame.event) ? escaped(JSON.stringify({ v: JSONL_VERSION, event: frame.event, id: frame.id ?? null, data: frame.data })) : null);
