// A QC tool's life: scaffolded in scratch, VERIFIED, then registered — and the
// order is the whole design.
//
// Generated executable code is a trust boundary. The rule that makes it safe is
// not review (nobody reads a generated adapter line by line) but that a candidate
// is held to exactly the contract a registered tool is held to, by exactly the
// same loader, BEFORE it is anywhere the runtime will find it. There is no
// "validation mode": verify() loads the candidate for real, into a throwaway
// context, and reports what the real loader said.
//
// That is also why `status` exists and why `draft` is never loaded. A tool that
// was generated and not proved is inert: it sits in the store, `query extensions`
// says what it is, and nothing runs it. Promotion to `verified` is a separate,
// deliberate act with evidence behind it.
import { dirname, join } from "node:path";
import { Refused } from "../errors.mjs";
import { moveRetried } from "../store/atomic.mjs";
import { withLock } from "../store/lock.mjs";
import { engineVersion } from "../version.mjs";
import { MANIFEST_FILE } from "./contract.mjs";
import { SIDECAR, digestOfAll, filesOf, fingerprintOf, readSidecar, registeredState, sidecarText } from "./fingerprint.mjs";
import { loadExtensions } from "./loader.mjs";
import { manifestFindings } from "./manifest.mjs";
import { emptyRegistries } from "./registries.mjs";
import { createQcTools } from "./store.mjs";

// A room over ONE directory, for verifying something that is not in the store.
// The status is read as `verified` here and only here, because that is exactly
// the question being asked: "would this load IF it were trusted?" A candidate is
// a draft by definition -- it is what is being verified -- so refusing it for
// being one would leave the check unable to ever answer yes. What is on disk is
// untouched; only registerTool() promotes it, and only after this said yes.
const roomOver = (dir, id, io) => ({
  ids: () => [id],
  dirOf: () => dir,
  manifestOf: () => join(dir, MANIFEST_FILE),
  readManifest: () => asIfTrusted(io.read(join(dir, MANIFEST_FILE))),
  readFile: (file) => io.read(file),
});

function asIfTrusted(text) {
  if (!text) return text;
  try { return JSON.stringify({ ...JSON.parse(text), status: "verified" }); }
  catch { return text; }
}

// A context with nothing real in it. Whatever a candidate registers goes here and
// is thrown away, so verifying cannot leave a half-registered tool behind in the
// context a run would use -- every registry fresh, the knowledge one included,
// so what a candidate teaches project knowledge is verified like the rest.
const throwaway = (ctx) => ({ ...ctx, ...emptyRegistries() });

export async function verifyTool(ctx, dir, io, id = "candidate") {
  const shape = shapeOf(dir, id, io);
  if (!shape.ok) return shape;
  const out = await loadExtensions(throwaway(ctx), { tools: roomOver(dir, shape.manifest.id, io) });
  return judged(out, shape.manifest);
}

// The manifest alone, before anything is imported: a candidate whose manifest is
// wrong should be told THAT, rather than a module-resolution error caused by it.
function shapeOf(dir, id, io) {
  const text = io.read(join(dir, MANIFEST_FILE));
  if (!text) return { ok: false, findings: [`${dir}: no ${MANIFEST_FILE}`] };
  const parsed = json(text, dir);
  if (!parsed.ok) return parsed;
  return checked(parsed.manifest, dir);
}

function json(text, dir) {
  try { return { ok: true, manifest: JSON.parse(text) }; }
  catch (e) { return { ok: false, findings: [`${dir}/${MANIFEST_FILE}: not readable JSON — ${e.message}`] }; }
}

function checked(manifest, dir) {
  const found = manifestFindings(manifest, `${dir}/${MANIFEST_FILE}`);
  return found.length ? { ok: false, findings: found, manifest } : { ok: true, manifest };
}

// A candidate is verified when the loader LOADED it, and reported nothing.
function judged(out, manifest) {
  if (out.refused.length) return { ok: false, findings: out.refused.map((r) => r.why), manifest };
  return { ok: true, manifest, loaded: out.loaded[0] ?? null };
}

