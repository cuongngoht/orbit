// THE SPEC of ORBIT-GOV-004: a policy holds a call to its strictest verdict. deny stands over approval over allow; a
// workflow's own exception is asked first, then the capability's rule, the default, and allow; a call that names no
// capability is held to the strictest verdict over everything the resource provides, never the loosest; a tool is a
// read only when its server vouches for it; and an operation rule only ever makes a call stricter. Written from the
// contract (the header of src/policy.mjs, AGENTS.md "Enable is eligible-to-consider, never inject"), kept beside the
// probe and handed to no runner; it never imports the subject. Both directions are checked: a policy that allows
// everything fails as surely as one that denies everything.
//
// The fixed rows carry answers written by hand; the seeded rows -- verdicts at random, and policies, capabilities,
// workflows and tools at random -- are answered by the reference model, which selfTest holds to every answer written
// by hand.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the rows written by hand from the contract
export const CASE = "ORBIT-GOV-004";

export const GROUPS = {
  "verdict-order": "of several verdicts the strictest stands -- deny over approval over allow; what is not a verdict counts for nothing, and nothing at all is allow",
  "workflow-exception": "a workflow's own exception for one capability is the most specific rule and is asked first, whether it is looser or stricter",
  "capability-rule": "the resource's rule for the capability comes next, before its default",
  "default-then-allow": "with no rule for the capability the resource's default decides, and with no default, allow",
  "not-a-verdict": "a rule or a default that is not one of allow, approval and deny is no rule: the next one decides",
  "undeclared-strictest": "a call that names no capability is held to the strictest verdict over everything the resource provides, never the loosest",
  "operation-of-tool": "a tool is a read only when its server says it is read-only; anything it does not vouch for is a write",
  "operation-verdict": "an operation rule answers for a read or a write, and with no rule that is a verdict, allow",
  "operation-only-stricter": "a call is held to the strictest of its capability verdict and its operation's rule: an operation rule only ever makes it stricter",
  "seeded-verdicts": "verdicts at random: the strictest of them",
  "seeded-call": "policies, capabilities, workflows and tools at random: the verdict the call is held to",
};

// ---- the reference model: the policy, as the contract states it -----------------------------------------------------

// The verdicts, loosest first.
const ORDER = ["allow", "approval", "deny"];

const isVerdict = (v) => ORDER.includes(v);

export const strictestOf = (verdicts) => (verdicts ?? []).filter(isVerdict).reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "allow");

export const capabilityFor = (policy, capability, workflow) => [workflow ? policy?.workflows?.[workflow]?.[capability] : undefined, policy?.capabilities?.[capability], policy?.default].find(isVerdict) ?? "allow";

export const undeclaredFor = (policy, provides, workflow) => strictestOf((provides?.length ? provides : [null]).map((c) => capabilityFor(policy, c, workflow)));

export const operationFor = (tool) => (tool?.annotations?.readOnlyHint === true ? "read" : "write");

export const operationRuleFor = (policy, operation) => (isVerdict(policy?.operations?.[operation]) ? policy.operations[operation] : "allow");

const askedFor = (i) => (typeof i.capability === "string" ? capabilityFor(i.policy, i.capability, i.workflow ?? null) : undeclaredFor(i.policy, i.provides, i.workflow ?? null));

export const callFor = (i) => strictestOf([askedFor(i), operationRuleFor(i.policy, operationFor(i.tool))]);

// ---- the checks written by hand ------------------------------------------------------------------------------------

const answered = (group, input, want) => ({ group, input, expect: { exactly: [want] } });

const POLICY = { default: "approval", capabilities: { "docs.search": "allow", "docs.write": "deny", "repo.read": "approval", "repo.write": "deny" }, operations: { write: "approval" }, workflows: { "orbit-code-review": { "docs.write": "allow", "docs.search": "deny" } } };

const READ = { name: "get_page", annotations: { readOnlyHint: true } };
const WRITE = { name: "put_page", annotations: { readOnlyHint: false } };

const verdicts = (list, want) => answered("verdict-order", { call: "strictest", verdicts: list }, want);

const asked = (group, policy, capability, workflow, want) => answered(group, { call: "capability", policy, capability, ...(workflow ? { workflow } : {}) }, want);

const undeclared = (policy, provides, workflow, want) => answered("undeclared-strictest", { call: "undeclared", policy, ...(provides ? { provides } : {}), ...(workflow ? { workflow } : {}) }, want);

const operation = (tool, want) => answered("operation-of-tool", tool === undefined ? { call: "operation" } : { call: "operation", tool }, want);

const operationRule = (policy, op, want) => answered("operation-verdict", { call: "operation-verdict", policy, operation: op }, want);

const held = (policy, asks, tool, want) => answered("operation-only-stricter", { call: "call", policy, ...asks, tool }, want);

