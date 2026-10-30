// WHERE improvement keeps what it keeps: one room in the project's machine store, beside the tasks and the skill
// factory's, and never in a repository.
//
//   <storeRoot>/improvement/
//     campaigns/<imp-id>/journal.jsonl    append-only: a campaign's ONLY state, every line in order
//     campaigns/<imp-id>/.lock            one writer per campaign at a time
//     campaigns/.lock                     one starter per project, so "one open campaign per subject" is checked and
//                                         kept in one step
//     opportunities/<opp-id>.json         one per fingerprint, rewritten whole as its evidence moves (schema 1); one
//                                         that cannot be read is reported and kept byte for byte, never rewritten
//     state/analysed.json                 when detection last ran here and what it saw (schema 1), for the debounce
//
// The journal keeps the task store's discipline (src/task/store.mjs), as its own copy because a campaign is not a
// task: a record passes the allow-list of its kind and the scrub on the way in, `at` is the store's own clock, a torn
// tail is ended before the next line, and a torn or garbled line is dropped on read and counted, never fatal.
// Rooms are created on the first WRITE and never on a read; every id is checked and every path kept in the room.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { scrubFields } from "../scrub.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { checkedId } from "../store/id.mjs";
import { withLock } from "../store/lock.mjs";
import { CAMPAIGN_SCHEMA, FREE_TEXT, KINDS, OPPORTUNITY_SCHEMA } from "./vocab.mjs";

export const DIR = "improvement";
export const JOURNAL = "journal.jsonl";
export const CAMPAIGN_ID = { type: "string", pattern: "^imp-[a-f0-9]{12}$" };
export const OPPORTUNITY_ID = { type: "string", pattern: "^opp-[a-f0-9]{16}$" };
export const STATE_SCHEMA = 1;

const BUSY = "another session is writing this improvement campaign — try again in a moment";
const STARTING = "another session is starting an improvement campaign in this project — try again in a moment";
const SAVING = "another session is saving an improvement opportunity — try again in a moment";

const isCampaignId = (id) => new RegExp(CAMPAIGN_ID.pattern).test(String(id ?? ""));

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

export function createImprovement(root, io) {
  const room = join(root, DIR);
  const at = (...parts) => contained(room, join(room, ...parts));
  const paths = { room, campaigns: at("campaigns"), opportunities: at("opportunities"), state: at("state"), analysed: at("state", "analysed.json") };
  const dirOf = (id) => at("campaigns", checkedId(id, CAMPAIGN_ID));
  return { root, io, host: io.host, paths, dirOf, ...journalOf(io, dirOf), ...opportunitiesOf(io, paths), ...stateOf(io, paths), list: () => io.list(paths.campaigns).filter(isCampaignId).sort(), transact: (id, fn) => locked(io, dirOf(id), fn, BUSY), starting: (fn) => locked(io, paths.campaigns, fn, STARTING) };
}

function locked(io, dir, fn, busy) {
  io.ensureDir(dir);
  return withLock(dir, fn, io, busy);
}

// ---- a campaign's journal -------------------------------------------------------------------------------

const journalOf = (io, dirOf) => ({ append: (id, kind, record) => appended(io, dirOf(id), kind, record), begin: (id, record) => begun(io, dirOf(id), record), read: (id) => readJournal(io, dirOf(id)), damaged: (id) => damagedLines(io, dirOf(id)), exists: (id) => io.exists(join(dirOf(id), JOURNAL)), journalFile: (id) => join(dirOf(id), JOURNAL) });

const tornTail = (io, file) => ((text) => (text && !text.endsWith("\n") ? "\n" : ""))(io.read(file));

const kept = (kind, record) => scrubFields(Object.fromEntries(KINDS[kind].fields.filter((k) => record[k] !== undefined).map((k) => [k, record[k]])), FREE_TEXT);

function appended(io, dir, kind, record) {
  if (!KINDS[kind]) throw new Refused(`an improvement campaign keeps no "${kind}" record — it keeps ${Object.keys(KINDS).join(", ")}`);
  const line = { at: io.now(), ...kept(kind, record), kind };
  io.append(join(dir, JOURNAL), `${tornTail(io, join(dir, JOURNAL))}${JSON.stringify(line)}\n`);
  return line;
}

function begun(io, dir, record) {
  if (io.exists(join(dir, JOURNAL))) throw new Refused(`improvement campaign ${record.id} already exists`);
  io.ensureDir(dir);
  return appended(io, dir, "started", { ...record, schema: CAMPAIGN_SCHEMA });
}

// The ONE reading of a journal line: what the whole-file reader keeps and what a live follower keeps.
export const journalLine = (line) => ((r) => (r && typeof r === "object" && typeof r.kind === "string" ? r : null))(parsed(line));

const linesOf = (io, dir) => ((text) => (text === null ? null : text.split(/\r?\n/).filter(Boolean)))(io.read(join(dir, JOURNAL)));

function readJournal(io, dir) {
  const lines = linesOf(io, dir);
  return lines === null ? null : lines.map(journalLine).filter(Boolean);
}

// How many lines a reader had to drop: reported by `doctor`, never repaired by rewriting the journal.
const damagedLines = (io, dir) => (linesOf(io, dir) ?? []).filter((l) => !journalLine(l)).length;

// ---- opportunities: one document per fingerprint ------------------------------------------------------------

const OPP_FILE = /^opp-[a-f0-9]{16}\.json$/;

const oppFile = (paths, id) => contained(paths.opportunities, join(paths.opportunities, `${checkedId(id, OPPORTUNITY_ID)}.json`));

// A document this release cannot read is reported as it is -- never rewritten, never dropped.
const readDoc = (io, file, id) => ((text) => (text === null ? null : ((doc) => (doc?.schema === OPPORTUNITY_SCHEMA && doc.id === id ? doc : { id, unreadable: doc ? "unsupported" : "corrupt" }))(parsed(text))))(io.read(file));

const opportunitiesOf = (io, paths) => ({ opportunity: (id) => readDoc(io, oppFile(paths, id), id), opportunities: () => io.list(paths.opportunities).filter((n) => OPP_FILE.test(n)).sort().map((n) => readDoc(io, oppFile(paths, n.slice(0, -5)), n.slice(0, -5))), saveOpportunity: (doc) => locked(io, paths.opportunities, () => savedOpportunity(io, paths, doc), SAVING), dropOpportunity: (id) => locked(io, paths.opportunities, () => io.removeFile(oppFile(paths, id)), SAVING) });

function savedOpportunity(io, paths, doc) {
  const current = readDoc(io, oppFile(paths, doc.id), doc.id);
  if (current?.unreadable) throw Object.assign(new Refused(`${doc.id} is ${current.unreadable} improvement state; file unchanged — doctor reports it`), { code: "IMP_INVALID" });
  writeAtomic(oppFile(paths, doc.id), `${JSON.stringify({ ...doc, schema: OPPORTUNITY_SCHEMA }, null, 2)}\n`, io, false);
  return { ...doc, schema: OPPORTUNITY_SCHEMA };
}

// ---- when detection last ran -------------------------------------------------------------------------------

const stateOf = (io, paths) => ({ analysed: () => ((doc) => (doc?.schema === STATE_SCHEMA ? doc : null))(parsed(io.read(paths.analysed) ?? "null")), setAnalysed: (doc) => (io.ensureDir(paths.state), writeAtomic(paths.analysed, `${JSON.stringify({ ...doc, schema: STATE_SCHEMA }, null, 2)}\n`, io, false)) });
