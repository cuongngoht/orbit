// A generated playbook's LIFECYCLE, through the factory's one write door:
//
//   scaffold   a DRAFT for a capability a workflow lacks: its manifest, under the automation policy (mode,
//              reuse first, scope, budgets). The host writes the playbook's text with `put`
//   put        one .md file into a draft -- the only text a host ever hands the factory; never into a
//              registered playbook. Since 0.0.4 also the one workflow.json, which makes the draft DECLARED and adds
//              its steps' capabilities to its needs
//   workflowOf a pinned version's declared workflow, its files proved to be what was registered and held to the
//              workflow contract again -- what the engine runs (0.0.4)
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
// and, since 0.3.0 (ADR 0045), a SUCCESSOR of a registered version -- an improvement campaign's, never a workflow's:
//
//   scaffoldSuccessor  a draft that starts as a pinned version's files, marked with the version it succeeds and the
//              campaign that asked for it; the host writes what changes with `put`, exactly as for any draft
//   stageCandidate     the successor held to the SAME contract (validate.mjs) and kept, verified, in candidates/ --
//              never in place, never in the registry, offered to nobody: only an evaluation that holds its pin runs it
//   selectVersion      which KEPT version runs from now on: a candidate the improvement engine promoted on evaluated
//              evidence, or the version a promotion replaced when it regressed -- through the improvement engine's
//              door while a person lets it promote, or a person's in Orbit Control. Under the lock, against the version
//              the caller read (`expect`), never for a playbook a person switched off, never to a version that no longer
//              holds to the contract; tasks that pinned a version keep it
//
// Every write is under the room's lock; nothing here is ever deleted except a draft that was registered.
//
// A playbook's PHASE (vocab.mjs PHASES) is read off what is kept here every time -- listOf and draftsOf say it
// -- and never stored: a phase that could disagree with its files would be a second truth.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";
import { withLock } from "../store/lock.mjs";
import { shapeOf, shapeRow } from "./gap.mjs";
import { STAMPED } from "./manifest.mjs";
import { allowed, activationOf } from "./policy.mjs";
import { STAMPED_KEYS, digestOf, filesIn } from "./store.mjs";
import { validateSkill } from "./validate.mjs";
import { DRAFTED_UNDER, MANIFEST, MANIFEST_SCHEMA, MOVES, SELECT_DOORS, SIDECAR, SKILL_FILE, SUCCESSION, WORKFLOW_FILE, phaseOf, statusRow } from "./vocab.mjs";
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

// A draft is registered in place -- unless it is a SUCCESSOR (0.3.0), which is staged as a candidate and evaluated,
// and only ever chosen through selectVersion: a version nobody compared never replaces the one that runs.
function registrable(store, id) {
  const m = draftManifestOf(store, id);
  if (m?.successorOf) throw refused("SF_SUCCESSOR", `${id}'s draft succeeds ${m.successorOf} for ${m.campaign ?? "an improvement campaign"}: it is staged as a candidate and evaluated, never registered in place`);
  return hasDraft(store, id);
}

const draftManifestOf = (store, id) => parsed(store.io.read(join(store.draftDir(id), MANIFEST)) ?? "null");

// r: { values, deps, by, at, engineVersion, rolledBackTo? } -> { ok, pin, status, summary } | { ok: false, findings }
export const register = (store, id, r) => locked(store, () => registering(store, id, r));

