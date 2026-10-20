// A generated playbook's LIFECYCLE, through the factory's one write door:
//
//   scaffold   a DRAFT for a capability a workflow lacks: its manifest, under the automation policy (mode,
//              reuse first, scope, budgets). The host writes the playbook's text with `put`
//   put        one .md file into a draft -- the only text a host ever hands the factory; never into a
//              registered playbook
//   verify     the draft held to the contract (validate.mjs), writing nothing
//   register   under the room's lock, from the attempt it counts to the row it writes: verify, keep the
//              version in place aside (.versions/), copy the draft in, stamp what the engine owns (version,
//              digest, status), write the sidecar and the registry row, archive versions past
//              `maxActiveVersions`, remove the draft. The same files registered twice are REUSED, never a
//              second version, and the draft that was the same is removed; a draft another session already
//              registered answers what it became
//   status     a person's move (activate, disable, retire): activating needs the files to be what was verified
//   pinned     a task's pin (<id>:<version>:<digest8>) read back, from wherever that version is kept now
//   rollback   an earlier version, verified again and registered as the next version
//   archive    the version in place moved out of the way; tasks that pinned it still read it
//
// Every write is under the room's lock; nothing here is ever deleted except a draft that was registered.
//
// A playbook's PHASE (vocab.mjs PHASES) is read off what is kept here every time -- listOf and draftsOf say it
// -- and never stored: a phase that could disagree with its files would be a second truth.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { withLock } from "../store/lock.mjs";
import { shapeOf, shapeRow } from "./gap.mjs";
import { STAMPED } from "./manifest.mjs";
import { allowed, activationOf } from "./policy.mjs";
import { digestOf, filesIn } from "./store.mjs";
import { validateSkill } from "./validate.mjs";
import { DRAFTED_UNDER, MANIFEST, MANIFEST_SCHEMA, MOVES, SIDECAR, SKILL_FILE, WORKFLOW_FILE, phaseOf, statusRow } from "./vocab.mjs";
import { parsedWorkflow, workflowFindings } from "./workflow.mjs";

const refused = (code, say) => Object.assign(new Refused(`${code}: ${say}`), { code });

const locked = (store, fn) => (store.io.ensureDir(store.paths.room), withLock(store.paths.room, fn, store.io, "another session is registering a playbook for this project — try again in a moment"));

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const entryOf = (store, id) => store.registry().find((r) => r.id === id) ?? null;

// ---- scaffold and put ----------------------------------------------------------------------------------

// A playbook's id from the capability it provides: release.checklist.verification -> release-checklist-verification.
export const idFor = (provides) => String(provides).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^orbit-/, "").replace(/^orbit-/, "").slice(0, 48) || "playbook";

const draftedBy = (store, task) => [...store.registry().filter((r) => r.sourceTask === task).map((r) => r.id), ...store.drafts().filter((id) => parsed(store.io.read(join(store.draftDir(id), MANIFEST)))?.sourceTask === task)];

// The playbook already OFFERED for a capability: active, not archived, and its files still what was verified -- a
// quarantined one is offered to nobody, so it never stands in the way of drafting one that is.
const activeFor = (store, provides) => store.registry().find((r) => r.status === "active" && !r.archived && r.provides.includes(provides) && intact(store, r.id))?.id ?? null;

// A playbook's CONTRACT, from its shape (gap.mjs SHAPES): what it starts from, what it gives back, what a host
// following it can show, and what it never does. Written by the engine; a host writes only the text.
const CONTRACT = {
  inputs: () => "the objective of the coordinated workflow that follows it, and what each capability it needs answers here",
  outputs: (shape) => ({ verification: "one line per check: checked, failed or needs a person, each naming the record it read", composition: "which provided capability each step used and what it answered, then what still needs a person" })[shape] ?? "what was done, step by step, and what still needs a person",
  restrictions: () => "instruction-only: it runs only the read-only Orbit commands it lists, and never a script, an install, a secret or a person's decision",
};

