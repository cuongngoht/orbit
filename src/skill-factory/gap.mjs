// What KIND of gap a capability nobody provides is -- an ordered table over what the resolver answered
// (src/knowledge/verify.mjs OUTCOMES, handed in as data), the first row deciding. Exactly ONE row may lead to
// generating anything: a WORKFLOW gap, where nothing provides the capability at all. And even then what is
// generated is held, at registration, to every need it declares being PROVIDED here
// (src/skill-factory/validate.mjs SF_NEED_UNPROVIDED): a playbook that would need a connector, a tool or a
// switch nobody turned on is refused, and that gap stays a capability gap a person decides.
//
//   policy       a provider exists and a person or a policy keeps it off: never generated around
//   environment  a provider exists but something it needs is not ready here
//   capability   nobody can tell what would provide it
//   workflow     nothing provides it: the factory may draft a playbook, under the automation policy
//
// Each row also carries the WORD a planner and a viewer say (1.8.6): NO_GAP, PERMISSION_GAP, ENVIRONMENT_GAP,
// CAPABILITY_GAP, and -- for the one generating kind -- the word of its SHAPE (below). A word is a reading of
// the row, never a second row: a composition or a verification gap is still the one workflow gap.
export const GAP_KINDS = [
  { kind: null, word: () => "NO_GAP", when: (r) => r?.outcome === "provided", generates: false, because: () => "provided" },
  { kind: "policy", word: () => "PERMISSION_GAP", when: (r) => r?.outcome === "decision", generates: false, because: (r) => `${r.why} — a person's decision; nothing is generated around it` },
  { kind: "policy", word: () => "PERMISSION_GAP", when: (r) => r?.outcome === "gap" && r.remedy === "enable", generates: false, because: (r) => `${r.why} — a switched-off provider is never replaced by a generated one` },
  { kind: "environment", word: () => "ENVIRONMENT_GAP", when: (r) => r?.outcome === "impaired", generates: false, because: (r) => r.why },
  { kind: "workflow", word: (shape) => shapeRow(shape).word, when: (r) => r?.outcome === "gap" && r.remedy === "prepare", generates: true, because: () => "nothing here provides it: a playbook may be drafted, held to every need it declares being provided" },
  { kind: "capability", word: () => "CAPABILITY_GAP", when: () => true, generates: false, because: (r) => r?.why ?? "nobody can tell what would provide it" },
];

// What a playbook drafted for a workflow gap IS, read off the capability's own words and what it composes --
// never a model's guess. An ordered table, the last always matching:
//
//   verification   the capability names a check (…verification, …review, …gate): every step of the playbook
//                  names the record a listed Orbit command reads, and it ends with what still needs a person
//   composition    it composes more than one capability that IS provided here, in order
//   procedure      a reusable procedure over what is provided here
export const SHAPES = [
  { id: "verification", word: "VERIFICATION_GAP", when: (cap) => /\.(verification|verify|review|check|checks|gate|audit|validation)$/.test(String(cap ?? "")), evidence: "owner-record", say: "each check names the record a listed Orbit command reads, and it ends with what still needs a person" },
  { id: "composition", word: "COMPOSITION_GAP", when: (cap, needs) => needs.length > 1, evidence: "report", say: "it composes the provided capabilities it needs, in order, and says which one each step used" },
  { id: "procedure", word: "WORKFLOW_GAP", when: () => true, evidence: "report", say: "a procedure over what is provided here, step by step, ending with what still needs a person" },
];

export const SHAPE_IDS = SHAPES.map((s) => s.id);

export const shapeRow = (id) => SHAPES.find((s) => s.id === id) ?? SHAPES.at(-1);

export const shapeOf = (capability, needs = []) => SHAPES.find((s) => s.when(capability, needs)).id;

// `needs`: the capabilities a playbook for it would compose, when the caller knows them (the planner does).
export function gapOf(resolved, needs = []) {
  const row = GAP_KINDS.find((g) => g.when(resolved));
  const shape = row.generates ? shapeOf(resolved?.capability, needs) : null;
  return { kind: row.kind, word: row.word(shape), generates: row.generates, because: row.because(resolved), shape };
}
