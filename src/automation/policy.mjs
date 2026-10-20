// What a coordinated workflow may do on its own, per ACTION CLASS -- as data, combined with the verdict a
// resource already carries (src/policy.mjs) through `strictest`, so automation can only ever make a step
// STRICTER than the resource's own policy says. A resource that is denied stays denied, whatever any setting
// says. Under the defaults (autonomous, skill factory auto-safe) every class is its own default: autonomy is
// enforced per ACTION here, never by a global switch -- a mode or factory value narrows a class only when a
// person kept it as a restriction from before (src/automation/settings.mjs RETIRED).
//
//   default     the verdict with no setting narrowing it
//   narrowedBy  the effective setting that moves it, and how (a row of NARROW below)
//   maps        the coordinator's step kinds and actions it governs -- a class mapping to nothing is a
//               class no step may ever take (the five `deny` rows), and a test holds that no step kind,
//               action or usage header names one
//
// The classes a task OWNER already gates (editing the task's own workspace, a declared check, the task's
// sandbox) are shown in the matrix as `owner`: autonomous engineering's own gates and runtime's trust
// decide them, and automation adds nothing beside them -- two policies on one action would disagree.
import { strictest } from "../policy.mjs";

export const ACTION_CLASSES = [
  { id: "read-context", default: "allow", narrowedBy: null, maps: ["context", "requirement-read", "runtime-understand", "child-readback"], say: "read what the project, its requirement and its runtime already say" },
  { id: "plan", default: "allow", narrowedBy: null, maps: ["plan", "replan"], say: "plan the workflow and revise the plan after a failure" },
  { id: "dispatch-skill", default: "allow", narrowedBy: null, maps: ["skill.invoke", "agent.dispatch"], say: "hand one step to an existing skill or agent the resolver selected" },
  { id: "dispatch-child-task", default: "allow", narrowedBy: null, maps: ["child-start"], say: "start or resume the engineering task a step needs" },
  { id: "generate-instruction-skill", default: "allow", narrowedBy: null, maps: ["propose-skill", "register-skill"], say: "generate, verify and register an instruction-only project playbook on a workflow gap" },
  { id: "edit-task-workspace", default: "owner", narrowedBy: null, maps: [], say: "the change itself, in the task's own workspace — autonomous engineering's gates" },
  { id: "run-declared-check", default: "owner", narrowedBy: null, maps: [], say: "a build or test the checkout declared — autonomous engineering's gates" },
  { id: "run-approved-sandbox", default: "owner", narrowedBy: null, maps: [], say: "the task's own sandbox — runtime's trust, granted in Control" },
  { id: "execute-generated-script", default: "deny", narrowedBy: null, maps: [], say: "run code a model wrote — never in this release" },
  { id: "install-dependency", default: "deny", narrowedBy: null, maps: [], say: "install a package or a tool — a person does, in Orbit Control" },
  { id: "secrets-or-external-write", default: "deny", narrowedBy: null, maps: [], say: "read a secret or write outside the workspace — never from a workflow" },
  { id: "production-mutation", default: "deny", narrowedBy: null, maps: [], say: "change production — never" },
  { id: "push-merge-deploy", default: "deny", narrowedBy: null, maps: [], say: "push, merge or deploy — never; a person does" },
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