const contractOf = (shape) => ({ shape, inputs: CONTRACT.inputs(), outputs: CONTRACT.outputs(shape), evidence: shapeRow(shape).evidence, restrictions: CONTRACT.restrictions() });

const draftManifest = (id, s) => ({ schema: MANIFEST_SCHEMA, id, origin: "generated", scope: s.values.skillFactory.scope, provides: [s.provides], needs: s.needs ?? [], workflow: DRAFTED_UNDER, allowedTools: ["Read"], ...(s.task ? { sourceTask: s.task } : {}), generationReason: String(s.because ?? `nothing here provides ${s.provides}, and every need a playbook for it declares must be provided`).slice(0, 240), engine: `>=${s.engineVersion}`, ...contractOf(shapeOf(s.provides, s.needs ?? [])) });

// s: { provides, task, values, engineVersion, needs?, because? }
// The playbooks this task drafted are counted against its budget -- all but this one: drafting it again (after its
// registration was refused) is the same playbook, never one more.
export function scaffold(store, s) {
  const id = idFor(s.provides);
  allowed({ values: s.values, provides: s.provides, scope: s.values.skillFactory.scope, drafted: new Set(draftedBy(store, s.task).filter((x) => x !== id)).size, attempts: 0, active: activeFor(store, s.provides) });
  return locked(store, () => drafted(store, id, s));
}

