// THE SPEC of ORBIT-SAT-003: what every consumer of a Satellite handoff must decide before it relies on one, written from
// the contract and never from the code. Kept beside the probe and handed to no runner; the controller imports a FROZEN
// copy of it, and it never imports the subject. A handoff is published immutably with a digest; a consumer reads it back
// and holds it to an ordered table -- read back at all, the very handoff that was published, handed to this consumer,
// inside its scope, compatible, fresh, and true to its own output contract -- and the first row that fails is the
// answer. Every check expects exactly that one rule, or nothing.
//
// The digest is never computed here: an input says how the record stands against what was published (sealed as it
// was published, changed afterwards, changed and digested again, published under another digest, or carrying none),
// and the probe seals it with the subject's own digest function -- so these checks are about the consumer's rule, never
// about how a digest is spelled. Seeded handoffs break the rules at random over one that holds them all.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-SAT-003";

export const GROUPS = {
  "intact-consumed": "a handoff read back as it was published, handed to the consumer, inside its scope, compatible, fresh and true to its contract is relied on: nothing is reported",
  "edited-after-publishing": "a handoff changed after it was published is HOF_DIGEST, whether or not its digest was computed again over the change",
  "published-digest-differs": "a handoff whose journal line names another digest than the one it carries, or that carries none, is HOF_DIGEST",
  "missing": "a handoff that could not be read back as an object is HOF_MISSING",
  "not-handed": "a handoff that names the consumer nowhere, that the consumer does not name and whose source unit it does not depend on, is HOF_TARGET",
  "scope-outside": "a consumer path outside every path the handoff covers is HOF_SCOPE",
  "scope-sibling-prefix": "a consumer path that only shares a prefix with a covered path (src/app and src/application) is outside it: HOF_SCOPE",
  "scope-within": "a consumer path equal to a covered path or under it as a directory, with or without a trailing slash on the covered path, is inside it",
  "compatibility": "a consumer that accepts shapes and not the handoff's is HOF_COMPATIBILITY; one that accepts nothing in particular takes any",
  "freshness": "a source unit reset after the handoff was published, or a checkout head that moved since, is HOF_FRESHNESS; a reset before it, or a head nobody knows, is fresh",
  "contract-unmet": "a field the handoff's own output contract names, left empty, is HOF_CONTRACT",
  "first-broken-rule": "a handoff that breaks several rules is refused on the first of them in the table's order",
  "seeded-handoff": "seeded handoffs and consumers, rules broken at random: exactly the first rule broken, or nothing",
};

const PUBLISHED_AT = 40;

const HEAD = "c0ffee1234";

const HANDOFF = { api: "orbit.satellite.handoff/v1", id: "hof-1", missionId: "msn-0000000000a1", sourceAgentRunId: "arn-1", sourceUnitId: "wu-1", targetWorkUnitIds: ["wu-2"], sourceRevision: 39, sourceTree: { head: HEAD, digest: "t1" }, artifactPins: ["design-note:1.0.0:aaaaaaaa"], scope: { paths: ["src/app"], subjects: [] }, findings: [{ say: "the consumer drops the event", refs: ["file:src/app/consumer.mjs"] }], remainingUnknowns: [], evidenceRefs: ["file:src/app/consumer.mjs"], outputContract: { shape: "findings", fields: ["findings"] }, proposes: null };

const CONSUMER = { id: "wu-2", dependencyIds: ["wu-1"], inputArtifactRefs: [], scope: { paths: ["src/app/consumer.mjs"], subjects: [] }, inputContract: { accepts: ["findings"] } };

const record = (over = {}) => ({ ...HANDOFF, ...over });

const consumer = (over = {}) => ({ ...CONSUMER, ...over });

const paths = (...list) => ({ paths: list, subjects: [] });

// One consumption: the record, how it stands against what was published, the consumer, the source unit's last reset
// and the checkout now.
const consume = (o = {}) => ({ call: "consume", record: o.record === undefined ? record() : o.record, seal: o.seal ?? "published", edit: o.edit ?? null, reseal: o.reseal === true, journal: o.journal ?? "same", unit: o.unit ?? consumer(), published: { id: "hof-1", n: PUBLISHED_AT }, units: [{ id: "wu-1", resetAt: o.resetAt ?? 7 }], tree: o.tree === undefined ? { head: HEAD } : o.tree });

