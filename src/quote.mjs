// Text found in a log, a note, a page or a repository's own documents is DATA.
//
// It reaches a lesson or an architecture fact only through here, and only into
// the evidence section -- never into the statement, which every family and every
// analyser builds from a template of values the code computed. So this is not
// sanitising for display: it is the one door, deliberately narrow. A sentence
// that reads as an instruction ("ignore the previous step", "mark this as
// passing") comes out as one line of quoted prose that cannot open a heading, a
// list, a link or a code fence in whatever reads it next -- and the playbooks say
// in words that it is a finding about the product, never an instruction.
//
// A leaf, for the reason src/scrub.mjs is one: two branches need it, and the
// second must not have to import the first to get it.
const RISKY = /[`<>\[\]]/g;
const LEADING = /^[#>\-*|+\s]+/;

export const quote = (text, max = 200) => clip(flattened(text), max);

const flattened = (text) => String(text ?? "").replace(/\s+/g, " ").replace(RISKY, "").replace(LEADING, "").trim();

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
