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
import { begun, iso, runRoomOf, settledAct } from "./dispatch.mjs";
import { publishableOf } from "./evidence.mjs";
import { factsOf, nextOf } from "./machine.mjs";
import { limitsOf, matchesAny, policyDigest, rowsOf } from "./policy.mjs";
import { docRead, docWritten, jsonAtFile, newShipId, shipRoomOf, shipsIn } from "./room.mjs";
import { preflightFacts } from "./steps.mjs";

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

const objectiveOf = (start, o) => `Ship ${o.version ?? ""} from ${start.branch ?? "detached"}@${start.commit.slice(0, 10)}: the Docker benchmark carried by Claude Code${o.repair ? ", repairing what a case declares repairable" : ", verify only"}`;

const manifestOf = (world, room, task, start, o) => ({ schema: 1, kind: "ship", ship: room.id, task, at: iso(world), mode: o.repair ? "autonomous" : "verify-only", start, checkout: { root: world.root, project: world.project.key, checkoutId: world.project.checkoutId }, policy: { digest: policyDigest(world.policy) }, protected: { digest: protectedDigestOf(world, start.commit) }, limits: limitsOf(world.policy, o.limits ?? {}), options: { repair: o.repair === true, failFast: o.failFast !== false, model: o.model ?? null, credential: o.credential ?? null, caFile: o.caFile ?? null }, host: { node: process.version, platform: process.platform } });

export function begunShip(world, o) {
  const start = startOf(world);
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

const ofCheckout = (world) => shipsIn(world.storeRoot).filter((s) => s.manifest.checkout?.checkoutId === world.project.checkoutId);

const evidenceOfShip = (world, s) => docRead(shipRoomOf(world.storeRoot, s.id), "evidence.json");

// Which ship a question is about: the one named; else this checkout's newest that qualified the tree at HEAD; else
// this checkout's newest.
function chosen(world, id, headTree) {
  if (id) return { id, manifest: docRead(shipRoomOf(world.storeRoot, id), "manifest.json") ?? missing(id, shipRoomOf(world.storeRoot, id)) };
  const mine = ofCheckout(world);
  return mine.find((s) => evidenceOfShip(world, s)?.source?.tree === headTree) ?? mine[0] ?? null;
}

const catalogOf = async (world) => ((r) => (r.json ? rowsOf(world.policy, r.json) : []))(await world.bench(["list"], {}));

export async function statusOf(world, id) {
  const ship = chosen(world, id, gitSays(world, ["rev-parse", "HEAD^{tree}"]));
  if (!ship) return { found: false, says: "no ship has run on this checkout: node skills/orbit-release/ship.mjs" };
  const ctx = { ...contextOf(world, shipRoomOf(world.storeRoot, ship.id), ship.manifest, {}), rows: await catalogOf(world), preflighted: true };
  const f = factsOf(ctx, world.door.show(ctx.task));
  return { found: true, ship: ship.id, task: ctx.task, lifecycle: f.view.lifecycle, stage: f.view.stage ?? null, mode: ship.manifest.mode, start: ship.manifest.start, commit: f.current.commit, cycle: f.attempts, rows: { total: ctx.rows.length, held: [...f.rows.values()].filter((r) => r.v.state === "HELD").length, failed: [...f.rows.values()].filter((r) => r.v.state !== "HELD").map((r) => `${r.row.id} ${r.v.state}`) }, repairs: f.repairs.map((r) => `${r.case} ${r.state}`), spent: f.spent, limits: f.limits, next: f.ended ? null : nextOf(f, ctx).id, ending: docRead(ctx.room, "ending.json"), evidence: existsSync(ctx.room.at("evidence.json")) ? ctx.room.at("evidence.json") : null, room: ctx.room.dir };
}

// The artifact as the evidence names it -- its file, digested again -- or a person's own archive of the same tree, by
// its content.
function artifactOf(ev, file) {
  if (file) return existsSync(file) && contentDigest(readFileSync(file)) === ev?.artifact?.content ? { ok: true } : { ok: false, says: `${file} is not an archive of the qualified tree (its content differs from the evidence's)` };
  return ev?.artifact?.file && existsSync(ev.artifact.file) && shaBytes(readFileSync(ev.artifact.file)) === ev.artifact.sha256 ? { ok: true } : { ok: false, says: "the qualified artifact is gone or no longer the file the evidence names: build the archive again (--artifact=<zip> checks it by content)" };
}

const nowOf = (world, rows) => ({ protected: protectedDigestOf(world, "HEAD"), policy: policyDigest(world.policy), rows: rows.map((r) => r.id), autonomous: new Set(rows.filter((r) => r.autonomous).map((r) => r.id)), single: new Set(rows.filter((r) => r.run !== "controls").map((r) => r.id)) });

export async function evidenceAsked(world, id, artifact = null) {
  const head = { tree: gitSays(world, ["rev-parse", "HEAD^{tree}"]), dirty: gitSays(world, ["status", "--porcelain=v1", "--untracked-files=no"]).split("\n").filter(Boolean) };
  const ship = chosen(world, id, head.tree);
  const room = ship ? shipRoomOf(world.storeRoot, ship.id) : null;
  const ev = room ? docRead(room, "evidence.json") : null;
  return publishableOf({ ship, view: ship ? world.door.show(ship.manifest.task) : null, evidence: ev, ending: room ? docRead(room, "ending.json") : null, head, now: nowOf(world, await catalogOf(world)), rooms: (run) => runRoomOf(world.storeRoot, run), artifact: artifactOf(ev, artifact) });
}

export { jsonAtFile };
