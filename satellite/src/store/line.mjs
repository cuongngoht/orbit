// The ONE reading of a journal line: what the whole-file reader keeps, and what a live follower keeps
// (src/store/follow.mjs createFollower with `parse: journalLine`) -- one definition, so a line's index can never
// differ between a page that reloads and a viewer that follows. A torn or garbled line is dropped, never fatal.
const parsedLine = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

export const journalLine = (text) => ((r) => (r && typeof r === "object" && !Array.isArray(r) && typeof r.kind === "string" ? r : null))(parsedLine(text));
