// A SHIP, begun or carried on -- its id, its room, its task, the manifest frozen at its start, and the context every step
// is handed -- composed from the ports ship.mjs binds (a test hands fakes). And the two things a person asks of a ship
// without moving it: where it stands (`--status`), and whether what it qualified may be published (`--evidence`).
//
//   begunShip(world, o) -> ctx      resumedShip(world, id, o) -> ctx      statusOf(world, id) -> status
//   evidenceAsked(world, id, artifact) -> { publishable, code, says, ship }      protectedDigestOf(world, ref) -> hex
//   world: { root, env, now, storeRoot, project: { key, checkoutId }, policy, door, bench, git, gatesAt, workspaces,
//            print, everyMs }
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { sha, shaBytes } from "../../../src/hash.mjs";
import { contentDigest } from "./artifact.mjs";
import { begun, iso, runDiagnosis, runRoomOf, settledAct } from "./dispatch.mjs";
import { publishableOf } from "./evidence.mjs";
import { factsOf, lastCycleOf, nextOf, shipRows } from "./machine.mjs";
import { LIMIT_FLAGS, limitsOf, matchesAny, policyDigest, rowsOf } from "./policy.mjs";
import { docRead, docWritten, jsonAtFile, newShipId, shipRoomOf, shipsIn } from "./room.mjs";
import { casesIn, preflightFacts } from "./steps.mjs";

const said = (r) => String(r.out ?? "").trim();

const gitSays = (world, args) => said(world.git(world.root, args));

// Only HEAD is shipped: what the checkout holds beyond it is printed, never part of the ship.
const startOf = (world) => ({ branch: gitSays(world, ["rev-parse", "--abbrev-ref", "HEAD"]) || null, commit: gitSays(world, ["rev-parse", "HEAD"]), tree: gitSays(world, ["rev-parse", "HEAD^{tree}"]), dirty: gitSays(world, ["status", "--porcelain=v1", "--untracked-files=no"]).split("\n").filter(Boolean).map((l) => l.slice(3)) });

// What the ship judges with -- the harness, the checks, the release itself -- as one digest of a commit's own tree.
export const protectedDigestOf = (world, ref) => sha(gitSays(world, ["ls-tree", "-r", "--full-tree", ref]).split("\n").filter((l) => matchesAny(world.policy.protected, l.split("\t")[1] ?? "")).sort().join("\n"));

const endpointOf = (world) => {
  try { return world.env.ANTHROPIC_BASE_URL ? new URL(world.env.ANTHROPIC_BASE_URL).hostname : world.policy.host.endpoints[0]; }
  catch { return null; }
};

const OPTION_KEYS = ["model", "credential", "caFile"];

// The options a ship runs with: its mode frozen at its start (repair, fail fast), a host's names given again on resume.
const optionsOf = (manifest, o) => ({ ...manifest.options, ...Object.fromEntries(OPTION_KEYS.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]])) });

function contextOf(world, room, manifest, o) {
  const ship = { id: room.id, task: manifest.task, project: manifest.checkout.project, checkout: manifest.checkout.checkoutId, start: manifest.start };
  return { world, root: world.root, env: world.env, now: world.now, storeRoot: world.storeRoot, policy: world.policy, rows: [], cases: new Map(), door: world.door, task: manifest.task, room, manifest, ship, options: optionsOf(manifest, o), preflighted: false, deliveryDir: join(world.storeRoot, "workspaces", manifest.task, "delivery"), everyMs: world.everyMs, print: world.print, preflightFacts, endpoint: endpointOf(world), optional: world.optional ?? [], trail: [] };
}

const OBJECTIVES = { autonomous: ", repairing what a case declares repairable", "verify-only": ", verify only", precheck: ": a precheck, every model-carried row once, before a ship" };

const objectiveOf = (start, o) => `Ship ${o.version ?? ""} from ${start.branch ?? "detached"}@${start.commit.slice(0, 10)}: the Docker benchmark carried by Claude Code${OBJECTIVES[o.mode]}`;

