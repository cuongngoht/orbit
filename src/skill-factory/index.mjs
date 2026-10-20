// The commands of the SKILL FACTORY a terminal may run, as a table. What is NOT here is the point:
// registering a draft is a coordinated workflow's `register-skill` step (gated by the automation policy, and
// by a person's approval when the policy says so), and activating, disabling, retiring, rolling back or
// archiving a playbook is a person's, in Orbit Control -- a terminal cannot prove who typed it.
import { Refused } from "../errors.mjs";
import { flag, words } from "../learn/args.mjs";

const idOf = (args, i = 0) => {
  const word = words(args)[i];
  if (!/^[a-z0-9][a-z0-9-]{1,47}(:\d+\.\d+\.\d+:[0-9a-f]{8})?$/.test(String(word ?? ""))) throw new Refused("name the playbook: its id, or a pin <id>:<version>:<digest8> (list shows them)");
  return word;
};

const needsOf = (args) => (flag(args, "needs") ? flag(args, "needs").split(",").map((s) => s.trim()).filter(Boolean) : undefined);

function putOf(ports, args) {
  const file = words(args)[1];
  if (!file) throw new Refused("put <id> <file.md> [--as=<name.md>] [--needs=a.b,c.d] — the playbook's text, into its draft");
  return ports.factory.put({ id: idOf(args), name: flag(args, "as") ?? ports.basename(file), text: ports.readFile(file), needs: needsOf(args) });
}

const sayList = (rows) => (rows.length ? rows.map((r) => `${r.pin.padEnd(48)} ${(r.phase ?? r.status).padEnd(17)} ${r.status}${r.shape ? ` · ${r.shape}` : ""}${r.quarantined ? " · QUARANTINED (files changed)" : ""}${r.offered ? " · offered" : ""} — ${r.summary}`).join("\n") : "no playbook has been registered for this project");

const sayDrafts = (rows) => (rows.length ? rows.map((d) => (typeof d === "string" ? d : `${d.id.padEnd(48)} ${d.phase.padEnd(17)} ${d.shape ?? "—"}${d.attempts ? ` · ${d.attempts} attempt(s)` : ""}${d.findings.length ? ` · refused: ${d.findings.join(", ")}` : ""}`)).join("\n") : "no draft");

const sayShow = (p) => [`PLAYBOOK   ${p.pin} (${p.status})`, ...p.files.map((f) => `\n----- ${f.name}\n${f.text}`)].join("\n");

const sayVerify = (v) => (v.ok ? `VERIFIED   ${v.id} holds to the contract (nothing was registered: a workflow's register-skill step does that)` : [`REFUSED    ${v.id}`, ...v.findings.map((f) => `  ${f.id}: ${f.says}`)].join("\n"));

const sayPut = (r) => `DRAFT      ${r.id} · ${r.file} (${r.bytes} bytes)`;

const CAPABILITY = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;

function capabilityOf(args) {
  const cap = flag(args, "for") ?? words(args)[0];
  if (!CAPABILITY.test(String(cap ?? ""))) throw new Refused("discover --for=<capability> — one dotted, lower-case capability word");
  return cap;
}

const sayDiscover = (d) => [`DISCOVER   ${d.capability} → ${d.label}`, `BECAUSE    ${d.because}`, ...(d.provider ? [`PROVIDER   ${d.provider.kind} ${d.provider.id}${d.pin ? ` · pinned ${d.pin}` : ""}${d.runs ? ` · ${d.runs}` : ""}`] : [])].join("\n");

const stepLine = (s) => `  ${s.id.padEnd(24)} ${s.capability}${s.tool ? ` · ${s.tool}` : ""}${(s.after ?? []).length ? ` ← ${s.after.join(", ")}` : ""}${s.required === false ? " · optional" : ""} · evidence ${s.evidence ?? "report"}${s.approval === "owner" ? " · a person allows it" : ""}`;

const sayWorkflow = (w) => [`WORKFLOW   ${w.pin} (${w.status}) · ${w.workflow.steps.length} step(s), at most ${w.workflow.bounds?.maxCalls ?? 16} call(s)`, `ORDER      ${w.order.join(" → ")}`, ...w.workflow.steps.map(stepLine)].join("\n");

export const COMMANDS = {
  where: { run: (ports) => ({ room: ports.factory.store.paths.room }), say: (r) => `ROOM       ${r.room}`, writes: "nothing" },
  list: { run: (ports) => ports.factory.list(), say: sayList, writes: "nothing" },
  drafts: { run: (ports) => ports.factory.draftRows?.() ?? ports.factory.drafts(), say: sayDrafts, writes: "nothing" },
  show: { run: (ports, args) => ports.factory.playbook(idOf(args)), say: sayShow, writes: "nothing" },
  verify: { run: (ports, args) => ports.factory.verify(idOf(args)), say: sayVerify, writes: "nothing" },
  put: { run: putOf, say: sayPut, writes: "store" },
  discover: { run: (ports, args) => ports.discover(capabilityOf(args)), say: sayDiscover, writes: "nothing" },
  workflow: { run: (ports, args) => ((w) => ({ pin: w.pin, status: w.status, runs: w.manifest.runs, needs: w.manifest.needs, provides: w.manifest.provides, workflow: w.workflow, order: ports.factory.interpreter.orderOf(w.workflow) }))(ports.factory.workflow(pinArg(ports, args))), say: sayWorkflow, writes: "nothing" },
};

// A pin, or the id of a registered playbook -- its version in place.
const pinArg = (ports, args) => ((ref) => (ref.includes(":") ? ref : ports.factory.current(ref)?.pin ?? ref))(idOf(args));

export const COMMAND_NAMES = Object.keys(COMMANDS);

// What no factory command is: the moves that are a workflow's gated step or a person's.
export const NOT_FACTORY = ["register", "activate", "disable", "retire", "rollback", "archive", "delete"];
