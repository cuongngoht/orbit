// The KNOWLEDGE room inside a project's machine store, and the port over it.
//
// Where the store is at all is src/store/, shared with every other memory; what
// rooms it has is each subsystem's own business, and this is that business
// here. The layout keeps every rule the other rooms keep:
//
//   claims/<id>.json          one file per claim, so two writers never meet and
//                             a torn byte costs one claim, which is reported and
//                             left exactly as it is
//   state/model.json          what each watched scope hashed to (the freshness
//                             baseline) -- bookkeeping, never a claim
//   journal/<host>.jsonl      every reconciliation, appended BEFORE the claim is
//                             saved, append-only for deterministic replay
//   opportunities/<id>.json   capability opportunities, as schema'd documents
//                             (src/store/control.mjs readState/writeState: a
//                             unsupported or corrupt schema refused unchanged)
//   vocabulary/*.json         this project's own relation rows -- the one
//                             directory a PERSON writes into
//
// The organisation's room sits beside the projects under the store base and is
// only ever READ here. Nothing in this file writes into a repository.
import { Refused } from "../errors.mjs";
import { join } from "node:path";
import { writeAtomic } from "../store/atomic.mjs";
import { readState, writeState } from "../store/control.mjs";
import { withLock } from "../store/lock.mjs";
import { CLAIM_VERSION, emptyModel, usableModel } from "./model.mjs";

export const DIR = "knowledge";
export const OPPORTUNITY_SCHEMA = 1;

export const knowledgePaths = (root) => ({
  root: join(root, DIR),
  claims: join(root, DIR, "claims"),
  state: join(root, DIR, "state"),
  model: join(root, DIR, "state", "model.json"),
  journal: join(root, DIR, "journal"),
  findings: join(root, DIR, "findings"),
  opportunities: join(root, DIR, "opportunities"),
  vocabulary: join(root, DIR, "vocabulary"),
});

export const organizationPaths = (storeBase) => ({
  root: join(storeBase, "organization", "knowledge"),
  vocabulary: join(storeBase, "organization", "knowledge", "vocabulary"),
  claims: join(storeBase, "organization", "knowledge", "claims"),
});

export function createKnowledge(root, io) {
  const paths = knowledgePaths(root);
  const c = { paths, io };
  return { root, paths, host: io.host, ...claimApi(c), ...stateApi(c), ...logApi(c), ...opportunityApi(c), transact: (fn) => transact(c, fn) };
}

// Reconciliation reads a claim and writes it back, so two sessions recording at
// once take turns. The lock lives in state/, beside the model it guards.
function transact(c, fn) {
  c.io.ensureDir(c.paths.state);
  return withLock(c.paths.state, fn, c.io);
}

const claimFile = (c, id) => join(c.paths.claims, `${id}.json`);

const claimApi = (c) => ({
  all: () => allClaims(c),
  find: (id) => oneClaim(c, `${id}.json`, false),
  has: (id) => c.io.exists(claimFile(c, id)),
  count: () => claimNames(c).length,
  save: (claim) => writeAtomic(claimFile(c, claim.id), `${JSON.stringify(claim, null, 2)}\n`, c.io),
});

const claimNames = (c) => c.io.list(c.paths.claims).filter((n) => n.endsWith(".json"));

// Reading never creates. A project nobody has taught anything leaves nothing.
const allClaims = (c) => claimNames(c).map((n) => oneClaim(c, n, true)).filter(Boolean);

// A claim this tool cannot read -- torn, or written in a format it does not
// know -- is REPORTED and left exactly as it is, never rewritten or deleted.
function oneClaim(c, name, report) {
  const claim = parsed(c.io.read(join(c.paths.claims, name)));
  const usable = claim && claim.v === CLAIM_VERSION ? claim : null;
  if (!usable && report) c.io.note({ kind: "unreadable-claim", say: `${name} is not a claim this engine can read — it is left exactly as it is` });
  return usable;
}

// Written only inside `transact` (src/knowledge/ingest.mjs), which already holds
// the lock this would otherwise need.
const stateApi = (c) => ({
  model: () => readModel(c),
  setModel: (m) => checkedWrite(c, m),
  emptyModel: (now) => emptyModel(now),
});

function readModel(c) {
  const text = c.io.read(c.paths.model);
  if (text === null) return { model: null, why: "nothing has recorded knowledge about this project yet" };
  return checkedModel(usableModel(parsed(text)));
}

// The journal and the findings: appended, sharded per host so a shared store
// never has two machines writing one file, and read back as one list -- a torn
// line dropped, the file kept.
const logApi = (c) => ({
  journal: (line) => journaled(c, line),
  journalLines: () => readLines(c, c.paths.journal),
  addFinding: (f) => c.io.append(join(c.paths.findings, `${hostFile(c)}.jsonl`), `${JSON.stringify({ at: c.io.now(), host: c.io.host, ...f })}\n`),
  findings: () => readLines(c, c.paths.findings),
});

const hostFile = (c) => String(c.io.host ?? "host").replace(/[^A-Za-z0-9._-]/g, "_");

function journaled(c, line) {
  const file = join(c.paths.journal, `${hostFile(c)}.jsonl`);
  c.io.append(file, `${JSON.stringify(line)}\n`);
}

function readLines(c, dir) {
  const files = c.io.list(dir).filter((n) => n.endsWith(".jsonl")).sort();
  return files.flatMap((n) => String(c.io.read(join(dir, n)) ?? "").split("\n").filter(Boolean).map(parsed).filter(Boolean));
}

const opportunityFile = (c, id) => join(c.paths.opportunities, `${id}.json`);

const opportunityApi = (c) => ({
  opportunities: () => c.io.list(c.paths.opportunities).filter((n) => n.endsWith(".json")).sort().map((n) => readState(c.io, join(c.paths.opportunities, n), {}, OPPORTUNITY_SCHEMA)).filter((d) => d.id && !d.unreadable),
  opportunity: (id) => opportunityOf(c, id),
  saveOpportunity: (doc) => writeState(c.io, opportunityFile(c, doc.id), doc, OPPORTUNITY_SCHEMA),
  vocabularyDir: () => c.paths.vocabulary,
});

function opportunityOf(c, id) {
  const doc = readState(c.io, opportunityFile(c, id), {}, OPPORTUNITY_SCHEMA);
  return doc.id && !doc.unreadable ? doc : null;
}

function parsed(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function checkedModel(verdict) {
  if (verdict.why) throw new Refused(verdict.why);
  return verdict;
}

function checkedWrite(c, model) {
  readModel(c);
  return writeAtomic(c.paths.model, `${JSON.stringify(model, null, 2)}\n`, c.io);
}
