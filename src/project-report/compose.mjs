// WHICH parts one report run executes, and in what order -- decided before
// anything runs, as ordered tables, pure over data the caller assembled. Every
// part left out is left out with ONE sentence saying why, and that sentence is
// what the report and Orbit Control print: a composition nobody can explain is
// one nobody can trust.
//
//   1 admit        the right contract, a runtime that satisfies it, an ACTIVE
//                  extension whose files are the ones that were registered,
//                  switched on for this project, and not contested
//   2 replacement  only when declared, of the same kind, providing everything
//                  the part it replaces provided, and approved by a PERSON; two
//                  replacements of one part cancel each other and the standard
//                  part runs
//   3 dependencies a need nothing provides leaves its part out, and so does a
//                  cycle -- every part on it, with the cycle printed
//   4 order        collector -> transform -> metric -> section -> exporter; in a
//                  phase, what is needed first, ties broken by id
//
// Additive by default: an extension part runs BESIDE the standard ones, and a
// title it shares with a standard section is noted, never read as a
// replacement. The identity rule (orbit.* is the kit's, one owner per id) is
// enforced where parts register (src/extensions/reporting-parts.mjs); a
// contested id arrives here as a fact, and neither owner runs.
import { satisfies } from "../extensions/engine-range.mjs";
import { REPORT_PART_API, kindOf } from "../extensions/reporting-v1.mjs";

// facts: { provider, base: [token], runtimes: { id: {version}|null },
//          extensions: { id: {status, fingerprint} }, contested: [{id, owners}],
//          settings: { parts: { id: {enabled, replace} } }, phases: [kind],
//          sections: the standard section table, for the shared-title note }
export function compose(candidates, facts) {
  const admitted = admit(candidates, facts);
  const replaced = replacement(admitted.kept, facts);
  const linked = dependencies(replaced.kept, facts);
  return { run: ordered(linked.kept, facts), skipped: [...admitted.skipped, ...replaced.skipped, ...linked.skipped], notes: titleNotes(linked.kept, facts.sections ?? []) };
}

// ---- 1 admit ----------------------------------------------------------------

// The first row a part fails is the reason it is left out. `quiet` rows are
// not news: a collector for another provider is not a part this project has.
const ADMIT = [
  { quiet: true, fails: (p, f) => !f.phases.includes(p.kind), says: () => "not a part of this phase" },
  { quiet: true, fails: (p, f) => Boolean(p.provider) && p.provider !== f.provider, says: (p) => `reads ${p.provider}, which is not this project's source` },
  { fails: (p) => p.contract !== REPORT_PART_API, says: (p) => `written against ${p.contract}; this engine runs ${REPORT_PART_API}` },
  { fails: (p) => !kindOf(p.kind)?.runs, says: () => "a workflow is a playbook a host follows; it is listed, never run" },
  { fails: (p, f) => (f.contested ?? []).some((c) => c.id === p.id), says: (p, f) => `${p.id} is declared by ${ownersOf(p, f)}, so neither runs` },
  { fails: (p, f) => p.source === "store" && f.extensions[p.from]?.status !== "active", says: (p, f) => `extension ${p.from} is ${f.extensions[p.from]?.status ?? "not loaded"}; only an active extension's parts run in a report` },
  { fails: (p, f) => p.source === "store" && f.extensions[p.from]?.fingerprint !== "ok", says: (p, f) => fingerprintWhy(p, f.extensions[p.from]) },
  { fails: (p, f) => f.settings.parts?.[p.id]?.enabled === false, says: () => "switched off in this project's report settings" },
  { fails: (p, f) => p.runtime && p.runtime !== "node" && !f.runtimes[p.runtime], says: (p) => `needs ${p.runtime}${p.requires ? ` ${p.requires}` : ""}, and none is available on this machine` },
  { fails: (p, f) => runtimeTooOld(p, f), says: (p, f) => `needs ${p.runtime} ${p.requires}; this machine resolved ${f.runtimes[p.runtime].version}` },
];