// Changes made after publishing: each moves a field the digest covers, and none bears on another rule.
const EDITS = [{ remainingUnknowns: ["whether the consumer retries"] }, { sourceRevision: 41 }, { proposes: { change: "move the retry into the consumer" } }, { findings: [{ say: "nothing is dropped", refs: [] }] }, { sourceAgentRunId: "arn-9" }];

// ---- the reference model: the ordered table, as the contract words it --------------------------------------------------

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const listOf = (v) => (Array.isArray(v) ? v : []);

const bareRoot = (root) => root.replace(/\/+$/, "");

// A path is inside a covered path when it IS that path or lies under it as a directory.
const within = (path, roots) => roots.some((root) => path === bareRoot(root) || path.startsWith(`${bareRoot(root)}/`));

const intact = (i) => i.seal !== "none" && i.edit === null && i.journal === "same";

const FIELD = { findings: (h) => h.findings, evidenceRefs: (h) => h.evidenceRefs, artifacts: (h) => h.artifactPins };

const resetOf = (i) => i.units.find((x) => x.id === i.record.sourceUnitId)?.resetAt ?? -1;

const moved = (i) => Boolean(i.record.sourceTree?.head) && Boolean(i.tree?.head) && i.record.sourceTree.head !== i.tree.head;

const RULES = [
  ["HOF_MISSING", (i) => !isObject(i.record)],
  ["HOF_DIGEST", (i) => !intact(i)],
  ["HOF_TARGET", (i) => !listOf(i.record.targetWorkUnitIds).includes(i.unit.id) && !listOf(i.unit.inputArtifactRefs).includes(i.record.id) && !listOf(i.unit.dependencyIds).includes(i.record.sourceUnitId)],
  ["HOF_SCOPE", (i) => listOf(i.record.scope?.paths).length > 0 && listOf(i.unit.scope?.paths).some((p) => !within(p, i.record.scope.paths))],
  ["HOF_COMPATIBILITY", (i) => listOf(i.unit.inputContract?.accepts).length > 0 && !i.unit.inputContract.accepts.includes(i.record.outputContract?.shape)],
  ["HOF_FRESHNESS", (i) => resetOf(i) > i.published.n || moved(i)],
  ["HOF_CONTRACT", (i) => listOf(i.record.outputContract?.fields).some((f) => listOf(FIELD[f](i.record)).length === 0)],
];

// The first rule the consumption breaks, or null.
export const ruleOf = (i) => RULES.find(([, fails]) => fails(i))?.[0] ?? null;

const expectOf = (rule) => ({ exactly: rule ? [rule] : [] });

// ---- the checks written by hand: a consumption -> the rule it breaks first, or none ------------------------------------

const UNNAMED = consumer({ dependencyIds: [], inputArtifactRefs: [] });

