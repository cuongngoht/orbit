// FOLDING FOR SEARCH: the one way research text and a question's words are made comparable before the full-text index
// sees them -- decomposed (NFKD: a ligature or a full-width letter becomes its plain letters), every combining mark
// dropped (so "rò rỉ dữ liệu" and "ro ri du lieu" are the same words), đ/Đ (a letter of its own, not a mark) made d, and
// lower case. The index stores the folded text beside the text it shows (research_chunks.folded); a question is folded
// the same way, here, so the two can never drift apart.
const MARKS = /\p{M}+/gu;

export function foldForSearch(text: string): string {
  return text.normalize("NFKD").replace(MARKS, "").toLowerCase().replace(/đ/g, "d");
}

// What a chunk is searched by: its section's title and its text, folded.
export const searchableOf = (section: string | null, text: string): string => foldForSearch(section === null || section === "" ? text : `${section}\n${text}`);