const ownersOf = (p, f) => f.contested.find((c) => c.id === p.id).owners.join(" and ");

const FINGERPRINT = {
  changed: (p) => `the files of extension ${p.from} changed after it was registered, so they are not the ones that were verified; register a new version, or have a person re-register it`,
  absent: (p) => `extension ${p.from} carries no registration record, so nothing says which files were verified; register it again`,
};

const fingerprintWhy = (p, ext) => (FINGERPRINT[ext?.fingerprint] ?? FINGERPRINT.absent)(p);

function runtimeTooOld(p, f) {
  const version = f.runtimes[p.runtime]?.version;
  return Boolean(p.requires && version) && satisfies(version, p.requires).ok === false;
}

function admit(candidates, facts) {
  const judged = candidates.map((p) => ({ p, row: ADMIT.find((r) => r.fails(p, facts)) }));
  return { kept: judged.filter((j) => !j.row).map((j) => j.p), skipped: judged.filter((j) => j.row && !j.row.quiet).map((j) => skip(j.p, "admit", j.row.says(j.p, facts))) };
}

const skip = (p, rule, why) => ({ id: p.id, version: p.version, kind: p.kind, source: p.source, from: p.from, rule, why });

// ---- 2 replacement --------------------------------------------------------------

// Asked of every part that declares `replaces`, in order; the first that fails
// says why it does not replace anything -- and it does not run beside the part
// it meant to replace either, because both would write the same outputs.
const REPLACE = [
  { fails: (r, t) => !t, says: (r) => `replaces ${r.replaces}, which is not a part of this report` },
  { fails: (r, t) => t.kind !== r.kind, says: (r, t) => `replaces a ${t.kind} with a ${r.kind}; a replacement is the same kind of part` },
  { fails: (r, t) => missingOf(r, t).length > 0, says: (r, t) => `does not provide all of what ${t.id} does (${missingOf(r, t).join(", ")}), so the parts that need it would lose it` },
  { fails: (r, t, f) => f.settings.parts?.[r.id]?.replace !== true, says: (r) => `replaces ${r.replaces}; only a person activates a replacement (Orbit Control -> PO Reports -> Extensions)` },
  { fails: (r, t, f, rivals) => rivals.length > 1, says: (r, t, f, rivals) => `${rivals.map((x) => x.id).join(" and ")} all replace ${r.replaces}, so none does and the standard part runs` },
];

const missingOf = (r, t) => (t.provides ?? []).filter((x) => !(r.provides ?? []).includes(x));

function replacement(parts, facts) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const judged = parts.filter((p) => p.replaces).map((r) => ({ r, row: REPLACE.find((x) => x.fails(r, byId.get(r.replaces), facts, approvedRivals(parts, r, facts))) }));
  const winners = judged.filter((j) => !j.row).map((j) => j.r);
  const out = new Set([...judged.filter((j) => j.row).map((j) => j.r.id), ...winners.map((w) => w.replaces)]);
  return { kept: parts.filter((p) => !out.has(p.id)), skipped: [...judged.filter((j) => j.row).map((j) => skip(j.r, "replacement", j.row.says(j.r, byId.get(j.r.replaces), facts, approvedRivals(parts, j.r, facts)))), ...winners.map((w) => skip(byId.get(w.replaces), "replacement", `replaced by ${w.id} ${w.version}, as a person approved`))] };
}

const approvedRivals = (parts, r, facts) => parts.filter((p) => p.replaces === r.replaces && facts.settings.parts?.[p.id]?.replace === true);

// ---- 3 dependencies -----------------------------------------------------------

// Parts whose needs nothing provides leave, and their leaving can strand the
// parts that needed THEM -- so this repeats until nothing more leaves. Then any
// part still standing on a cycle leaves, every member of it.
function dependencies(parts, facts) {
  const stranded = strand(parts, new Set(facts.base ?? []), []);
  const cycles = cyclesOf(stranded.kept, new Set(facts.base ?? []));
  const inCycle = new Set(cycles.flat());
  return { kept: stranded.kept.filter((p) => !inCycle.has(p.id)), skipped: [...stranded.skipped, ...stranded.kept.filter((p) => inCycle.has(p.id)).map((p) => skip(p, "dependencies", `is part of a cycle: ${cycleThrough(p.id, cycles)}`))] };
}

