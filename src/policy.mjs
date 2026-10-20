// allow · approval · deny: whether Orbit may use a resource for one capability.
//
// A LEAF, because two places must give the same answer and neither may import
// the other: the resolver deciding what the prompt router may select
// (src/routing/select.mjs), and the gate every call to a managed MCP server
// passes (src/mcp/invoke.mjs). What the router says it would do and what a call
// is then allowed to do cannot disagree if they are one function.
//
// A policy, as a resource carries it:
//
//   { default, capabilities: { "<capability>": verdict },
//     operations: { read?: verdict, write?: verdict },
//     workflows: { "<skill>": { "<capability>": verdict } } }
//
// CAPABILITY-FIRST. A verdict is about what a resource is used FOR, never about
// which skill uses which server -- nothing here maps one to the other. A
// workflow entry is an EXCEPTION for one skill and one capability, the most
// specific rule there is, so it is asked first. An OPERATION rule is about what
// one tool call does, read from what the server says the tool is, and it can
// only ever make a call stricter.
export const VERDICTS = ["allow", "approval", "deny"];
export const OPERATIONS = ["read", "write"];
const RANK = { allow: 0, approval: 1, deny: 2 };

export const isVerdict = (v) => VERDICTS.includes(v);

export const strictest = (verdicts) => verdicts.filter(isVerdict).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "allow");

// The verdict for ONE capability: the workflow's own exception, then the
// resource's rule for that capability, then its default, then allow.
export function capabilityVerdict(policy, capability, workflow = null) {
  const exception = workflow ? policy?.workflows?.[workflow]?.[capability] : undefined;
  return [exception, policy?.capabilities?.[capability], policy?.default].find(isVerdict) ?? "allow";
}

// A call that does not say which capability it is for is held to the STRICTEST
// verdict over everything the resource provides -- never the loosest.
export const undeclaredVerdict = (policy, provides, workflow = null) => strictest((provides?.length ? provides : [null]).map((c) => capabilityVerdict(policy, c, workflow)));

// Read-only is what a server SAYS about a tool (MCP's readOnlyHint); anything
// it does not vouch for is treated as a write.
export const operationOf = (tool) => (tool?.annotations?.readOnlyHint === true ? "read" : "write");

export const operationVerdict = (policy, operation) => (isVerdict(policy?.operations?.[operation]) ? policy.operations[operation] : "allow");