// Only a VERIFIED candidate moves into the store. Refused, not skipped: a builder
// that could register an unproved tool is a builder whose verification step is
// decoration.
//
// `opts.human` is a PERSON's registration, relayed. It is the only thing that
// may replace an extension whose files were edited by hand in the store after
// it was registered: Orbit never overwrites a person's change on its own.
//
// `opts.check(dir, verdict)` is what a composition root adds on top of the
// loader for what an extension declares -- the report runner's checks run the
// part for real. Its findings refuse the registration exactly as the loader's
// do, and this file never learns what they are about.
export async function registerTool(ctx, dir, io, entry = {}, opts = {}) {
  const verdict = await verifyTool(ctx, dir, io);
  if (!verdict.ok) throw new Refused(`this tool is not verified, so it is not registered:\n  ${verdict.findings.join("\n  ")}`);
  const more = opts.check ? await opts.check(dir, verdict) : [];
  if (more.length) throw new Refused(`this tool did not pass its checks, so it is not registered:\n  ${more.join("\n  ")}`);
  return kept(ctx, dir, io, verdict, { entry, by: opts.human ? "person" : "orbit" });
}

function kept(ctx, dir, io, verdict, how) {
  const tools = createQcTools(ctx.store(true), io);
  const id = verdict.manifest.id;
  unedited(tools, id, how, dir, io);
  installed(tools, id, staged(tools, verdict.manifest, dir, io, how.by), io);
  return recorded(tools, verdict, { ...how.entry, registeredBy: how.by }, io);
}

function unedited(tools, id, how, dir, io) {
  const now = registeredState(tools.dirOf(id), io);
  if (now.state === "changed" && how.by !== "person") throw new Refused(`${id} was edited in the store after it was registered (${now.changed.join(", ")}), and Orbit does not overwrite a person's change. A person may register over it (--human), or it can be registered as a new version from ${dir}`);
}

// Flat by design: an extension is a manifest and a few files beside it, and a
// tool that needed a directory tree is a tool that has stopped being the
// smallest thing that works. Copied as BYTES into a staging directory beside
// the final one, stamped there (status verified, the registration record), and
// only then moved into place -- so a failure half way leaves the old version
// whole, and a reader never sees a mix of two.
function staged(tools, manifest, dir, io, by) {
  const stage = join(tools.paths.root, ".staging", `${manifest.id}-${io.nowMs().toString(36)}-${io.pid}`);
  io.ensureDir(stage);
  for (const name of flatFiles(dir, io)) io.copy(join(dir, name), join(stage, name));
  return stamp(stage, manifest, io, by);
}

function stamp(stage, manifest, io, by) {
  promote(stage, io);
  io.write(join(stage, SIDECAR), sidecarText({ id: manifest.id, version: manifest.version, files: fingerprintOf(stage, io), at: io.now(), by }));
  return stage;
}

const ENTRY_KINDS = { dir: (n) => `${n} is a directory; an extension is flat — a manifest and the files beside it`, symlink: (n) => `${n} is a symbolic link; an extension's files are copied, never linked`, other: (n) => `${n} is not a regular file` };

function flatFiles(dir, io) {
  const names = io.list(dir).filter((n) => !n.startsWith(".")).sort();
  const wrong = names.map((n) => ENTRY_KINDS[io.kind?.(join(dir, n)) ?? "file"]?.(n)).filter(Boolean);
  if (wrong.length) throw new Refused(`${dir} cannot be registered: ${wrong.join("; ")}`);
  return names;
}

