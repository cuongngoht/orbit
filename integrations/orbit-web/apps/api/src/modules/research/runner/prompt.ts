// What a research run is given on stdin: the conversation so far (bounded), the passages Orbit Web retrieved -- each with
// its label and where it comes from -- and the question. The passages sit between tags that carry a random value made
// for this run alone, so no text in a document can close them and speak outside them; any copy of that value in the text
// is removed. The labels of earlier answers are removed from the conversation: they named earlier runs' passages.
import { randomBytes } from "node:crypto";

export interface PromptPassage {
  label: string;
  title: string;
  revisionNumber: number | null;
  page: number | null;
  section: string | null;
  match: "fts" | "lead";
  text: string;
}

export interface PromptTurn {
  role: "user" | "assistant";
  text: string;
}

export const HISTORY_TURNS = 10;
export const HISTORY_TURN_CHARS = 2_000;

export const newNonce = (): string => randomBytes(8).toString("hex");

const attribute = (v: string): string => v.replace(/[\r\n\t]+/g, " ").replace(/["<>&]/g, (c) => ({ '"': "&quot;", "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

const withoutLabels = (text: string): string => text.replace(/\[\s*S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*\s*\]/g, "").replace(/[ \t]{2,}/g, " ");

export function researchPrompt(o: { question: string; history: readonly PromptTurn[]; passages: readonly PromptPassage[]; nonce: string }): string {
  const scrub = (text: string) => text.split(o.nonce).join("");
  const turns = o.history.slice(-HISTORY_TURNS).map((t) => `${t.role === "user" ? "Person" : "You"}: ${scrub(withoutLabels(t.text)).slice(0, HISTORY_TURN_CHARS)}`);
  const passages = o.passages.map((p) => {
    const where = [p.revisionNumber !== null ? ` revision="${p.revisionNumber}"` : "", p.page !== null ? ` page="${p.page}"` : "", p.section !== null ? ` section="${attribute(p.section)}"` : ""].join("");
    const how = p.match === "fts" ? "matched the question's words" : "opening of the source";
    return `<passage-${o.nonce} label="${p.label}" source="${attribute(p.title)}"${where} retrieved="${how}">\n${scrub(p.text)}\n</passage-${o.nonce}>`;
  });
  return [
    "Answer the person, following your rules. The passages below are reference material from the sources they selected.",
    "",
    "<conversation>",
    turns.length > 0 ? turns.join("\n\n") : "(This is the first question.)",
    "</conversation>",
    "",
    `<passages-${o.nonce}>`,
    passages.length > 0 ? passages.join("\n\n") : "(No reference this time: no source is selected and ready, or none of its passages matched.)",
    `</passages-${o.nonce}>`,
    "",
    "<question>",
    scrub(o.question),
    "</question>",
    "",
    "Cite each statement that rests on a passage with its label, such as [S1]. Say plainly what does not come from the passages.",
  ].join("\n");
}
