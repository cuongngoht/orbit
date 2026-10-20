// What ONE resource looks like to anybody who asks what is usable here -- the
// prompt router and Orbit Control alike.
//
// Deliberately SMALL. A skill, an agent, an MCP server, a CLI tool and a
// capability have almost nothing in common, and forcing one schema on all five
// would be a schema nobody could fill honestly. So the common part is only what
// a question across kinds needs -- and "is it usable" is FOUR questions, kept
// apart because they have different answers:
//
//   kind · id · key · source   what it is, and who put it here. `key` is unique
//                              across the registry: two MCP servers named
//                              `github` -- one Orbit manages, one a host has --
//                              are `managed:github` and `external:github`
//   ownership                  plugin · orbit · orbit-managed · external ·
//                              catalog · project (OWNERSHIPS)
//   enabled                    somebody WANTS it: a switch, a desired state
//   runtimeReady               it could run here now, whether or not anybody
//                              wants it (an external server usually can)
//   available                  enabled AND runtimeReady: usable now
//   eligible                   available, and the resolver may consider it:
//                              its owner lets Orbit route to it, its selection
//                              is not `disabled`, its policy leaves it a use
//   selection · priority       automatic · approval · disabled, and the tie a
//                              person broke on purpose (higher first)
//   state · why                one word saying why not, and a sentence
//   routing                    provides · optional · signals · needs ·
//                              requiresSignal -- matched against requirements
//   policy                     allow · approval · deny (src/policy.mjs)
//   detail                     whatever that kind alone knows, never read across kinds
//
// Each implies the one before it: never available while not enabled, never
// eligible while not available, whichever provider built it.

export const REGISTRY_VERSION = 2;

// The families a registry answers with, and the kind each holds. Order is the
// order a person reads them in.
export const FAMILIES = [
  { family: "skills", kind: "skill", label: "skill" },
  { family: "agents", kind: "agent", label: "agent" },
  { family: "mcp", kind: "mcp", label: "MCP" },
  { family: "tools", kind: "tool", label: "CLI tool" },
  { family: "capabilities", kind: "capability", label: "capability" },
];

export const OWNERSHIPS = ["plugin", "orbit", "orbit-managed", "external", "catalog", "project"];
export const SELECTIONS = ["automatic", "approval", "disabled"];

// Why a resource is not usable, as a sentence a person can act on. A state with
// no row is shown as itself.
export const STATES = {
  ready: "ready",
  "switched-off": "switched off in the plugin settings",
  disabled: "disabled in Orbit Control",
  "not-installed": "not installed on this machine -- Orbit Control shows how",
  "needs-attention": "present, but not usable right now",
  external: "configured only in the host, which Orbit observes and never routes to -- add it to Orbit to use it",
  "not-added": "in Orbit's catalog but not added to Orbit -- Orbit Control adds it",
  unknown: "its state is unknown",
};

export const stateText = (state) => STATES[state] ?? String(state ?? "unknown");

export const labelOf = (kind) => FAMILIES.find((f) => f.kind === kind)?.label ?? kind;

const SUMMARY_LIMIT = 160;
const ALLOW_ALL = { default: "allow", capabilities: {}, operations: {}, workflows: {} };

export function resource(kind, row) {
  const enabled = row.enabled === true;
  const available = enabled && row.available === true;
  const selection = SELECTIONS.includes(row.selection) ? row.selection : "automatic";
  return { kind, id: String(row.id), key: String(row.key ?? row.id), source: row.source ?? "unknown", ownership: OWNERSHIPS.includes(row.ownership) ? row.ownership : "plugin", enabled, runtimeReady: row.runtimeReady ?? available, available, eligible: available && selection !== "disabled" && row.eligible !== false, selection, priority: Number.isInteger(row.priority) ? row.priority : 0, state: row.state ?? (enabled ? "unknown" : "disabled"), why: typeof row.why === "string" ? row.why : null, summary: clip(row.summary), routing: routingOf(row), policy: row.policy ?? ALLOW_ALL, detail: row.detail ?? {} };
}

const routingOf = (row) => ({ provides: words(row.provides), optional: words(row.optional), signals: words(row.signals), needs: words(row.needs), requiresSignal: row.requiresSignal === true });

const words = (list) => (Array.isArray(list) ? [...new Set(list.filter((w) => typeof w === "string" && w.trim()).map((w) => w.trim().toLowerCase()))] : []);

const clip = (text) => (typeof text === "string" ? text.trim().slice(0, SUMMARY_LIMIT) : "");
