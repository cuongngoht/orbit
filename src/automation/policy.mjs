// What a coordinated workflow may do on its own, per ACTION CLASS -- as data, combined with the verdict a resource
// already carries (src/policy.mjs) through `strictest`, so automation can only ever make a step STRICTER than the
// resource's own policy says. A resource that is denied stays denied, whatever any setting says.
//
// Orbit is AUTONOMOUS BY DEFAULT (0.2.0): every class a workflow takes itself is `allow`, the classes a task's owner
// carries out are `owner` (autonomous through that owner's own steps), and a person is asked only at the PROTECTED
// BOUNDARIES -- rows DERIVED from src/protected/boundaries.mjs, so the matrix Orbit Control shows can never say
// something the boundary table does not. Two classes stay `deny` because nobody can approve them: running code a model
// wrote on this machine, and reading a secret's value.
//
//   default     the verdict with no setting narrowing it
//   narrowedBy  the effective setting that moves it
//   maps        the coordinator's step kinds and actions it governs. A protected or never class maps to nothing a
//               workflow takes itself: a protected boundary is crossed only as an owner's own action (an engineering
//               task's push, its capability call), approved once for exactly that action in Orbit Control
import { strictest } from "../policy.mjs";
import { BOUNDARIES, DECISIONS } from "../protected/boundaries.mjs";

const protectedClass = (b) => ({ id: `protected:${b.id.toLowerCase().replace(/_/g, "-")}`, default: b.decision === DECISIONS.DENY ? "deny" : "approval", narrowedBy: null, maps: [], boundary: b.id, say: `${b.title}: ${b.say}` });

export const ACTION_CLASSES = [
  { id: "read-context", default: "allow", narrowedBy: null, maps: ["context", "requirement-read", "runtime-understand", "child-readback"], say: "read what the project, its requirement and its runtime already say" },
  { id: "plan", default: "allow", narrowedBy: null, maps: ["plan", "replan"], say: "plan the workflow and revise the plan after a failure" },
  { id: "dispatch-skill", default: "allow", narrowedBy: null, maps: ["skill.invoke", "agent.dispatch"], say: "hand one step to an existing skill or agent the resolver selected" },
  { id: "dispatch-child-task", default: "allow", narrowedBy: null, maps: ["child-start"], say: "start or resume the engineering task a step needs" },
  { id: "generate-instruction-skill", default: "allow", narrowedBy: null, maps: ["propose-skill", "register-skill"], say: "generate, verify and register an instruction-only project playbook on a workflow gap" },
  { id: "edit-task-workspace", default: "owner", narrowedBy: null, maps: [], say: "the change itself, in the task's own workspace, and its local commit — autonomous engineering's own steps" },
  { id: "run-declared-check", default: "owner", narrowedBy: null, maps: [], say: "a build or test the checkout declared — autonomous engineering's own steps" },
  { id: "run-task-sandbox", default: "owner", narrowedBy: null, maps: [], say: "the task's own sandbox — its dependencies restored, its containers built and its application started there, autonomously, under runtime's isolation and ownership rules" },
  { id: "external-integration", default: "owner", narrowedBy: null, maps: [], say: "an ordinary write through an integration — an issue, a tracker, a development environment — autonomous through its owner's own gates, unless it lands on a protected boundary" },
  { id: "execute-generated-script", default: "deny", narrowedBy: null, maps: [], say: "run code a model wrote on this machine — never; a generated test runs only in a proven isolation worker" },
  { id: "secret-read", default: "deny", narrowedBy: null, maps: [], say: "read a secret's value — never; a credential reaches only the command a connection hands it to" },
  ...BOUNDARIES.map(protectedClass),
];

export const classOf = (id) => ACTION_CLASSES.find((c) => c.id === id) ?? null;

export const classFor = (mapped) => ACTION_CLASSES.find((c) => c.maps.includes(mapped)) ?? null;

// The verdict of one class under the effective settings, never looser than `resource` (a resource's own
// verdict, src/policy.mjs, when the step uses one). A class nothing maps to is `deny` whatever is asked.
export function verdictOf(values, id, resource = "allow") {
  const row = classOf(id);
  if (!row || row.default === "owner") return row ? "owner" : "deny";
  return strictest([row.default, resource]);
}


// The matrix Orbit Control shows: every class, its verdict now, and why.
export const matrixOf = (values) => ACTION_CLASSES.map((c) => ({ id: c.id, verdict: verdictOf(values, c.id), default: c.default, narrowedBy: c.narrowedBy, say: c.say }));
