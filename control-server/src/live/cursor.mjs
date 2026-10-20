// The ONE cursor of a live task lives in the live core every viewer shares (src/live/cursor.mjs); Control
// streams it as each event's id and reads it back from Last-Event-ID. Re-exported here so the transport's
// own modules, and its tests, name it where they always did.
export { CURSOR, formatCursor, formatOffset, MAX_CURSOR, parseCursor, parseOffset, zeroCursor } from "../core.mjs";
