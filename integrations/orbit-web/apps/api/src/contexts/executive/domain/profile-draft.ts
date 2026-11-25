// A PROFILE THE CEO DRAFTS (Executive, pure; ADR 0062). Asked for a profile draft -- and only then -- the CEO ends its
// answer with ONE fenced block:
//
//   ```orbit-profile
//   { "title": "...", "duties": "...", "instructions": "...", "skills": ["..."], "languages": ["..."], "handoffStandard": "..." }
//   ```
//
// The server reads the LAST such block and takes a profile's own descriptive fields alone, each within the profile's
// bounds (checkProfileDraft): never what the employee runs on, holds or may do. A draft only fills a form the owner
// reviews; it hires nobody, and a block in any other answer is ignored.
import { checkProfileDraft, type ProfileDraft } from "@orbit-web/contracts";

const FENCE = /```orbit-profile[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;

// What a block holds, as written (the last one counts), and the answer without any of them.
export function profileBlocks(answer: string): { last: string | null; text: string } {
  const blocks = [...answer.matchAll(FENCE)];
  return { last: blocks.length === 0 ? null : ((blocks.at(-1) as RegExpMatchArray)[1] ?? ""), text: answer.replace(FENCE, "").replace(/\n{3,}/g, "\n\n").trim() };
}

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function readProfileDraft(raw: string | null): { draft: ProfileDraft | null; problems: string[] } {
  if (raw === null) return { draft: null, problems: ["The CEO's answer held no profile (no ```orbit-profile block)."] };
  const checked = checkProfileDraft(parsed(raw));
  return checked.ok ? { draft: checked.value, problems: [] } : { draft: null, problems: checked.errors.slice(0, 12).map((e) => `The draft: ${e}.`) };
}