const HAND = [
  ["intact-consumed", consume(), null],
  ["intact-consumed", consume({ unit: UNNAMED }), null],
  ["intact-consumed", consume({ record: record({ targetWorkUnitIds: [] }), unit: consumer({ dependencyIds: [], inputArtifactRefs: ["hof-1"] }) }), null],
  ["intact-consumed", consume({ record: record({ targetWorkUnitIds: [] }) }), null],
  ["intact-consumed", consume({ record: record({ outputContract: { shape: "design", fields: ["findings", "evidenceRefs", "artifacts"] } }), unit: consumer({ inputContract: { accepts: ["design", "findings"] } }) }), null],
  ["intact-consumed", consume({ record: record({ scope: paths() }), unit: consumer({ scope: paths("lib/elsewhere.mjs") }) }), null],
  ["intact-consumed", consume({ unit: consumer({ scope: paths() }) }), null],
  ["edited-after-publishing", consume({ edit: EDITS[0] }), "HOF_DIGEST"],
  ["edited-after-publishing", consume({ edit: EDITS[1] }), "HOF_DIGEST"],
  ["edited-after-publishing", consume({ edit: EDITS[0], reseal: true }), "HOF_DIGEST"],
  ["edited-after-publishing", consume({ edit: EDITS[1], reseal: true }), "HOF_DIGEST"],
  ["edited-after-publishing", consume({ edit: EDITS[2], reseal: true }), "HOF_DIGEST"],
  ["edited-after-publishing", consume({ edit: EDITS[3], reseal: true }), "HOF_DIGEST"],
  ["edited-after-publishing", consume({ edit: EDITS[4], reseal: true }), "HOF_DIGEST"],
  ["edited-after-publishing", consume({ edit: { targetWorkUnitIds: ["wu-2", "wu-3"] }, reseal: true }), "HOF_DIGEST"],
  ["published-digest-differs", consume({ journal: "other" }), "HOF_DIGEST"],
  ["published-digest-differs", consume({ journal: "other", unit: UNNAMED }), "HOF_DIGEST"],
  ["published-digest-differs", consume({ seal: "none" }), "HOF_DIGEST"],
  ["missing", consume({ record: null }), "HOF_MISSING"],
  ["missing", consume({ record: "not a handoff" }), "HOF_MISSING"],
  ["missing", consume({ record: [HANDOFF] }), "HOF_MISSING"],
  ["not-handed", consume({ record: record({ targetWorkUnitIds: ["wu-3"] }), unit: UNNAMED }), "HOF_TARGET"],
  ["not-handed", consume({ record: record({ targetWorkUnitIds: [] }), unit: consumer({ dependencyIds: ["wu-5"] }) }), "HOF_TARGET"],
  ["not-handed", consume({ record: record({ targetWorkUnitIds: [] }), unit: consumer({ dependencyIds: [], inputArtifactRefs: ["hof-2"] }) }), "HOF_TARGET"],
  ["scope-outside", consume({ unit: consumer({ scope: paths("lib/other.mjs") }) }), "HOF_SCOPE"],
  ["scope-outside", consume({ unit: consumer({ scope: paths("src/app/consumer.mjs", "docs/readme.md") }) }), "HOF_SCOPE"],
  ["scope-outside", consume({ record: record({ scope: paths("src/app/handlers") }) }), "HOF_SCOPE"],
  ["scope-sibling-prefix", consume({ unit: consumer({ scope: paths("src/application/main.mjs") }) }), "HOF_SCOPE"],
  ["scope-sibling-prefix", consume({ unit: consumer({ scope: paths("src/app-old/consumer.mjs") }) }), "HOF_SCOPE"],
  ["scope-sibling-prefix", consume({ unit: consumer({ scope: paths("src/apple.mjs") }) }), "HOF_SCOPE"],
  ["scope-sibling-prefix", consume({ record: record({ scope: paths("docs/guide") }), unit: consumer({ scope: paths("docs/guidebook.md") }) }), "HOF_SCOPE"],
  ["scope-sibling-prefix", consume({ record: record({ scope: paths("src/api", "src/app") }), unit: consumer({ scope: paths("src/apps/router.mjs") }) }), "HOF_SCOPE"],
  ["scope-sibling-prefix", consume({ record: record({ scope: paths("src/app/") }), unit: consumer({ scope: paths("src/app-old/consumer.mjs") }) }), "HOF_SCOPE"],
  ["scope-within", consume({ unit: consumer({ scope: paths("src/app") }) }), null],
  ["scope-within", consume({ record: record({ scope: paths("src/app/") }) }), null],
  ["scope-within", consume({ unit: consumer({ scope: paths("src/app/a/b/c.mjs") }) }), null],
  ["scope-within", consume({ record: record({ scope: paths("src/api", "src/app") }), unit: consumer({ scope: paths("src/api/routes.mjs", "src/app/consumer.mjs") }) }), null],
  ["compatibility", consume({ unit: consumer({ inputContract: { accepts: ["design"] } }) }), "HOF_COMPATIBILITY"],
  ["compatibility", consume({ unit: consumer({ inputContract: { accepts: ["review", "verification"] } }) }), "HOF_COMPATIBILITY"],
  ["compatibility", consume({ unit: consumer({ inputContract: { accepts: [] } }) }), null],
  ["compatibility", consume({ unit: consumer({ inputContract: { accepts: ["review", "findings"] } }) }), null],
  ["freshness", consume({ resetAt: 41 }), "HOF_FRESHNESS"],
  ["freshness", consume({ tree: { head: "deadbeef00" } }), "HOF_FRESHNESS"],
  ["freshness", consume({ resetAt: 39 }), null],
  ["freshness", consume({ tree: null }), null],
  ["freshness", consume({ record: record({ sourceTree: null }), tree: { head: "deadbeef00" } }), null],
  ["contract-unmet", consume({ record: record({ findings: [] }) }), "HOF_CONTRACT"],
  ["contract-unmet", consume({ record: record({ evidenceRefs: [], outputContract: { shape: "findings", fields: ["evidenceRefs"] } }) }), "HOF_CONTRACT"],
  ["contract-unmet", consume({ record: record({ artifactPins: [], outputContract: { shape: "findings", fields: ["findings", "artifacts"] } }) }), "HOF_CONTRACT"],
  ["first-broken-rule", consume({ edit: EDITS[2], reseal: true, record: record({ targetWorkUnitIds: [] }), unit: UNNAMED }), "HOF_DIGEST"],
  ["first-broken-rule", consume({ record: record({ targetWorkUnitIds: [] }), unit: consumer({ dependencyIds: [], scope: paths("lib/other.mjs") }) }), "HOF_TARGET"],
  ["first-broken-rule", consume({ unit: consumer({ scope: paths("src/application/x.mjs"), inputContract: { accepts: ["design"] } }) }), "HOF_SCOPE"],
  ["first-broken-rule", consume({ unit: consumer({ inputContract: { accepts: ["design"] } }), resetAt: 45 }), "HOF_COMPATIBILITY"],
  ["first-broken-rule", consume({ record: record({ findings: [] }), tree: { head: "deadbeef00" } }), "HOF_FRESHNESS"],
];