const manifestOf = (world, room, task, start, o) => ({ schema: 1, kind: "ship", ship: room.id, task, at: iso(world), mode: o.mode, start, checkout: { root: world.root, project: world.project.key, checkoutId: world.project.checkoutId }, policy: { digest: policyDigest(world.policy) }, protected: { digest: protectedDigestOf(world, start.commit) }, limits: o.limitsHeld, options: { repair: o.repair === true, failFast: o.failFast !== false, model: o.model ?? null, credential: o.credential ?? null, caFile: o.caFile ?? null }, host: { node: process.version, platform: process.platform } });

// A PRECHECK (0.5.0, B6) runs every model-carried row once, in one cycle, repairs nothing and stops at no failure: the
// limits that would let it do more are a ship's, refused when a person asks them.
const PRECHECK_REFUSES = ["cycles", "repairAttempts", "autonomousRetries"];

const PRECHECK_LIMITS = { cycles: 1, flakyRetries: 0, autonomousRetries: 0 };

function shipRefused(says) {
  throw new Refused(says);
}

const precheckAsked = (world, o) => ((bad) => (bad.length ? shipRefused(`--precheck runs every model-carried row once, in one cycle: ${bad.map((k) => `--${LIMIT_FLAGS[k]}`).join(", ")} are a ship's`) : { ...o, mode: "precheck", repair: false, failFast: false, limitsHeld: { ...limitsOf(world.policy, o.limits ?? {}), ...PRECHECK_LIMITS } }))(PRECHECK_REFUSES.filter((k) => o.limits?.[k] !== undefined));

const shipAsked = (world, o) => (o.precheck ? precheckAsked(world, o) : { ...o, mode: o.repair ? "autonomous" : "verify-only", limitsHeld: limitsOf(world.policy, o.limits ?? {}) });

// What a person asked is held FIRST -- the limits to the policy's bounds, a precheck to what a precheck does: a ship
// refused for either starts no task and keeps no room.
export const begunShip = (world, o) => begunAt(world, shipAsked(world, o), startOf(world));

function begunAt(world, o, start) {
  const room = shipRoomOf(world.storeRoot, newShipId(`${world.root}\u0000${start.commit}`));
  const task = world.door.create(objectiveOf(start, o), { attempts: world.policy.bounds.cycles[1], actions: 2000 });
  docWritten(room, "manifest.json", manifestOf(world, room, task, start, o));
  return contextOf(world, room, docRead(room, "manifest.json"), o);
}

// ---- carried on ----------------------------------------------------------------------------------------------------------

// A blocked ship resumed: what blocked it is asked again, and the ending that recorded the block is kept as history.
function unblocked(ctx) {
  const was = docRead(ctx.room, "ending.json");
  if (was) (ctx.room.io.ensureDir(ctx.room.at("endings")), renameSync(ctx.room.at("ending.json"), ctx.room.at("endings", `${String(was.at ?? Date.now()).replace(/[^0-9A-Za-z]/g, "")}.json`)));
  ctx.door.unblock(ctx.task, "resumed: what blocked it is asked again");
  return resumeJournaled(ctx);
}

// The resume, as an action of its own in the ship's journal: a row its environment blocked before it is run again from
// here (DIAGNOSE), the fold reading where the resume stands among the actions -- never when it happened.
function resumeJournaled(ctx) {
  const act = begun(ctx, "release.resume", "a person resumed the blocked ship: what blocked it is asked again", {});
  settledAct(ctx, act, {}, { resumed: true }, { outcome: "succeeded", summary: "what blocked the ship is asked again" });
  return ctx;
}

