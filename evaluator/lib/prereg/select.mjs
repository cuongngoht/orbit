// THE SELECTION RULE of a pre-registration, as code, so the task lists it names are re-derived from the rule and the
// pinned dataset instead of being taken on trust: SWE-bench Verified rows in the stated difficulty strata, from the
// repositories whose instance images fit the disk; the eligible repositories shuffled with the seed and dealt
// alternately to dev and held-out (so the two sets never share a repository); each set's instances ordered by taking
// one from each of its repositories in turn (each repository's own instances shuffled with the seed); an instance whose
// own image is over the size limit passed over. Packs: the dev fixture's and the held-out fixture's, each shuffled with
// the seed. The ORDER is fixed by the rule; how many are taken from the top of each list is a separate, later decision.
//
//   repoSplit(repos, seed) -> { dev, heldOut }     orderedInstances(rows, repos, rule) -> [id]
//   selection(rows, packIds, rule, sizes) -> { repos, dev: { swebench, packs }, heldOut: { swebench, packs }, passedOver }
import { seededShuffle } from "../core/util.mjs";

export const STRATA = ["<15 min fix", "15 min - 1 hour"];

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The repositories whose measured image is within the limit, in name order (the order the seed shuffles).
export const eligibleRepos = (rule) => Object.entries(rule.repoImages).filter(([, m]) => m.compressedBytes <= rule.maxCompressedBytes).map(([repo]) => repo).sort(byText);

export function repoSplit(repos, seed) {
  const shuffled = seededShuffle([...repos].sort(byText), seed);
  return { dev: shuffled.filter((_, i) => i % 2 === 0), heldOut: shuffled.filter((_, i) => i % 2 === 1) };
}

// One instance from each repository in turn, each repository's in-strata instances shuffled with the seed.
export function orderedInstances(rows, repos, rule) {
  const per = repos.map((repo) => seededShuffle(rows.filter((r) => r.repo === repo && rule.strata.includes(r.difficulty)).map((r) => r.instance_id).sort(byText), rule.seed));
  const longest = Math.max(0, ...per.map((l) => l.length));
  return Array.from({ length: longest }, (_, i) => per.map((l) => l[i]).filter(Boolean)).flat();
}

// The list after passing over an instance whose own image is over the limit (`sizes`: instance -> compressed bytes; an
// instance not measured is kept only up to the first unmeasured one, so a list is never longer than what was measured).
export function measuredTop(ids, sizes, rule) {
  const kept = [];
  const passedOver = [];
  for (const id of ids) {
    if (!(id in sizes)) break;
    (sizes[id] <= rule.maxCompressedBytes ? kept : passedOver).push(id);
  }
  return { kept, passedOver };
}

export function selection(rows, packIds, rule, sizes = {}) {
  const repos = repoSplit(eligibleRepos(rule), rule.seed);
  const dev = measuredTop(orderedInstances(rows, repos.dev, rule), sizes, rule);
  const held = measuredTop(orderedInstances(rows, repos.heldOut, rule), sizes, rule);
  const packs = (prefix) => seededShuffle(packIds.filter((id) => id.startsWith(prefix)).sort(byText), rule.seed);
  return { repos, dev: { swebench: dev.kept, packs: packs(rule.packs.dev) }, heldOut: { swebench: held.kept, packs: packs(rule.packs.heldOut) }, passedOver: [...dev.passedOver, ...held.passedOver] };
}

// The candidates to measure: the top of each set's ordered list, before any is passed over.
export function candidates(rows, rule, count) {
  const repos = repoSplit(eligibleRepos(rule), rule.seed);
  return { dev: orderedInstances(rows, repos.dev, rule).slice(0, count), heldOut: orderedInstances(rows, repos.heldOut, rule).slice(0, count) };
}
