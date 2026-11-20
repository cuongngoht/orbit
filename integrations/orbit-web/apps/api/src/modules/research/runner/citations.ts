// CITATIONS ARE THE SERVER'S. An answer cites passages by label ([S1], [S2][S5], [S1, S3]); each label is looked up in the
// passages THIS run was given, and only one found there is a citation -- with its source, its revision and its place
// in the extracted text, from the server's own record, never from the model's words. A label the run was not given is
// removed from the answer and named as rejected; it is never shown as evidence.
const GROUP = /([ \t]*)\[\s*(S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*)\s*\]/g;

export interface Verified {
  text: string;
  // The valid labels, in the order they first appear.
  used: string[];
  rejected: string[];
}

export function verifyLabels(answer: string, valid: ReadonlySet<string>): Verified {
  const used: string[] = [];
  const rejected: string[] = [];
  const text = answer.replace(GROUP, (_, space: string, group: string) => {
    const labels = group.split(/\s*[,;]\s*/);
    const kept = labels.filter((l) => valid.has(l));
    for (const l of kept) if (!used.includes(l)) used.push(l);
    for (const l of labels) if (!valid.has(l) && !rejected.includes(l)) rejected.push(l);
    // A group with nothing left goes, with the space before it.
    return kept.length === 0 ? "" : `${space}${kept.map((l) => `[${l}]`).join("")}`;
  });
  return { text, used, rejected };
}