// From the attempt it counts to the row it writes, under ONE hold of the lock: a `put` landing between the
// verdict and the copy would register files nobody verified.
function registering(store, id, r) {
  if (!registrable(store, id)) return alreadyRegistered(store, id);
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
  const row = rowOf(id, { ...p, version: nextVersion(store, id) });
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

const rowOf = (id, p) => ((m) => ({ id, version: p.version, digest: p.digest, status: activationOf(p.values), scope: m.scope, provides: m.provides, needs: m.needs, optional: m.optional ?? [], signals: m.signals ?? [], workflow: m.workflow, runs: m.runs ?? "followed", shape: m.shape ?? null, sourceTask: m.sourceTask ?? null, summary: summaryOf(p.files, m), registeredBy: p.by, at: p.at, ...(p.rolledBackTo ? { rolledBackTo: p.rolledBackTo } : {}) }))(manifestIn(p.files));

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

const placesOf = (store, id, version, digest8) => [store.dirOf(id), join(store.paths.versions, id, `${version}-${digest8}`), join(store.paths.archived, id, `${version}-${digest8}`), join(store.paths.candidates, id, `${version}-${digest8}`)];

const versionAt = (store, dir) => currentManifest(store.io.read(join(dir, MANIFEST)));

// A pin read back from wherever that version is now: in place, kept aside, or archived.
export function pinned(store, pin) {
  const m = PIN.exec(String(pin));
  if (!m) return null;
  const dir = placesOf(store, m[1], m[2], m[3]).find((d) => versionAt(store, d)?.version === m[2] && String(versionAt(store, d)?.digest ?? "").startsWith(m[3]));
  return dir ? pinRow(store, m[1], dir) : null;
}

// Where a kept version stands: the registry row's status when it is the version in place, a candidate while it waits in
// candidates/ (0.3.0), and retired otherwise -- kept for whoever pinned it.
const STATUS_AT = [
  { when: (row, m) => row?.version === m.version && row?.digest === m.digest, status: (row) => row.status },
  { when: (row, m) => m.status === "candidate", status: () => "candidate" },
  { when: () => true, status: () => "retired" },
];

const statusAt = (row, m) => STATUS_AT.find((s) => s.when(row, m)).status(row, m);

const pinRow = (store, id, dir) => ((manifest, row) => ({ id, dir, version: manifest.version, status: statusAt(row, manifest), loadable: statusRow(statusAt(row, manifest))?.pinnable === true, summary: row?.summary ?? manifest.provides.join(", "), pin: `${id}:${manifest.version}:${manifest.digest.slice(0, 8)}` }))(versionAt(store, dir), entryOf(store, id));

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
  store.io.write(join(store.draftDir(id), MANIFEST), json(unstampedManifest(m)));
}

// A manifest as a draft may carry it: nothing the engine stamped, and no succession -- a version put back by a person is
// registered as itself, never as somebody's successor.
const unstampedManifest = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => !STAMPED.includes(k) && !SUCCESSION.includes(k)));

const listed = (store) => (r) => ((ok) => ({ ...r, shape: r.shape ?? null, pin: pinOf(r), quarantined: !r.archived && !ok, offered: statusRow(r.status)?.offered === true && !r.archived && ok, phase: phaseOf({ ...r, intact: r.archived || ok }) }))(intact(store, r.id));

export const listOf = (store) => store.registry().map(listed(store));

// Every draft and the phase it is in: scaffolded, written, or held to the contract and refused.
const draftRow = (store) => (id) => ((m, a) => ({ id, provides: m?.provides ?? [], shape: m?.shape ?? null, sourceTask: m?.sourceTask ?? null, successorOf: m?.successorOf ?? null, attempts: a.n ?? 0, findings: a.findings ?? [], phase: phaseOf({ draft: true, written: store.io.exists(join(store.draftDir(id), SKILL_FILE)), findings: a.findings ?? [] }) }))(parsed(store.io.read(join(store.draftDir(id), MANIFEST)) ?? "null"), attemptsOf(store, id));

export const draftsOf = (store) => store.drafts().map(draftRow(store));

function currentManifest(text) {
  if (text === null) return null;
  const manifest = parsed(text);
  if (manifest?.schema !== MANIFEST_SCHEMA) throw refused("SF_MANIFEST_SHAPE", "Unsupported playbook manifest schema; files unchanged");
  return manifest;
}

// ---- a SUCCESSOR, staged and selected (0.3.0, ADR 0045) -------------------------------------------------------
//
// An improvement campaign asks the factory for three things and nothing more: a draft that starts as a version it
// keeps, that draft held to the contract and kept as a CANDIDATE nobody is offered, and -- on evaluated evidence --
// which kept version runs from now on. What runs is chosen here, under the room's lock, by the factory's own rules;
// the campaign never writes this room.

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

const VERSION_DIR = /^(\d+\.\d+\.\d+)-[0-9a-f]{8}$/;

const versionsIn = (store, dir) => store.io.list(dir).map((n) => VERSION_DIR.exec(n)?.[1]).filter(Boolean);

const keptRooms = (store, id) => [store.inRoom(".versions", id), store.inRoom("archived", id), store.candidatesOf(id)];

const knownVersions = (store, id) => [entryOf(store, id)?.version, ...keptRooms(store, id).flatMap((dir) => versionsIn(store, dir))].filter(Boolean);

const newest = (versions) => [...versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) ?? null;

// The next version of a playbook: past EVERY version it keeps -- in place, kept aside, archived or waiting as a
// candidate -- so two versions never share a number.
const nextVersion = (store, id) => bumped(newest(knownVersions(store, id)));

const judgedBy = (rules, c) => {
  const failed = rules.find((r) => r.fails(c));
  if (failed) throw Object.assign(new Refused(`${failed.id}: ${failed.say(c)}`), { code: failed.code ?? failed.id });
};