// New limits a person gave on resume, within the policy's bounds: journaled as their own action, read by every fold.
function relimited(ctx, asked) {
  const limits = limitsOf(ctx.policy, asked);
  const act = begun(ctx, "release.limits", `limits a person set on resume: ${Object.entries(asked).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${v}`).join(", ")}`, {});
  settledAct(ctx, act, {}, { limits }, { outcome: "succeeded", summary: "the ship goes on within these limits" });
  return ctx;
}

const askedAny = (asked) => Object.values(asked ?? {}).some((v) => v !== undefined);

export function resumedShip(world, id, o) {
  const room = shipRoomOf(world.storeRoot, id);
  const manifest = docRead(room, "manifest.json") ?? missing(id, room);
  const ctx = contextOf(world, room, manifest, o);
  const view = world.door.show(ctx.task);
  return ((c) => (askedAny(o.limits) && !view.terminal && view.lifecycle !== "PAUSED" ? relimited(c, o.limits) : c))(view.lifecycle === "BLOCKED" ? unblocked(ctx) : ctx);
}

function missing(id, room) {
  throw new Refused(`no ship ${id} is kept in ${room.dir}`);
}

// ---- read without moving it ---------------------------------------------------------------------------------------------

const ofCheckout = (world, which = () => true) => shipsIn(world.storeRoot).filter((s) => s.manifest.checkout?.checkoutId === world.project.checkoutId && which(s));

// A precheck qualifies nothing, so --evidence never takes one for this checkout's newest ship.
const qualifying = (s) => s.manifest.mode !== "precheck";

const evidenceOfShip = (world, s) => docRead(shipRoomOf(world.storeRoot, s.id), "evidence.json");

// Which ship a question is about: the one named; else this checkout's newest that qualified the tree at HEAD; else
// this checkout's newest.
function chosen(world, id, headTree, which) {
  if (id) return { id, manifest: docRead(shipRoomOf(world.storeRoot, id), "manifest.json") ?? missing(id, shipRoomOf(world.storeRoot, id)) };
  const mine = ofCheckout(world, which);
  return mine.find((s) => evidenceOfShip(world, s)?.source?.tree === headTree) ?? mine[0] ?? null;
}

const listedOf = async (world) => (await world.bench(["list"], {})).json ?? null;

const catalogOf = async (world) => ((listed) => (listed ? rowsOf(world.policy, listed) : []))(await listedOf(world));

// What the ship does next: one still running goes on where its journal stands; any other is carried on by a resume,
// and a resume asks its preflight again before anything else (contextOf), so that is what it does first.
const nextAsked = (f, ctx) => (f.ended ? null : nextOf(f, { ...ctx, preflighted: f.view.lifecycle === "RUNNING" }).id);

const isHeld = (r) => r.v.state === "HELD";

// Every model-carried row that did not hold, with its diagnosis bundle and its run's room (dispatch.mjs runDiagnosis).
const diagnosesOf = (ctx, rows) => rows.filter((r) => r.row.autonomous && r.v.state !== "HELD").map((r) => runDiagnosis(ctx.storeRoot, r));

// A recorded row (ADR 0051), held or not, with its run's room -- said apart from the rows a release requires.
const recordedSaid = (ctx, r) => ({ id: r.row.id, held: isHeld(r), state: r.v.state, run: r.v.run ?? null, room: runRoomOf(ctx.storeRoot, String(r.v.run ?? "").split(" ")[0]).dir, runsAgain: r.diag?.then === "RETRY" });

// The rows of the newest cycle the release requires, by what each came to: held, and not held -- with the ones its
// diagnosis runs again; and, apart, the recorded ones.
const rowsSaid = (ctx, all) => ((rows) => ({ total: ctx.rows.filter((r) => !r.recorded).length, held: rows.filter(isHeld).length, heldRows: rows.filter(isHeld).map((r) => r.row.id), failed: rows.filter((r) => !isHeld(r)).map((r) => `${r.row.id} ${r.v.state}${r.diag?.then === "RETRY" ? " (runs again)" : ""}`), recorded: all.filter((r) => r.row.recorded).map((r) => recordedSaid(ctx, r)) }))(all.filter((r) => !r.row.recorded));

// A context to read a ship with: the catalog and each case's declaration as the checkout says them now.
async function readingOf(world, ship) {
  const listed = await listedOf(world);
  const ctx = contextOf(world, shipRoomOf(world.storeRoot, ship.id), ship.manifest, {});
  return { ...ctx, rows: listed ? shipRows(ctx, listed) : [], cases: casesIn(world.root, listed), preflighted: true };
}

// Where a ship stands. Its rows and repairs are the newest cycle's, open or closed: a ship that shipped, stopped or ended
// on a failed row says what it held and what it did not in the cycle it ended in.
export async function statusOf(world, id) {
  const ship = chosen(world, id, gitSays(world, ["rev-parse", "HEAD^{tree}"]));
  if (!ship) return { found: false, says: "no ship has run on this checkout: node skills/orbit-release/ship.mjs" };
  const ctx = await readingOf(world, ship);
  const f = factsOf(ctx, world.door.show(ctx.task));
  return ((c) => ({ found: true, ship: ship.id, task: ctx.task, lifecycle: f.view.lifecycle, stage: f.view.stage ?? null, mode: ship.manifest.mode, start: ship.manifest.start, commit: f.current.commit, cycle: f.attempts, cycleOpen: Boolean(f.open), rows: rowsSaid(ctx, [...c.rows.values()]), diagnoses: diagnosesOf(ctx, [...c.rows.values()]), repairs: c.repairs.map((r) => `${r.case} ${r.state}`), spent: f.spent, limits: f.limits, next: nextAsked(f, ctx), ending: docRead(ctx.room, "ending.json"), evidence: existsSync(ctx.room.at("evidence.json")) ? ctx.room.at("evidence.json") : null, room: ctx.room.dir }))(lastCycleOf(ctx, f));
}

// The artifact as the evidence names it -- its file, digested again -- or a person's own archive of the same tree, by
// its content.
function artifactOf(ev, file) {
  if (file) return existsSync(file) && contentDigest(readFileSync(file)) === ev?.artifact?.content ? { ok: true } : { ok: false, says: `${file} is not an archive of the qualified tree (its content differs from the evidence's)` };
  return ev?.artifact?.file && existsSync(ev.artifact.file) && shaBytes(readFileSync(ev.artifact.file)) === ev.artifact.sha256 ? { ok: true } : { ok: false, says: "the qualified artifact is gone or no longer the file the evidence names: build the archive again (--artifact=<zip> checks it by content)" };
}

