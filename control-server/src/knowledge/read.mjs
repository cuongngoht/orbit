// What project knowledge holds, for Orbit Control -- read only.
//
// The summary is the engine's own (src/knowledge/summary.mjs, through core.mjs):
// claims by authority, layer, source and concern; the relation vocabulary and
// what it refused; the context dimensions in use (names only); competing
// claims; capability opportunities and what a person decided. Nothing here
// records, reconciles or decides anything, and a host's memory never passes
// through Control at all.
export async function knowledgeView(ctx) {
  if (!ctx.knowledge) return { version: 1, available: false, why: "this Control was started without a project to read" };
  return ctx.knowledge();
}