// What a successor may be drafted for: an ACTIVE playbook, one of its kept versions, while a person lets candidates be
// generated at all. A playbook a person switched off is never improved behind their back.
export const SUCCESSOR_RULES = [
  { id: "SF_SUCCESSOR_OFF", fails: (c) => c.values?.improvement?.generate === false, say: () => "a person turned candidate generation off (improvement.generate) — no successor is drafted" },
  { id: "SF_WITHHELD", fails: (c) => c.row?.status !== "active" || c.row?.archived === true, say: (c) => `${c.id} is ${c.row ? (c.row.archived ? "archived" : c.row.status) : "not registered"} — only an active playbook is improved` },
  { id: "SF_UNKNOWN", fails: (c) => !c.parent || c.parent.id !== c.id, say: (c) => `${c.of} is no version of ${c.id} this project keeps` },
];

// s: { id, of: <pin>, campaign: <imp-…>, values } -> { id, draft, of, campaign, created }
export function scaffoldSuccessor(store, s) {
  const c = { ...s, row: entryOf(store, s.id), parent: quietly(() => pinned(store, s.of)) };
  judgedBy(SUCCESSOR_RULES, c);
  return locked(store, () => successorDrafted(store, s, c.parent));
}

const successorManifest = (m, s) => ({ ...unstampedManifest(m), successorOf: s.of, campaign: s.campaign, generationReason: `a successor of ${s.of}, drafted for ${s.campaign}: what changes is the host's to write, and an evaluation decides whether it runs` });

function successorDrafted(store, s, parent) {
  const existing = draftManifestOf(store, s.id);
  if (existing) return draftedAlready(store, s, existing);
  copyDir(store.io, parent.dir, store.draftDir(s.id));
  store.io.write(join(store.draftDir(s.id), MANIFEST), json(successorManifest(draftManifestOf(store, s.id), s)));
  return { id: s.id, draft: store.draftDir(s.id), of: s.of, campaign: s.campaign, created: true };
}

// The same campaign asking again is answered with its own draft; anybody else's draft is never taken over.
function draftedAlready(store, s, m) {
  if (m.campaign !== s.campaign || m.successorOf !== s.of) throw refused("SF_DRAFT_BUSY", `${s.id} already has a draft being written${m.campaign ? ` for ${m.campaign}` : " by a workflow"} — one draft per playbook at a time`);
  return { id: s.id, draft: store.draftDir(s.id), of: m.successorOf, campaign: m.campaign, created: false };
}

const digestOfPin = (store, pin) => ((row) => (row ? versionAt(store, row.dir)?.digest ?? null : null))(quietly(() => pinned(store, pin)));

// What a successor draft holds now: what it succeeds, whether its files already differ from that version (the host has
// written its change), and what its last refusal said. Reads only.
export function successorDraftOf(store, id) {
  const m = draftManifestOf(store, id);
  if (!m?.successorOf) return { exists: false, id };
  const digest = digestOf(filesIn(store.io, store.draftDir(id)));
  return { exists: true, id, successorOf: m.successorOf, campaign: m.campaign ?? null, digest, written: digest !== digestOfPin(store, m.successorOf), attempts: attemptsOf(store, id).n ?? 0, findings: attemptsOf(store, id).findings ?? [] };
}

// r: { values, deps, by, at, engineVersion } -> { ok, reused, id, version, digest, pin, status, successorOf, campaign } | { ok: false, findings }
export const stageCandidate = (store, id, r) => locked(store, () => staging(store, id, r));

const unstageable = (draft, id) => refused(draft.exists ? "SF_UNCHANGED" : "SF_NOT_SUCCESSOR", draft.exists ? `${id}'s successor still says what ${draft.successorOf} says — write what changes with skill-factory put first` : `${id} has no successor draft — an improvement campaign scaffolds one`);

// Counted and held to the contract under ONE hold of the lock, like a registration: a `put` landing between the
// verdict and the copy would stage files nobody verified.
function staging(store, id, r) {
  const draft = successorDraftOf(store, id);
  if (!draft.exists || !draft.written) throw unstageable(draft, id);
  attempted(store, id, r.values);
  const verdict = verifyDraft(store, id, r.deps);
  return verdict.ok ? stagedCandidate(store, id, r, draft) : refusedDraft(store, id, verdict);
}

// The same files a candidate already holds are that candidate, never a second one.
function stagedCandidate(store, id, r, draft) {
  const same = candidatesOf(store, id).find((c) => c.digest === draft.digest && c.intact);
  return same ? reusedCandidate(store, id, same) : placedCandidate(store, id, { ...r, draft, files: filesIn(store.io, store.draftDir(id)), version: nextVersion(store, id) });
}

