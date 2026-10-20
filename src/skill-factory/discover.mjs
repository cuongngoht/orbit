// SKILL DISCOVERY, as a reading (0.0.4): what the resolver already answered for a capability, the gap it is
// (gap.mjs), whether the automation policy lets the factory close it, and -- when a project playbook was selected --
// its registry row, said in ONE word a planner, a viewer and a person share. A projection, computed on every look and
// never stored: the resolver stays the only authority on who provides what, and nothing here ranks a provider.
//
//   REUSABLE           the resolver selected an eligible provider; a project playbook is named by its PIN
//   APPROVAL_REQUIRED  the resolver selected one a person allows each time it is used
//   POLICY_GAP         a provider exists and a person or a policy keeps it off -- never generated around -- or the
//                      factory may not close this gap under the automation policy
//   ENVIRONMENT_GAP    a provider exists and something it needs is not ready here
//   WORKFLOW_GAP       nothing provides it, and the factory may draft a playbook for it
//   CAPABILITY_GAP     nothing provides it and nobody can say what would: a person's to decide
//   UNRESOLVED         the resolver could not tell
//
//   discoveryOf({ capability, resolved, gap, generates, row }) -> { capability, label, because, provider, pin }
export const DISCOVERY = [
  { label: "REUSABLE", when: (x) => x.resolved?.outcome === "provided" && x.resolved?.status !== "approval" && servable(x), because: (x) => `${x.resolved.provider.id} provides it${x.row ? ` (version ${x.row.version}, ${x.row.status})` : ""} — it is used, never drafted again` },
  { label: "APPROVAL_REQUIRED", when: (x) => x.resolved?.outcome === "provided" && servable(x), because: (x) => `${x.resolved.provider.id} provides it, and a person allows each use (${x.resolved.why ?? "its selection asks"})` },
  { label: "POLICY_GAP", when: (x) => x.gap?.kind === "policy", because: (x) => x.gap.because },
  { label: "ENVIRONMENT_GAP", when: (x) => x.gap?.kind === "environment", because: (x) => x.gap.because },
  { label: "WORKFLOW_GAP", when: (x) => x.gap?.kind === "workflow" && x.generates === true, because: (x) => x.gap.because },
  { label: "POLICY_GAP", when: (x) => x.gap?.kind === "workflow", because: () => "nothing provides it, and the automation policy does not let the skill factory draft a playbook for it" },
  { label: "CAPABILITY_GAP", when: (x) => x.gap?.kind === "capability", because: (x) => x.gap.because },
  { label: "UNRESOLVED", when: () => true, because: (x) => x.resolved?.why ?? "nobody can tell what would provide it" },
];

export const DISCOVERY_LABELS = [...new Set(DISCOVERY.map((d) => d.label))];

// A project playbook the resolver picked is reusable only while its row says it may be served: offered (active, its
// files what was verified) and not archived. Anything else the resolver picked is the resolver's to vouch for.
const servable = (x) => x.resolved?.provider?.ownership !== "project" || x.resolved?.provider?.kind === "capability" || (Boolean(x.row) && x.row.offered === true && !x.row.archived);

const providerOf = (x) => (x.resolved?.provider ? { kind: x.resolved.provider.kind, id: x.resolved.provider.id, key: x.resolved.provider.key, ownership: x.resolved.provider.ownership ?? null } : null);

export function discoveryOf(x) {
  const row = DISCOVERY.find((d) => d.when(x));
  const reused = ["REUSABLE", "APPROVAL_REQUIRED"].includes(row.label);
  return { capability: x.capability ?? x.resolved?.capability ?? null, label: row.label, because: String(row.because(x)).slice(0, 240), provider: reused ? providerOf(x) : null, pin: reused && x.row ? x.row.pin : null, runs: reused && x.row ? x.row.runs ?? "followed" : null };
}