const FIXED = HAND.map(([group, input, rule]) => ({ group, input, expect: expectOf(rule) }));

// ---- a seeded generator, the same handoffs for the same seed -----------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const OUTSIDE = ["lib/other.mjs", "src/application/main.mjs", "src/app-old/consumer.mjs", "src/apple.mjs", "docs/guidebook.md"];

const INSIDE = ["src/app/consumer.mjs", "src/app/handlers/retry.mjs", "src/app/a/b.mjs"];

// A handoff that holds every rule, varied where the variation changes nothing.
const base = (r) => ({ record: record({ scope: paths(...pick(r, [["src/app"], ["src/app/"], ["src/app", "docs/guide"]])), outputContract: { shape: "findings", fields: pick(r, [["findings"], ["findings", "evidenceRefs"], ["artifacts"]]) } }), unit: consumer({ scope: paths(pick(r, INSIDE)), inputContract: { accepts: pick(r, [[], ["findings"], ["design", "findings"]]) } }), resetAt: Math.floor(r() * PUBLISHED_AT) });

const BREAKS = [
  (r, o) => pick(r, [{ ...o, edit: pick(r, EDITS), reseal: r() < 0.6 }, { ...o, journal: "other" }, { ...o, seal: "none" }]),
  (r, o) => ({ ...o, record: { ...o.record, targetWorkUnitIds: ["wu-7"] }, unit: { ...o.unit, dependencyIds: ["wu-6"], inputArtifactRefs: [] } }),
  (r, o) => ({ ...o, unit: { ...o.unit, scope: paths(pick(r, INSIDE), pick(r, OUTSIDE)) } }),
  (r, o) => ({ ...o, unit: { ...o.unit, inputContract: { accepts: [pick(r, ["design", "review", "verification"])] } } }),
  (r, o) => (r() < 0.5 ? { ...o, resetAt: PUBLISHED_AT + 1 + Math.floor(r() * 20) } : { ...o, tree: { head: "deadbeef00" } }),
  (r, o) => ({ ...o, record: { ...o.record, findings: [], evidenceRefs: [], artifactPins: [] } }),
];

const broken = (r, o) => BREAKS.reduce((acc, change) => (r() < 0.22 ? change(r, acc) : acc), o);

const seededHandoff = (r) => ((input) => ({ group: "seeded-handoff", input, expect: expectOf(ruleOf(input)) }))(consume(broken(r, base(r))));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seededHandoff(r))]);
}

// ---- the reference model, held to what the contract says in words ------------------------------------------------------

export const selfTest = () => HAND.filter(([, input, rule]) => ruleOf(input) !== rule).map(([group, input]) => `the reference model disagrees with the contract on ${group}: ${JSON.stringify(input).slice(0, 160)}`);