function placedCandidate(store, id, p) {
  const dir = store.candidateDir(id, p.version, p.draft.digest);
  copyDir(store.io, store.draftDir(id), dir);
  store.io.write(join(dir, MANIFEST), json({ ...manifestIn(p.files), status: "candidate", version: p.version, digest: p.draft.digest, createdAt: p.at, verifiedAt: p.at, engineVersion: p.engineVersion, registeredBy: p.by }));
  store.io.remove(store.draftDir(id));
  return candidateResult(id, { version: p.version, digest: p.draft.digest, successorOf: p.draft.successorOf, campaign: p.draft.campaign }, false);
}

function reusedCandidate(store, id, c) {
  store.io.remove(store.draftDir(id));
  return candidateResult(id, c, true);
}

const candidateResult = (id, c, reused) => ({ ok: true, reused, id, version: c.version, digest: c.digest, pin: `${id}:${c.version}:${c.digest.slice(0, 8)}`, status: "candidate", successorOf: c.successorOf, campaign: c.campaign });

const candidateRow = (store, id, dir) => ((m) => (m?.digest && m?.version ? { id, version: m.version, digest: m.digest, pin: `${id}:${m.version}:${m.digest.slice(0, 8)}`, successorOf: m.successorOf ?? null, campaign: m.campaign ?? null, at: m.createdAt ?? null, intact: digestOf(filesIn(store.io, dir)) === m.digest, phase: phaseOf({ status: "candidate" }) } : null))(parsed(store.io.read(join(dir, MANIFEST)) ?? "null"));

// Every candidate a playbook keeps, oldest first, each saying whether its files are still what was staged. Reads only.
export const candidatesOf = (store, id) => store.io.list(store.candidatesOf(id)).filter((n) => VERSION_DIR.test(n)).map((n) => candidateRow(store, id, join(store.candidatesOf(id), n))).filter(Boolean).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));

// ---- what a kept version SAYS, as data -------------------------------------------------------------------------

// A file's digest as the version's own digest counts it: a manifest without what the engine stamped and without its
// provenance (who drafted it, why, what it succeeds), so a successor's own provenance is never a change.
const contentOfManifest = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => !STAMPED_KEYS.includes(k)));

const fileDigest = (f) => sha(f.name === MANIFEST ? canonicalJson(contentOfManifest(parsed(f.text))) : f.text ?? "");

const manifestWithout = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => !STAMPED.includes(k)));

// A kept version's manifest without what the engine stamped, its declared workflow, and each file's name and digest
// -- never a file's text: what an improvement campaign compares a candidate with its parent by. Reads only.
export function versionContentOf(store, pin) {
  const row = quietly(() => pinned(store, pin));
  if (!row) throw refused("SF_UNKNOWN", `${pin} is no playbook version this project keeps`);
  const files = filesIn(store.io, row.dir).filter((f) => f.kind === "file");
  const digest = versionAt(store, row.dir)?.digest ?? null;
  return { pin: row.pin, id: row.id, status: row.status, digest, intact: digestOf(files) === digest, manifest: manifestWithout(manifestIn(files)), workflow: parsedWorkflow(files.find((f) => f.name === WORKFLOW_FILE)?.text ?? "null") ?? null, files: files.map((f) => ({ name: f.name, digest: fileDigest(f) })) };
}

// A kept version held to TODAY's contract: what a promotion gate asks of a candidate before it is chosen.
export const validatePinned = (store, pin, deps) => ((row) => (row ? { pin: row.pin, ...validateSkill({ id: row.id, files: filesIn(store.io, row.dir).map(unstamped) }, deps) } : { pin, ok: false, findings: [{ id: "SF_UNKNOWN", says: `${pin} is no playbook version this project keeps` }] }))(quietly(() => pinned(store, pin)));

// ---- which kept version runs ------------------------------------------------------------------------------------

// The code every revision-protected write answers a stale caller with (src/store/revisioned.mjs STALE_REVISION).
const STALE = "STALE_REVISION";

const targetOf = (store, id, pin) => ((row) => (row && row.id === id ? { ...row, archived: row.dir.startsWith(store.paths.archived), intact: digestOf(filesIn(store.io, row.dir)) === versionAt(store, row.dir)?.digest } : null))(quietly(() => pinned(store, pin)));