const VERDICT_ROWS = [
  verdicts([], "allow"), verdicts(["allow"], "allow"), verdicts(["approval"], "approval"), verdicts(["deny"], "deny"),
  verdicts(["allow", "approval"], "approval"), verdicts(["approval", "allow"], "approval"), verdicts(["approval", "deny"], "deny"), verdicts(["deny", "approval"], "deny"),
  verdicts(["allow", "deny", "approval"], "deny"), verdicts(["approval", "approval"], "approval"), verdicts(["allow", "allow"], "allow"),
  verdicts(["maybe", "approval"], "approval"), verdicts([null, "", "DENIED", 2], "allow"), verdicts(["deny", "maybe"], "deny"),
];

const RULE_ROWS = [
  asked("workflow-exception", POLICY, "docs.write", "orbit-code-review", "allow"),
  asked("workflow-exception", POLICY, "docs.search", "orbit-code-review", "deny"),
  asked("workflow-exception", POLICY, "repo.read", "orbit-code-review", "approval"),
  asked("workflow-exception", POLICY, "docs.write", "orbit-release", "deny"),
  asked("workflow-exception", POLICY, "tickets.read", "orbit-code-review", "approval"),
  asked("workflow-exception", { default: "deny", workflows: { "orbit-triage": { "tickets.read": "allow" } } }, "tickets.read", "orbit-triage", "allow"),
  asked("capability-rule", POLICY, "docs.search", null, "allow"),
  asked("capability-rule", POLICY, "docs.write", null, "deny"),
  asked("capability-rule", POLICY, "repo.read", null, "approval"),
  asked("capability-rule", { default: "deny", capabilities: { "tickets.read": "allow" } }, "tickets.read", null, "allow"),
  asked("default-then-allow", POLICY, "tickets.read", null, "approval"),
  asked("default-then-allow", { default: "deny" }, "anything.at.all", null, "deny"),
  asked("default-then-allow", { capabilities: { "docs.search": "deny" } }, "tickets.read", null, "allow"),
  asked("default-then-allow", {}, "tickets.read", null, "allow"),
  asked("default-then-allow", null, "tickets.read", null, "allow"),
  asked("not-a-verdict", { default: "deny", capabilities: { "tickets.read": "maybe" } }, "tickets.read", null, "deny"),
  asked("not-a-verdict", { capabilities: { "tickets.read": "approval" }, workflows: { "orbit-triage": { "tickets.read": "sometimes" } } }, "tickets.read", "orbit-triage", "approval"),
  asked("not-a-verdict", { default: "never" }, "tickets.read", null, "allow"),
  asked("not-a-verdict", { default: "approval", capabilities: { "tickets.read": "" } }, "tickets.read", null, "approval"),
  asked("not-a-verdict", { default: null, capabilities: { "tickets.read": null } }, "tickets.read", null, "allow"),
];

const UNDECLARED_ROWS = [
  undeclared(POLICY, ["docs.search", "docs.write"], null, "deny"),
  undeclared(POLICY, ["docs.search", "repo.read"], null, "approval"),
  undeclared(POLICY, ["repo.read", "docs.write"], null, "deny"),
  undeclared(POLICY, ["docs.write", "repo.read"], null, "deny"),
  undeclared(POLICY, ["docs.search"], null, "allow"),
  undeclared(POLICY, [], null, "approval"),
  undeclared(POLICY, null, null, "approval"),
  undeclared({ default: "deny" }, [], null, "deny"),
  undeclared(POLICY, ["docs.search", "repo.read"], "orbit-code-review", "deny"),
  undeclared(POLICY, ["docs.write", "repo.read"], "orbit-code-review", "approval"),
  undeclared({ capabilities: { "docs.search": "allow", "tickets.read": "allow" } }, ["docs.search", "tickets.read"], null, "allow"),
];

const OPERATION_ROWS = [
  operation(READ, "read"),
  operation({ name: "get_page", annotations: { readOnlyHint: true, destructiveHint: false } }, "read"),
  operation(WRITE, "write"),
  operation({ name: "append_row", annotations: { destructiveHint: false } }, "write"),
  operation({ name: "put_page", annotations: {} }, "write"),
  operation({ name: "put_page" }, "write"),
  operation({ name: "get_page", readOnlyHint: true }, "write"),
  operation(null, "write"),
  operation(undefined, "write"),
  operationRule(POLICY, "write", "approval"),
  operationRule(POLICY, "read", "allow"),
  operationRule({ operations: { read: "deny" } }, "read", "deny"),
  operationRule({ operations: { write: "deny", read: "approval" } }, "read", "approval"),
  operationRule({ operations: { write: "maybe" } }, "write", "allow"),
  operationRule({}, "write", "allow"),
];

