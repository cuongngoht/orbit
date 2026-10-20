// CLI tools as the page sees them: the EFFECTIVE list (src/tools/effective.mjs)
// -- catalog + desired + the last observation + receipts -- through an
// ALLOW-LIST, and the one way a request finds a tool.
//
// A GET never detects: asking every binary its version is a process each, so
// the list is the last observation, dated, and an explicit Refresh re-detects.
import { createToolState, toolCatalogAt, toolsOf } from "../core.mjs";
import { invalid, missing } from "../errors.mjs";

export const TOOL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const PUBLIC = ["id", "name", "summary", "provides", "enabled", "status", "available", "state", "source", "version", "path", "sources", "reason", "checkedAt", "stale", "install", "managed", "update"];

export const publicTool = (t) => Object.fromEntries(PUBLIC.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));

export const toolsNow = (ctx) => toolsOf(ctx.world);

export function entryOf(ctx, id) {
  if (typeof id !== "string" || !TOOL_ID.test(id)) throw invalid("INVALID_TOOL_ID", "a tool id is lowercase letters, digits, - and _ only");
  const entry = toolCatalogAt(ctx.world.pluginRoot, ctx.world.io).find((e) => e.id === id);
  if (!entry) throw missing("TOOL_NOT_FOUND", `the Orbit tool catalog has no tool named ${id}`);
  return entry;
}

export const toolOf = (ctx, id) => publicTool(toolsNow(ctx).find((t) => t.id === entryOf(ctx, id).id));

export const toolState = (ctx) => createToolState(ctx.world.rooms, ctx.world.io);

// Everything detection needs, bound to this store's rooms and receipts NOW --
// a receipt written a moment ago by an install must be seen by the next look.
export const detectionOf = (ctx, state) => ({ ...ctx.world.detection, rooms: ctx.world.rooms, receipts: state.receipts(), state, now: ctx.world.io.now });
