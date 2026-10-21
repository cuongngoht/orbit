// A project's generated playbooks as rows of the EFFECTIVE RESOURCE REGISTRY (src/resources/), in the skills
// family beside the shipped ones -- so the prompt router, orbit-help, Orbit Control and a coordinated workflow
// all see the same thing, and none keeps a list of its own.
//
// A row's identity is its own: key `project:<id>`, ownership `project`, so a playbook never shares a key with
// a shipped skill. Active, verified files are eligible; quarantined files are not.
const stateOf = (r) => (r.quarantined ? "needs-attention" : r.offered ? "ready" : "disabled");

const whyOf = (r) => ({ "needs-attention": "its files changed after they were verified — register it again", disabled: `it is ${r.status}`, ready: null })[stateOf(r)];

export const skillRow = (values) => (r) => ({ id: r.id, key: `project:${r.id}`, source: "generated", ownership: "project", enabled: r.offered && !r.quarantined, available: r.offered && !r.quarantined, runtimeReady: true, eligible: r.quarantined ? false : undefined, selection: "automatic", priority: 0, state: stateOf(r), why: whyOf(r), summary: r.summary, provides: r.provides, needs: r.needs, optional: r.optional, signals: r.signals, detail: { origin: "generated", version: r.version, digest: r.digest, status: r.status, phase: r.phase ?? null, shape: r.shape ?? null, scope: r.scope, sourceTask: r.sourceTask, pin: r.pin, workflow: r.workflow, runs: r.runs ?? "followed" } });

export const skillRows = (list, values) => list.filter((r) => !r.archived).map(skillRow(values));