const CALL_ROWS = [
  held(POLICY, { capability: "docs.search" }, WRITE, "approval"),
  held(POLICY, { capability: "docs.search" }, READ, "allow"),
  held(POLICY, { capability: "docs.write" }, READ, "deny"),
  held(POLICY, { capability: "repo.read" }, WRITE, "approval"),
  held({ capabilities: { "tickets.read": "approval" }, operations: { write: "deny" } }, { capability: "tickets.read" }, WRITE, "deny"),
  held({ capabilities: { "tickets.read": "deny" }, operations: { write: "approval" } }, { capability: "tickets.read" }, WRITE, "deny"),
  held({ capabilities: { "tickets.read": "allow" }, operations: { read: "deny" } }, { capability: "tickets.read" }, READ, "deny"),
  held({ capabilities: { "tickets.read": "deny" }, operations: { read: "allow" } }, { capability: "tickets.read" }, READ, "deny"),
  held(POLICY, { provides: ["docs.search", "repo.read"] }, WRITE, "approval"),
  held({ default: "approval", operations: { write: "deny" } }, { provides: [] }, { name: "run_sql" }, "deny"),
  held(POLICY, { capability: "docs.write", workflow: "orbit-code-review" }, WRITE, "approval"),
];

const FIXED = [...VERDICT_ROWS, ...RULE_ROWS, ...UNDECLARED_ROWS, ...OPERATION_ROWS, ...CALL_ROWS];

// ---- a seeded generator, the same policies for the same seed ----------------------------------------------------------

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

// Verdicts as policies hold them: the three, and now and then something that is not one.
const WORDS = ["allow", "approval", "deny", "allow", "approval", "deny", "approval", "deny", "maybe", ""];

const CAPABILITIES = ["docs.search", "docs.write", "repo.read", "repo.write", "tickets.read"];

const seededVerdicts = (r) => ((list) => answered("seeded-verdicts", { call: "strictest", verdicts: list }, strictestOf(list)))(Array.from({ length: Math.floor(r() * 6) }, () => pick(r, [...WORDS, null])));

const rules = (r, p) => Object.fromEntries(CAPABILITIES.filter(() => r() < p).map((c) => [c, pick(r, WORDS)]));

const sometimes = (r, key, value) => (r() < 0.6 ? { [key]: value } : {});

const seededPolicy = (r) => ({ ...sometimes(r, "default", pick(r, WORDS)), capabilities: rules(r, 0.6), ...sometimes(r, "operations", { ...sometimes(r, "read", pick(r, WORDS)), ...sometimes(r, "write", pick(r, WORDS)) }), workflows: { "orbit-code-review": rules(r, 0.3) } });

const seededAsk = (r) => (r() < 0.6 ? { capability: pick(r, CAPABILITIES) } : { provides: CAPABILITIES.filter(() => r() < 0.4) });

const TOOLS = [READ, WRITE, { name: "run_sql" }, { name: "append_row", annotations: { destructiveHint: false } }];

const seededCall = (r) => ((input) => answered("seeded-call", input, callFor(input)))({ call: "call", policy: seededPolicy(r), ...seededAsk(r), ...sometimes(r, "workflow", pick(r, ["orbit-code-review", "orbit-release"])), tool: pick(r, TOOLS) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(8, Math.floor(samples / 3)) }, () => seededVerdicts(r)), ...Array.from({ length: Math.max(16, samples) }, () => seededCall(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["deny is stricter than approval", strictestOf(["approval", "deny"]), "deny"],
  ["approval is stricter than allow", strictestOf(["allow", "approval"]), "approval"],
  ["nothing at all is allow", strictestOf([]), "allow"],
  ["a workflow's exception is asked first, even when it loosens", capabilityFor(POLICY, "docs.write", "orbit-code-review"), "allow"],
  ["a capability's rule comes before the default", capabilityFor(POLICY, "docs.search", null), "allow"],
  ["the default decides when nothing else does", capabilityFor(POLICY, "tickets.read", null), "approval"],
  ["an undeclared call is held to the strictest it could be", undeclaredFor(POLICY, ["repo.read", "docs.write"], null), "deny"],
  ["a tool nobody vouched for is a write", operationFor({ name: "x" }), "write"],
  ["an operation rule never loosens a call", callFor({ policy: { capabilities: { x: "deny" }, operations: { read: "allow" } }, capability: "x", tool: READ }), "deny"],
];

const answerOf = (i) => ({ strictest: () => strictestOf(i.verdicts), capability: () => capabilityFor(i.policy, i.capability, i.workflow ?? null), undeclared: () => undeclaredFor(i.policy, i.provides, i.workflow ?? null), operation: () => operationFor(i.tool), "operation-verdict": () => operationRuleFor(i.policy, i.operation), call: () => callFor(i) })[i.call]();

const handFindings = () => HAND.filter(([, got, want]) => got !== want).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

const fixedFindings = () => FIXED.filter((c) => answerOf(c.input) !== c.expect.exactly[0]).map((c) => `the reference model disagrees with a row written by hand in ${c.group}: ${JSON.stringify(c.input).slice(0, 200)}`);

export const selfTest = () => [...handFindings(), ...fixedFindings()];