function drafted(store, id, s) {
  const dir = store.draftDir(id);
  if (!store.io.exists(join(dir, MANIFEST))) store.io.write(join(dir, MANIFEST), json(draftManifest(id, s)));
  return { id, provides: s.provides, draft: dir, shape: parsed(store.io.read(join(dir, MANIFEST)))?.shape ?? shapeOf(s.provides, s.needs ?? []) };
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.md$/;

// A playbook file a host may put: its .md text, or -- since 0.0.4 -- the one workflow.json the engine runs.
const puttable = (name) => NAME.test(name) || name === WORKFLOW_FILE;

// p: { id, name, text, needs? } -- the playbook's text, and the needs it declares when the host knows them.
export function put(store, p) {
  if (!puttable(p.name)) throw refused("SF_FILE_NAME", `${p.name} is not a playbook file: a .md name or ${WORKFLOW_FILE}, no directory`);
  if (!store.io.exists(join(store.draftDir(p.id), MANIFEST))) throw refused("SF_NO_DRAFT", `${p.id} has no draft — a coordinated workflow's propose-skill step scaffolds one`);
  return locked(store, () => written(store, p));
}

// New text is not what the last refusal was about: its findings go (the attempts it spent stay counted), and the
// draft reads VALIDATING until it is held to the contract again.
function written(store, p) {
  const dir = store.draftDir(p.id);
  store.io.write(join(dir, p.name), p.text);
  manifestRewritten(store, dir, p);
  if (store.io.exists(attemptsFile(store, p.id))) store.io.write(attemptsFile(store, p.id), json({ n: attemptsOf(store, p.id).n ?? 0 }));
  return { id: p.id, file: p.name, bytes: Buffer.byteLength(p.text) };
}

// The needs a put declares, when it declares them.
const manifestFor = (m, p) => (p.needs ? { ...m, needs: p.needs } : m);

// The capabilities a workflow's steps ask, as words: what a declared playbook needs, beside what it already said.
const stepCapabilities = (wf) => (Array.isArray(wf?.steps) ? wf.steps.map((s) => s?.capability).filter((c) => typeof c === "string" && /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/.test(c)) : []);

// Putting a workflow.json is what makes a draft DECLARED: the engine says so in its manifest, and adds what its steps
// ask to its needs -- a reading of the workflow, never the host's word -- so validation holds every one of them to
// being provided here.
const declaredManifest = (m, p) => (p.name === WORKFLOW_FILE ? { ...m, runs: "declared", needs: [...new Set([...(m.needs ?? []), ...stepCapabilities(parsedWorkflow(p.text))])].slice(0, 16) } : m);

// The draft's manifest is written again only when the put changed what it says.
function manifestRewritten(store, dir, p) {
  const current = parsed(store.io.read(join(dir, MANIFEST)));
  const next = current ? declaredManifest(manifestFor(current, p), p) : current;
  if (next !== current) store.io.write(join(dir, MANIFEST), json(next));
}

// ---- verify and register ----------------------------------------------------------------------------

export const verifyDraft = (store, id, deps) => ({ id, ...validateSkill({ id, files: filesIn(store.io, store.draftDir(id)) }, deps) });

// A registered version held to TODAY's contract again (a person's "test it again" in Control): its files as
// they are in place, the manifest without what the engine stamped. Writes nothing; a playbook that no longer
// holds is for a person to disable.
const unstamped = (f) => (f.name === MANIFEST ? { ...f, text: json(Object.fromEntries(Object.entries(parsed(f.text) ?? {}).filter(([k]) => !STAMPED.includes(k)))) } : f);

export const revalidate = (store, id, deps) => ({ id, intact: intact(store, id), ...validateSkill({ id, files: filesIn(store.io, store.dirOf(id)).map(unstamped) }, deps) });

const bumped = (version) => (version ? version.split(".").map(Number).map((n, i) => (i === 2 ? n + 1 : n)).join(".") : "0.1.0");

const pinOf = (row) => `${row.id}:${row.version}:${row.digest.slice(0, 8)}`;

const summaryOf = (files, manifest) => String(manifest.provides.join(", ") + " — " + (/^description:\s*(.+)$/m.exec(files.find((f) => f.name === SKILL_FILE)?.text ?? "")?.[1] ?? "a project playbook")).slice(0, 160);

const attemptsFile = (store, id) => join(store.draftDir(id), ".attempts.json");

const attemptsOf = (store, id) => parsed(store.io.read(attemptsFile(store, id)) ?? "null") ?? { n: 0 };

// Counted under the room's lock, with the findings of the last refusal kept beside the count -- what a viewer
// and Control show as the FAILED phase -- so two sessions can never both spend the same attempt.
function attempted(store, id, values) {
  const n = attemptsOf(store, id).n ?? 0;
  allowed({ values, provides: null, scope: values.skillFactory.scope, drafted: 0, attempts: n, active: null });
  store.io.write(attemptsFile(store, id), json({ n: n + 1 }));
}

function refusedDraft(store, id, verdict) {
  store.io.write(attemptsFile(store, id), json({ ...attemptsOf(store, id), findings: verdict.findings.slice(0, 8).map((f) => f.id) }));
  return { ok: false, id, findings: verdict.findings };
}

const hasDraft = (store, id) => store.io.exists(join(store.draftDir(id), MANIFEST));

// r: { values, deps, by, at, engineVersion, rolledBackTo? } -> { ok, pin, status, summary } | { ok: false, findings }
export const register = (store, id, r) => locked(store, () => registering(store, id, r));

// From the attempt it counts to the row it writes, under ONE hold of the lock: a `put` landing between the
// verdict and the copy would register files nobody verified.
function registering(store, id, r) {
  if (!hasDraft(store, id)) return alreadyRegistered(store, id);
  attempted(store, id, r.values);
  const verdict = verifyDraft(store, id, r.deps);
  if (!verdict.ok) return refusedDraft(store, id, verdict);
  return registered(store, id, r);
}

// No draft: another session registered it a moment ago (what it became is the answer, while it is what a registration
// itself makes -- active, or verified and waiting for a person -- in place, its files what was verified), or nobody
// drafted it -- or what is kept under the id is disabled, retired, broken, archived or changed by hand, which no
// register step may count as done.
const REGISTERED = ["active", "verified"];

const servable = (store, row) => Boolean(row) && REGISTERED.includes(row.status) && !row.archived && intact(store, row.id);

function alreadyRegistered(store, id) {
  const row = entryOf(store, id);
  if (!servable(store, row)) throw refused("SF_NO_DRAFT", row ? `${id} has no draft, and what is registered under it is ${row.archived ? "archived" : row.status}${intact(store, id) ? "" : " with files changed after they were verified"} — a person moves it in Orbit Control, or a workflow drafts it again` : `${id} has no draft — a coordinated workflow's propose-skill step scaffolds one`);
  return reused(row);
}

function registered(store, id, r) {
  const files = filesIn(store.io, store.draftDir(id));
  const prior = entryOf(store, id);
  const digest = digestOf(files);
  return prior?.digest === digest && statusRow(prior.status)?.pinnable ? reusedDraft(store, id, prior) : placed(store, id, { files, prior, digest, ...r });
}

// The same files again: the version in place answers, and the draft that duplicated it goes.
function reusedDraft(store, id, prior) {
  store.io.remove(store.draftDir(id));
  return reused(prior);
}

const reused = (row) => ({ ok: true, reused: true, id: row.id, version: row.version, digest: row.digest, pin: pinOf(row), status: row.status, summary: row.summary });

function placed(store, id, p) {
  keptAside(store, p.prior);
  const row = rowOf(id, p);
  copiedIn(store, id, p, row);
  store.saveRegistry([...store.registry().filter((x) => x.id !== id), row]);
  return finished(store, id, p, row);
}

function finished(store, id, p, row) {
  prunedVersions(store, id, p.values.skillFactory.maxActiveVersions);
  store.io.remove(store.draftDir(id));
  return { ok: true, reused: false, id, version: row.version, digest: row.digest, pin: pinOf(row), status: row.status, summary: row.summary };
}

const manifestIn = (files) => parsed(files.find((f) => f.name === MANIFEST)?.text ?? "null") ?? {};

const rowOf = (id, p) => ((m) => ({ id, version: bumped(p.prior?.version), digest: p.digest, status: activationOf(p.values), scope: m.scope, provides: m.provides, needs: m.needs, optional: m.optional ?? [], signals: m.signals ?? [], workflow: m.workflow, runs: m.runs ?? "followed", shape: m.shape ?? null, sourceTask: m.sourceTask ?? null, summary: summaryOf(p.files, m), registeredBy: p.by, at: p.at, ...(p.rolledBackTo ? { rolledBackTo: p.rolledBackTo } : {}) }))(manifestIn(p.files));

function keptAside(store, prior) {
  if (!prior || !store.io.exists(store.dirOf(prior.id))) return;
  copyDir(store.io, store.dirOf(prior.id), store.versionDir(prior.id, prior.version, prior.digest));
}

function copiedIn(store, id, p, row) {
  store.io.remove(store.dirOf(id));
  copyDir(store.io, store.draftDir(id), store.dirOf(id));
  store.io.write(join(store.dirOf(id), MANIFEST), json({ ...manifestIn(p.files), status: row.status, version: row.version, digest: row.digest, createdAt: p.prior?.at ?? p.at, verifiedAt: p.at, engineVersion: p.engineVersion, registeredBy: p.by }));
  store.io.write(join(store.dirOf(id), SIDECAR), json({ id, version: row.version, digest: row.digest, at: p.at, by: p.by }));
}

function copyDir(io, from, to) {
  io.ensureDir(to);
  for (const name of io.list(from).filter((n) => !n.startsWith(".") && io.kind(join(from, n)) === "file")) io.copy(join(from, name), join(to, name));
}

// Versions past what a person keeps are ARCHIVED (moved), never deleted: a task that pinned one still reads it.
function prunedVersions(store, id, keep) {
  const dir = join(store.paths.versions, id);
  const old = store.io.list(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const name of old.slice(0, Math.max(0, old.length - keep))) movedTo(store.io, join(dir, name), join(store.paths.archived, id, name));
}

function movedTo(io, from, to) {
  io.ensureDir(join(to, ".."));
  io.rename(from, to);
}

// ---- a registered playbook, afterwards ---------------------------------------------------------------

// Whether the files in place are still what was registered: a hand edit in the store is QUARANTINED -- listed,
// never offered, never activated -- until it is registered again through the contract.
export const intact = (store, id) => ((side) => Boolean(side) && digestOf(filesIn(store.io, store.dirOf(id))) === side.digest)(store.sidecar(id));

export function setStatus(store, id, status, opts = {}) {
  const row = entryOf(store, id);
  if (!row) throw refused("SF_UNKNOWN", `${id} is not a registered playbook of this project`);
  if (!(MOVES[status] ?? []).includes(row.status)) throw refused("SF_MOVE", `${id} is ${row.status} — it cannot become ${status}`);
  if (status === "active" && !intact(store, id)) throw refused("SF_QUARANTINED", `${id}'s files changed after they were verified — register it again through the contract before it is active`);
  return locked(store, () => moved(store, id, status, opts));
}

function moved(store, id, status, opts) {
  const rows = store.registry().map((r) => (r.id === id ? { ...r, status, movedBy: opts.by ?? "person", movedAt: opts.at } : r));
  store.saveRegistry(rows);
  return rows.find((r) => r.id === id);
}

const PIN = /^([a-z0-9][a-z0-9-]{1,47}):(\d+\.\d+\.\d+):([0-9a-f]{8})$/;

const placesOf = (store, id, version, digest8) => [store.dirOf(id), join(store.paths.versions, id, `${version}-${digest8}`), join(store.paths.archived, id, `${version}-${digest8}`)];

const versionAt = (store, dir) => currentManifest(store.io.read(join(dir, MANIFEST)));

// A pin read back from wherever that version is now: in place, kept aside, or archived.
export function pinned(store, pin) {
  const m = PIN.exec(String(pin));
  if (!m) return null;
  const dir = placesOf(store, m[1], m[2], m[3]).find((d) => versionAt(store, d)?.version === m[2] && String(versionAt(store, d)?.digest ?? "").startsWith(m[3]));
  return dir ? pinRow(store, m[1], dir) : null;
}

const pinRow = (store, id, dir) => ((manifest, row) => ({ id, dir, version: manifest.version, status: row?.version === manifest.version ? row.status : "retired", loadable: statusRow(row?.version === manifest.version ? row.status : "retired")?.pinnable === true, summary: row?.summary ?? manifest.provides.join(", "), pin: `${id}:${manifest.version}:${manifest.digest.slice(0, 8)}` }))(versionAt(store, dir), entryOf(store, id));

// What a host is handed to follow: the playbook's text and its references, as printable text, by pin or id.
export function playbookOf(store, ref, printable) {
  const row = PIN.test(String(ref)) ? pinned(store, ref) : ((e) => (e ? pinned(store, pinOf(e)) : null))(entryOf(store, ref));
  if (!row) throw refused("SF_UNKNOWN", `${ref} is no playbook this project keeps`);
  return { pin: row.pin, status: row.status, files: filesIn(store.io, row.dir).filter((f) => f.name.endsWith(".md")).map((f) => ({ name: f.name, text: printable(f.text) })) };
}

// A pinned version's DECLARED WORKFLOW (0.0.4), for the engine to run: read from wherever that version is kept, its
// files proved to be what was registered (the digest its manifest was stamped with), and held to the workflow
// contract again -- what runs is what was verified, or nothing does.
export function workflowOf(store, pin) {
  const row = pinned(store, pin);
  if (!row) throw refused("SF_UNKNOWN", `${pin} is no playbook version this project keeps`);
  return declaredAt(store, row);
}

function declaredAt(store, row) {
  const files = filesIn(store.io, row.dir);
  const manifest = manifestIn(files);
  if (digestOf(files) !== manifest.digest) throw refused("SF_QUARANTINED", `${row.pin}'s files changed after they were verified — it runs nothing until it is registered again`);
  return { ...row, manifest, workflow: checkedWorkflow(row, files, manifest) };
}

function checkedWorkflow(row, files, manifest) {
  if (manifest.runs !== "declared") throw refused("SF_NOT_DECLARED", `${row.pin} is followed by a host — it declares no workflow for the engine to run`);
  const wf = parsedWorkflow(files.find((f) => f.name === WORKFLOW_FILE)?.text ?? "null");
  const findings = workflowFindings(wf, manifest);
  if (findings.length) throw refused("SF_WORKFLOW_INVALID", `${row.pin}'s workflow no longer holds: ${findings[0].id}: ${findings[0].says}`);
  return wf;
}

export function archive(store, id, opts = {}) {
  const row = entryOf(store, id);
  if (!row) throw refused("SF_UNKNOWN", `${id} is not a registered playbook of this project`);
  return locked(store, () => archived(store, row, opts));
}

function archived(store, row, opts) {
  movedTo(store.io, store.dirOf(row.id), store.archivedDir(row.id, row.version, row.digest));
  store.saveRegistry(store.registry().map((r) => (r.id === row.id ? { ...r, status: "retired", archived: true, movedBy: opts.by ?? "person", movedAt: opts.at } : r)));
  return { id: row.id, archived: true };
}

// An earlier version, put back as a DRAFT and registered again through the whole contract -- the new version
// says which one it restored (`rolledBackTo`), so its phase reads ROLLED_BACK.
export function rollback(store, id, version, r) {
  const at = join(store.paths.versions, id);
  const name = store.io.list(at).find((n) => n.startsWith(`${version}-`));
  if (!name) throw refused("SF_UNKNOWN", `${id} keeps no version ${version}`);
  locked(store, () => restored(store, join(at, name), id));
  return register(store, id, { ...r, rolledBackTo: version });
}

// A kept version back as a draft: its files, and its manifest without what the engine stamped on it.
function restored(store, from, id) {
  copyDir(store.io, from, store.draftDir(id));
  const m = parsed(store.io.read(join(store.draftDir(id), MANIFEST)) ?? "null") ?? {};
  store.io.write(join(store.draftDir(id), MANIFEST), json(Object.fromEntries(Object.entries(m).filter(([k]) => !STAMPED.includes(k)))));
}

const listed = (store) => (r) => ((ok) => ({ ...r, shape: r.shape ?? null, pin: pinOf(r), quarantined: !r.archived && !ok, offered: statusRow(r.status)?.offered === true && !r.archived && ok, phase: phaseOf({ ...r, intact: r.archived || ok }) }))(intact(store, r.id));

export const listOf = (store) => store.registry().map(listed(store));

// Every draft and the phase it is in: scaffolded, written, or held to the contract and refused.
const draftRow = (store) => (id) => ((m, a) => ({ id, provides: m?.provides ?? [], shape: m?.shape ?? null, sourceTask: m?.sourceTask ?? null, attempts: a.n ?? 0, findings: a.findings ?? [], phase: phaseOf({ draft: true, written: store.io.exists(join(store.draftDir(id), SKILL_FILE)), findings: a.findings ?? [] }) }))(parsed(store.io.read(join(store.draftDir(id), MANIFEST)) ?? "null"), attemptsOf(store, id));

export const draftsOf = (store) => store.drafts().map(draftRow(store));

function currentManifest(text) {
  if (text === null) return null;
  const manifest = parsed(text);
  if (manifest?.schema !== MANIFEST_SCHEMA) throw refused("SF_MANIFEST_SHAPE", "Unsupported playbook manifest schema; files unchanged");
  return manifest;
}
