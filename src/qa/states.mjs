// FOUR states, never one.
//
// A single `status: planned | written | verified` was the field that let a plan
// call a scenario done because somebody had written a file. The four questions
// underneath it have different answers, different owners and different evidence:
//
//   design      is enough KNOWN to write this            -- the scenario says so
//   build       how far the CASE has got                 -- checked against disk
//   execution   what the RUNNER last said                -- read off the ledger
//   freshness   is that evidence about THIS revision     -- compared, or unknown
//
// Nothing here re-judges a run. A run decides PASS; this reads what it decided
// and asks the one question a verdict cannot answer about itself: was it about
// the plan as it stands now?
import { LINK_STATE, READY, verifies } from "./vocab.mjs";

// A scenario that states no readiness is read as READY -- the strictest reading,
// so an omission cannot buy a scenario an exemption from the rules below.
export const designOf = (s) => READY.get(s?.readiness) ?? { ...READY.get("ready"), assumed: true };

// The furthest link state that is TRUE of the files on disk. A link claiming
// `validated` about a case that does not validate is not evidence of anything,
// so the claim is checked rather than believed.
export function buildOf(s, world) {
  const links = (s?.cases ?? []).filter((l) => l && typeof l.id === "string");
  if (!links.length) return { state: "planned", claimed: null, links: [] };
  const judged = links.map((l) => linkState(l, world));
  return { state: lowest(judged), claimed: lowest(judged.map((j) => ({ state: j.claimed }))), links: judged };
}

function linkState(l, world) {
  const c = world.cases?.get(l.id) ?? null;
  const problems = c ? world.validate(c) : [`no case ${l.id}`];
  return { id: l.id, claimed: l.state ?? "planned", state: actual(l, c, problems), problems, case: c };
}

// Truthful about the file, and never above what the link itself claims: whether
// a case was dry-run is not something a directory listing can know.
function actual(l, c, problems) {
  if (!c) return "planned";
  if (problems.length) return "written";
  return LINK_STATE.get(l.state)?.dry ? "dry-run" : "validated";
}

const RANK = ["planned", "written", "validated", "dry-run"];

const lowest = (judged) => RANK[Math.min(...judged.map((j) => Math.max(0, RANK.indexOf(j.state))))] ?? "planned";

// The latest run per linked case, and the best the scenario can claim from them:
// a scenario is only executed when every case it links ran, and only verified
// when every one of them verified.
export function executionOf(s, world) {
  const ids = (s?.cases ?? []).map((l) => l?.id).filter(Boolean);
  const per = ids.map((id) => ({ id, run: latestRun(world.runs ?? [], id) }));
  return { cases: per, ran: per.length > 0 && per.every((r) => r.run), status: worst(per), verified: per.length > 0 && per.every((r) => verifies(r.run?.status)) };
}

const latestRun = (runs, id) => runs.filter((r) => r.case === id).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) ?? null;

// The least reassuring verdict among the cases, because a scenario is not
// verified by its best case.
function worst(per) {
  const statuses = per.map((r) => r.run?.status ?? null);
  if (!statuses.length) return null;
  return statuses.find((st) => !verifies(st)) ?? "PASS";
}

// Is this evidence about the plan AS IT STANDS? Three references, each of which
// answers fresh, stale or UNKNOWN -- and unknown is the answer whenever there is
// nothing to compare against. A tool that resolves "I cannot tell" to "fresh" is
// the tool that signs off a release on last month's run.
// The fourth, `case`, is the case itself: the sha of what the run ran against
// the sha of the file as it stands (src/dsl/digest.mjs). A run recorded before
// runs carried one says nothing either way, so it reads unknown until it runs
// again -- the same answer a missing fe_commit has always had.
const REFERENCES = [
  { name: "revision", of: (run, plan) => afterOrNot(run?.at, plan?.at), say: "the plan revision it was recorded against" },
  { name: "build", of: (run, plan, opts) => sameOrNot(run?.fe_commit, opts?.head ?? plan?.map?.fe_commit), say: "the frontend build" },
  { name: "environment", of: (run, plan, opts) => sameOrNot(run?.env, opts?.env), say: "the environment" },
  { name: "case", of: (run, plan, opts) => sameOrNot(run?.case_digest, opts?.digestOf?.(run?.case)), say: "the case as written — a PASS of an earlier version of it is not evidence for this one" },
];

export function freshnessOf(run, plan, opts = {}) {
  if (!run) return { state: "unknown", refs: [] };
  const refs = REFERENCES.map((r) => ({ name: r.name, say: r.say, state: r.of(run, plan, opts) }));
  return { state: overall(refs), refs };
}

function overall(refs) {
  if (refs.some((r) => r.state === "stale")) return "stale";
  return refs.every((r) => r.state === "fresh") ? "fresh" : "unknown";
}

// A run recorded BEFORE this plan revision was written cannot be evidence for
// it, whatever it said. With no date on either side there is nothing to compare.
const afterOrNot = (at, since) => (!at || !since ? "unknown" : String(at) >= String(since) ? "fresh" : "stale");

const sameOrNot = (a, b) => (!a || !b ? "unknown" : a === b ? "fresh" : "stale");
