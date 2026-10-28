// A TASK'S SANDBOX, as the two things an investigation asks of one: an approved ENVIRONMENT and the
// RUNTIME's answer about it. Pure -- it imports nothing of the runtime subject. The composition root
// (cli/autonomous-qa.mjs, with skills/orbit-runtime/bind.mjs) hands it the runtime's `sandbox` view
// and this reads only the fields it asks of it:
//
//   a = { environment, owner: { kind: "task", id }, state, tree, currentTree, stale,
//         endpoints: [{ component, kind, port, source }],
//         qa: { modes, entry, browser } }
//
// A task's OWN sandbox is autonomous (0.2.0): every mode the engine's gates allow there is open to its QA -- an isolated
// mode only where isolation is proven, a writing mode only on the run's own fixture under engine-minted grants, a
// destructive control never (src/investigation/gates.mjs). A person may NARROW it (the sandbox policy `qa.modes`), and
// nothing a session sends widens it. Which endpoint the browser opens is a person's choice when the sandbox has more
// than one that speaks http.
import { Refused } from "../errors.mjs";
import { MODE_IDS } from "./vocab.mjs";

const PICK = "a person names which endpoint the browser opens (sandbox policy qa.entry, in Orbit Control)";

// The sandbox says its endpoints as a list; a view that only has each component's own is read the same way.
const endpointsOf = (a) => a.endpoints ?? (a.components ?? []).map((c) => c.endpoint).filter((e) => e && typeof e === "object");

// Ordered: the first row that applies chooses; its `pick` may find nothing, and then its `refuse` says why.
// The last row always applies.
export const ENTRY = [
  { id: "POLICY", say: "the component the person's policy names", when: (a) => Boolean(a.qa?.entry), pick: (a) => endpointsOf(a).find((e) => e.component === a.qa.entry) ?? null, refuse: (a) => `the sandbox has no endpoint for ${a.qa.entry}, which sandbox policy qa.entry names — ${PICK}` },
  { id: "ONLY_HTTP", say: "the only endpoint that speaks http", when: (a) => endpointsOf(a).filter((e) => e.kind === "http").length === 1, pick: (a) => endpointsOf(a).find((e) => e.kind === "http"), refuse: () => PICK },
  { id: "NONE", say: "nobody chose and more than one could be", when: () => true, pick: () => null, refuse: () => PICK },
];

// The browser's isolation is the one choice this release has.
export const BROWSERS = [null, "isolated"];

function checkedBrowser(a) {
  if (!BROWSERS.includes(a.qa?.browser ?? null)) throw new Refused(`sandbox policy qa.browser "${a.qa.browser}" is not in this release — the browser is isolated: its own session, its own profile-less state`);
  return a;
}

function chosen(a) {
  const row = ENTRY.find((r) => r.when(a));
  const endpoint = row.pick(a);
  if (!endpoint) throw new Refused(row.refuse(a));
  if (!Number.isInteger(endpoint.port)) throw new Refused(`the sandbox's endpoint for ${endpoint.component} has no port yet — start the sandbox first`);
  return endpoint;
}

// -> the endpoint the browser opens: { component, kind, port }.
export const entryOf = (a) => chosen(checkedBrowser(a));

const modesOf = (a) => (a.qa?.modes?.length ? [...a.qa.modes] : [...MODE_IDS]);

// -> an environment, as settings.environments rows are: { id, origin, kind, modes } and what binds it.
//
// An ISOLATED sandbox (ADR 0038) has no origin on this machine: nothing here reaches inside its network, so it is
// verified only by a generated version its own worker runs (run-version), and its environment says so.
export const isolatedSandbox = (a) => a.isolation?.mode === "required";

export const sandboxEnvironment = (a) => (isolatedSandbox(a) ? { id: a.environment, origin: null, kind: "sandbox", isolated: true, modes: modesOf(a), task: a.owner.id, sourceTree: a.tree } : { id: a.environment, origin: `http://127.0.0.1:${entryOf(a).port}`, kind: "sandbox", modes: modesOf(a), task: a.owner.id, sourceTree: a.tree });

// -> what gates.mjs RUNTIME_BLOCKED and RUNTIME_STALE ask of `w.runtime`. `served` is whether anything answers
// on the entry port now; `current` is whether the sandbox still runs the tree its task holds.
export function sandboxRuntime(a, served) {
  if (isolatedSandbox(a)) return isolatedRuntime(a);
  const endpoint = entryOf(a);
  return { component: endpoint.component, port: endpoint.port, served: served === true, next: `start the sandbox (sandbox-start, task ${a.owner.id}), then act again`, environment: a.environment, task: a.owner.id, sourceTree: a.tree, taskTree: a.currentTree, current: a.stale === false };
}

// An isolated sandbox is served when it is READY, isolated only when its isolation was ATTESTED, and it can give each
// run a fixture of its own then -- a namespace the host mints for that run before anything is written.
const isolatedRuntime = (a) => ({ component: null, port: null, served: a.state === "READY", next: `prepare the sandbox again (sandbox-prepare, task ${a.owner.id}): it is ${a.state}${a.isolation.because ? ` — ${a.isolation.because}` : ""}`, environment: a.environment, task: a.owner.id, sourceTree: a.tree, taskTree: a.currentTree, current: a.stale === false, isolated: a.isolation.attested === true, fixture: a.state === "READY" && a.isolation.attested === true ? { minted: "per run" } : null });
