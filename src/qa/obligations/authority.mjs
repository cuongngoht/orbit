// Where a test obligation's AUTHORITY comes from (ADR 0031): read back from each source's
// owner, at the revision the binding pinned, and never accepted from anybody's say-so.
//
// A binding names a source -- an accepted requirement's criterion, a published API or message
// contract, a schedule policy, a security control, a plan -- and the owner of that source
// answers what it knows of it NOW (`answer`, handed in by the composition root: the
// requirements room, the sources room, the plan loader, the catalog Control keeps, the
// architecture facts). This table turns the pair into one word, first row wins, the last
// always matching. A value of `sourceAuthority` a host sends is refused by name before it is
// ever read (validate.mjs): the word is the table's, not the sender's.
//
// `rank` orders the words from weakest to strongest, and an obligation stands at the WEAKEST
// of its bindings: one stale source is enough to make the whole obligation owe a re-read.
// `confirms` is the column a verdict asks -- only an accepted source may make a valid run
// CONTRADICTED rather than suspected. Storing a draft, running it and accepting its contract
// stay three axes: nothing here moves because a test passed.
//
//   answer: { found, revision, digest, authority ("accepted" | "draft" | null), acceptanceRef,
//             bearing (false for code, commits, a graph or a runtime observation),
//             hint (true for a memory or a model's proposal), conflicts: [refs] }

export const AUTHORITY = [
  { id: "unknown", rank: 0, confirms: false, when: (b, a) => !a?.found, say: "the owner has no record of this source — nothing can be derived from it" },
  { id: "stale", rank: 2, confirms: false, when: (b, a) => Boolean(b?.revision) && a.revision !== b.revision, say: "the source has moved past the revision this binding read — the obligation is owed a re-read" },
  { id: "anomaly", rank: 3, confirms: false, when: (b, a) => Boolean(b?.digest && a.digest) && a.digest !== b.digest, say: "the source's content moved with no new revision — nothing standing changes until a person looks" },
  { id: "conflict", rank: 1, confirms: false, when: (b, a) => (a.conflicts ?? []).length > 0, say: "two accepted sources disagree on this slot — a person decides which holds" },
  { id: "implementation", rank: 4, confirms: false, when: (b, a) => a.bearing === false, say: "it describes the implementation — what the product does, never what it should do" },
  { id: "hint", rank: 5, confirms: false, when: (b, a) => a.hint === true, say: "a memory or a model's proposal — a direction to look in, never an oracle" },
  { id: "draft", rank: 6, confirms: false, when: (b, a) => a.authority !== "accepted" || !a.acceptanceRef, say: "nobody with the authority to has accepted it — it prepares tests and confirms nothing" },
  { id: "accepted", rank: 7, confirms: true, when: () => true, say: "accepted by its owner, at this revision" },
];

export const AUTHORITY_IDS = AUTHORITY.map((r) => r.id);

export const authorityRow = (id) => AUTHORITY.find((r) => r.id === id) ?? AUTHORITY[0];

export const authorityOf = (binding, answer) => AUTHORITY.find((r) => r.when(binding, answer ?? {}));

// The weakest word among an obligation's bindings; no binding at all is unknown, never accepted.
export function weakestOf(ids) {
  const rows = (ids ?? []).map(authorityRow);
  return rows.length ? rows.reduce((w, r) => (r.rank < w.rank ? r : w)) : AUTHORITY[0];
}

export const confirms = (id) => authorityRow(id).confirms === true;
