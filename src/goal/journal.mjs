const parsedLine = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

export const journalLine = (line) => ((r) => (r && typeof r === "object" && typeof r.kind === "string" ? r : null))(parsedLine(line));