// What the policy asks of the checkout NOW: the rows it requires, the ones it records, and how each is held to its room.
const nowOf = (world, rows) => ({ protected: protectedDigestOf(world, "HEAD"), policy: policyDigest(world.policy), rows: rows.filter((r) => !r.recorded).map((r) => r.id), recorded: rows.filter((r) => r.recorded).map((r) => r.id), autonomous: new Set(rows.filter((r) => r.autonomous).map((r) => r.id)), single: new Set(rows.filter((r) => r.run !== "controls").map((r) => r.id)) });

export async function evidenceAsked(world, id, artifact = null) {
  const head = { tree: gitSays(world, ["rev-parse", "HEAD^{tree}"]), dirty: gitSays(world, ["status", "--porcelain=v1", "--untracked-files=no"]).split("\n").filter(Boolean) };
  const ship = chosen(world, id, head.tree, qualifying);
  const room = ship ? shipRoomOf(world.storeRoot, ship.id) : null;
  const ev = room ? docRead(room, "evidence.json") : null;
  return publishableOf({ ship, view: ship ? world.door.show(ship.manifest.task) : null, evidence: ev, ending: room ? docRead(room, "ending.json") : null, head, now: nowOf(world, await catalogOf(world)), rooms: (run) => runRoomOf(world.storeRoot, run), artifact: artifactOf(ev, artifact) });
}

export { jsonAtFile };