// What must hold before a kept version is chosen to run, in order: the first that fails refuses and nothing moves. A
// person's switch always wins: a playbook disabled, retired or archived has no version chosen for it by anybody.
export const SELECT_RULES = [
  { id: "SF_SELECT_DOOR", fails: (c) => !SELECT_DOORS.includes(c.sel.door), say: () => "which version of a playbook runs is chosen by the improvement engine on evaluated evidence, or by a person in Orbit Control — never from a terminal" },
  { id: "SF_SELECT_POLICY", fails: (c) => c.sel.door === "improvement" && c.sel.values?.improvement?.promote !== true, say: () => "a person turned automatic promotion off (improvement.promote) — a person chooses the version in Orbit Control" },
  { id: "SF_SELECT_UNKNOWN", fails: (c) => !c.row, say: (c) => `${c.id} is not a registered playbook of this project` },
  { id: "SF_SELECT_WITHHELD", fails: (c) => c.row.status !== "active" || c.row.archived === true, say: (c) => `${c.id} is ${c.row.archived ? "archived" : c.row.status} — a person switched it off, and no version of it is chosen until a person moves it back` },
  { id: "SF_SELECT_STALE", code: STALE, fails: (c) => pinOf(c.row) !== c.sel.expect, say: (c) => `${c.id} runs ${pinOf(c.row)} now, not ${c.sel.expect ?? "the version named"} — read it again and decide on what is there` },
  { id: "SF_SELECT_QUARANTINED", fails: (c) => !intact(c.store, c.id), say: (c) => `${c.id}'s files in place changed after they were verified — it is registered again through the contract first` },
  { id: "SF_SELECT_TARGET", fails: (c) => !c.target || c.target.archived, say: (c) => `${c.sel.pin} is no version of ${c.id} kept for choosing${c.target?.archived ? " (a person archived it)" : ""}` },
  { id: "SF_SELECT_CHANGED", fails: (c) => !c.target.intact, say: (c) => `${c.sel.pin}'s files changed after they were verified — it is never chosen` },
  { id: "SF_SELECT_INVALID", fails: (c) => c.invalid().length > 0, say: (c) => `${c.sel.pin} no longer holds to the contract: ${c.invalid()[0].id}: ${c.invalid()[0].says}` },
];

const selectionFacts = (store, id, sel) => ((target) => ({ store, id, sel, row: entryOf(store, id), target, invalid: () => validateSkill({ id, files: filesIn(store.io, target.dir).map(unstamped) }, sel.deps).findings }))(targetOf(store, id, sel.pin));

// sel: { pin, expect, door, campaign?, values, deps, at } -> { ok, unchanged, id, from, pin, status, door }
export const selectVersion = (store, id, sel) => locked(store, () => selecting(store, id, sel));

// Choosing the version already in place changes nothing and says so: a promotion read back after a crash is never a
// second move.
function selecting(store, id, sel) {
  const c = selectionFacts(store, id, sel);
  judgedBy(SELECT_RULES, c);
  return c.target.pin === pinOf(c.row) ? { ok: true, unchanged: true, id, from: pinOf(c.row), pin: pinOf(c.row), status: c.row.status, door: sel.door } : selected(store, c);
}

// The version in place kept aside first (a task that pinned it still reads it), the chosen one copied in place with its
// sidecar, then the registry row -- the order a registration writes in.
function selected(store, c) {
  const m = versionAt(store, c.target.dir);
  keptAside(store, c.row);
  placedIn(store, c, m);
  store.saveRegistry(store.registry().map((r) => (r.id === c.id ? selectedRow(store, c, m) : r)));
  return { ok: true, unchanged: false, id: c.id, from: pinOf(c.row), pin: `${c.id}:${m.version}:${m.digest.slice(0, 8)}`, status: "active", door: c.sel.door };
}

function placedIn(store, c, m) {
  store.io.remove(store.dirOf(c.id));
  copyDir(store.io, c.target.dir, store.dirOf(c.id));
  store.io.write(join(store.dirOf(c.id), MANIFEST), json({ ...m, status: "active" }));
  store.io.write(join(store.dirOf(c.id), SIDECAR), json({ id: c.id, version: m.version, digest: m.digest, at: c.sel.at, by: c.sel.door }));
}

const selectedRow = (store, c, m) => ({ ...c.row, version: m.version, digest: m.digest, status: "active", provides: m.provides, needs: m.needs, optional: m.optional ?? [], signals: m.signals ?? [], runs: m.runs ?? "followed", summary: summaryOf(filesIn(store.io, store.dirOf(c.id)), m), rolledBackTo: undefined, selectedFrom: pinOf(c.row), selectedBy: c.sel.door, selectedAt: c.sel.at, campaign: c.sel.campaign ?? null });
