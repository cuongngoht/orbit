// What a contract's DST policy makes of one wall time. A wall names one instant, none (a
// spring-forward gap) or two (a fall-back overlap); the POLICY -- declared by the accepted
// contract, never assumed -- says which occurrences that is:
//
//   dst.gap      skip            the occurrence does not happen that day (reported as skipped)
//                shift-forward   it happens at the same wall time shifted by the gap (02:30 → 03:30)
//   dst.overlap  first           it happens once, at the earlier of the two instants
//                both            it happens at each of them
//
// With no policy declared the entry is UNRESOLVED: it carries its candidate instants, is flagged
// "dst-policy-unknown", and decides nothing.
export const DST_GAP = ["skip", "shift-forward"];
export const DST_OVERLAP = ["first", "both"];

const KINDS = [
  { kind: "normal", when: (n) => n === 1 },
  { kind: "gap", when: (n) => n === 0 },
  { kind: "overlap", when: () => true },
];

const GAP = {
  skip: (c) => [{ instant: null, skipped: "dst-gap", near: c.zone.gapShift(c.wall), flags: ["dst-gap-skipped"] }],
  "shift-forward": (c) => [{ instant: c.zone.gapShift(c.wall), flags: ["dst-gap-shifted"] }],
  unknown: (c) => [{ instant: null, candidates: [c.zone.gapShift(c.wall)], flags: ["dst-gap", "dst-policy-unknown"] }],
};

const OVERLAP = {
  first: (c) => [{ instant: c.instants[0], flags: ["dst-overlap-first"] }],
  both: (c) => c.instants.map((instant, i) => ({ instant, flags: [i ? "dst-overlap-second" : "dst-overlap-first"] })),
  unknown: (c) => [{ instant: null, candidates: c.instants, flags: ["dst-overlap", "dst-policy-unknown"] }],
};

const RESOLVE = {
  normal: (c) => [{ instant: c.instants[0], flags: [] }],
  gap: (c) => GAP[c.dst.gap ?? "unknown"](c),
  overlap: (c) => OVERLAP[c.dst.overlap ?? "unknown"](c),
};

export function resolveWall(wall, zone, dst) {
  const instants = zone.instants(wall);
  const kind = KINDS.find((k) => k.when(instants.length)).kind;
  return RESOLVE[kind]({ wall, zone, dst: dst ?? {}, instants }).map((e) => ({ ...e, wall }));
}