// The manifest that lands in the store says `verified`, whatever the scratch copy
// said, because that is what just happened to it.
function promote(dir, io) {
  const file = join(dir, MANIFEST_FILE);
  const manifest = { ...JSON.parse(io.read(file)), status: "verified" };
  io.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

// Under the room's lock: the version in place moves to .versions/<id>/, keyed
// by its version and what its files hash to, and the staged one takes its place.
function installed(tools, id, stage, io) {
  return withLock(tools.paths.root, () => swapped(tools, id, stage, io), io);
}

function swapped(tools, id, stage, io) {
  const target = tools.dirOf(id);
  if (io.exists(join(target, MANIFEST_FILE))) keptAside(tools, id, target, io);
  return moveRetried(stage, target, io);
}

function keptAside(tools, id, target, io) {
  const into = versionDir(tools, id, readSidecar(target, io)?.version ?? versionOf(target, io), digestOfAll(fingerprintOf(target, io)));
  if (io.exists(into)) io.remove(into);
  io.ensureDir(dirname(into));
  moveRetried(target, into, io);
}

const versionDir = (tools, id, version, digest) => join(tools.paths.root, ".versions", id, `${version}-${digest.slice(0, 8)}`);

function versionOf(dir, io) {
  try { return JSON.parse(io.read(join(dir, MANIFEST_FILE))).version ?? "0.0.0"; }
  catch { return "0.0.0"; }
}

// The versions kept aside for one extension, newest registration first.
export function versionsOf(ctx, id, io) {
  const tools = createQcTools(ctx.store(false), io);
  const room = join(tools.paths.root, ".versions", id);
  return io.list(room).map((name) => ({ name, dir: join(room, name), ...(readSidecar(join(room, name), io) ?? {}) })).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
}

// Back to a version kept aside -- VERIFIED again first, because the engine it
// was verified by may not be this one. The version in place is kept aside in
// turn, so a rollback can itself be rolled back.
export async function rollbackTool(ctx, id, io, { to = null, human = false, check = null } = {}) {
  const chosen = versionsOf(ctx, id, io).find((v) => !to || v.version === to || v.name === to);
  if (!chosen) throw new Refused(`no kept version of ${id}${to ? ` matches ${to}` : ""}; nothing to roll back to`);
  return registerTool(ctx, chosen.dir, io, { rolledBackTo: chosen.version }, { human, check });
}

function recorded(tools, verdict, entry, io) {
  const row = { id: verdict.manifest.id, kind: kindOf(verdict), apiVersion: verdict.manifest.apiVersion, status: "verified", createdFor: verdict.manifest.createdFor ?? "QC", scope: "project", engine: engineVersion(), lastVerified: io.now(), ...entry };
  tools.record(row);
  return { id: row.id, at: tools.dirOf(row.id), entry: row };
}

// What it IS, read off what it actually registered rather than off a word
// somebody typed. A tool that claims to be a capability and registered none is a
// tool whose registry line would be a lie.
function kindOf(verdict) {
  const loaded = verdict.loaded ?? {};
  const kinds = [["capability", loaded.capabilities], ["verb", loaded.verbs], ["validator", loaded.validators], ["knowledge", [...(loaded.relations ?? []), ...(loaded.interpreters ?? [])]], ["report", loaded.reportParts]].filter(([, l]) => l?.length);
  return kinds.map(([k]) => k).join("+") || "none";
}

// Moving an extension to verified or active trusts its files, so it is refused
// when they are not the files that were registered: that status would vouch for
// something nobody verified.
export function setStatus(ctx, id, status, io) {
  const tools = createQcTools(ctx.store(true), io);
  const text = io.read(tools.manifestOf(id));
  if (!text) throw new Refused(`no QC tool "${id}" in this project's store`);
  trustable(tools, id, status, io);
  return stamped(tools, tools.manifestOf(id), text, status, io);
}

const TRUSTING = new Set(["verified", "active"]);

function trustable(tools, id, status, io) {
  const now = registeredState(tools.dirOf(id), io);
  if (TRUSTING.has(status) && now.state === "changed") throw new Refused(`${id}'s files changed after it was registered (${now.changed.join(", ")}), so they are not the files that were verified; register it again (a person's edit: --human) before making it ${status}`);
}

function stamped(tools, file, text, status, io) {
  const manifest = { ...JSON.parse(text), status };
  io.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
  tools.record({ ...(tools.entry(manifest.id) ?? { id: manifest.id }), status, changedAt: io.now() });
  return { id: manifest.id, status };
}