function strand(parts, base, skipped) {
  const unmet = parts.map((p) => ({ p, lacks: (p.needs ?? []).filter((n) => !base.has(n) && !providersOf(parts, p, n).length) })).filter((u) => u.lacks.length);
  if (!unmet.length) return { kept: parts, skipped };
  const gone = new Set(unmet.map((u) => u.p.id));
  return strand(parts.filter((p) => !gone.has(p.id)), base, [...skipped, ...unmet.map((u) => skip(u.p, "dependencies", `needs ${u.lacks.join(", ")}, which neither this snapshot nor a part that runs before it provides`))]);
}

// The parts that could give `p` what it `need`s: any other part that provides
// it, in p's own phase or an earlier one -- a metric cannot wait for a section.
const providersOf = (parts, p, need) => parts.filter((q) => q.id !== p.id && (q.provides ?? []).includes(need) && kindOf(q.kind).phase <= kindOf(p.kind).phase).map((q) => q.id);

// part id -> the ids it needs something from (base needs are not edges).
function edgesOf(parts, base) {
  const needed = (p) => (p.needs ?? []).filter((n) => !base.has(n)).flatMap((n) => providersOf(parts, p, n));
  return new Map(parts.map((p) => [p.id, [...new Set(needed(p))].sort()]));
}

// Every cycle as the list of its members, found by walking from each part in id
// order -- so the same parts always report the same cycle.
function cyclesOf(parts, base) {
  const edges = edgesOf(parts, base);
  const found = [...edges.keys()].sort().map((id) => loopFrom(id, edges)).filter(Boolean);
  return dedupe(found);
}

function loopFrom(start, edges, path = [start], seen = new Set([start])) {
  const nexts = edges.get(path.at(-1)) ?? [];
  if (nexts.includes(start)) return path;
  for (const next of nexts.filter((n) => !seen.has(n))) {
    const found = loopFrom(start, edges, [...path, next], seen.add(next));
    if (found) return found;
  }
  return null;
}

function dedupe(cycles) {
  const keys = new Set();
  return cycles.filter((c) => !keys.has([...c].sort().join(" ")) && keys.add([...c].sort().join(" ")));
}

function cycleThrough(id, cycles) {
  const cycle = cycles.find((c) => c.includes(id));
  return [...cycle, cycle[0]].join(" -> ");
}

// ---- 4 order -----------------------------------------------------------------

// Phase first; within a phase, a part after every part it needs (Kahn's
// algorithm, the ready set always taken in id order).
function ordered(parts, facts) {
  const edges = edgesOf(parts, new Set(facts.base ?? []));
  const byPhase = [...parts].sort((a, b) => kindOf(a.kind).phase - kindOf(b.kind).phase || a.id.localeCompare(b.id));
  return settle(byPhase, edges, []);
}

function settle(waiting, edges, done) {
  if (!waiting.length) return done;
  const placed = new Set(done.map((p) => p.id));
  const phase = kindOf(waiting[0].kind).phase;
  const next = waiting.find((p) => kindOf(p.kind).phase === phase && edges.get(p.id).every((d) => placed.has(d) || !waiting.some((w) => w.id === d))) ?? waiting[0];
  return settle(waiting.filter((p) => p !== next), edges, [...done, next]);
}

// ---- notes -------------------------------------------------------------------

// A store section titled like a standard one runs beside it, and the report
// says so -- a shared title is never a replacement.
export function titleNotes(parts, sections) {
  const standard = new Set(sections.map((s) => s.title.toLowerCase()));
  return parts.filter((p) => p.source === "store" && standard.has(String(p.section?.title ?? "").toLowerCase())).map((p) => `${p.section.id} (${p.section.title}) is an extension section shown beside the standard one of that name, not instead of it`);
}
