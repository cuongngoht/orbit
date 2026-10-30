// Which evidence groups are OPPORTUNITIES, and whether one may start a campaign: an ordered table, the first row that
// fails says why not and what is still missing. Pure -- the groups (signals.mjs), the opportunities kept, a summary of
// every campaign, the settings and the clock come in; the documents to keep and the ones to forget come out. A dry run
// is the same answer, written nowhere.
//
//   analyse({ groups, kept, campaigns, values, now }) -> { opportunities, changed, eligible, expired, unreadable }
//     campaign summary: { id, subjectKind, subjectId, fingerprint, terminal, endedAt, generated }
import { diagnosisOf } from "./diagnose.mjs";
import { fingerprintOf, opportunityIdOf } from "./fingerprint.mjs";
import { cooldownMs, improvementOf, retentionMs } from "./policy.mjs";
import { categoryOf } from "./vocab.mjs";

const sameSubject = (c, x) => x.subjectKind === c.group.subject.kind && x.subjectId === c.group.subject.id;

const openFor = (c) => c.campaigns.find((x) => sameSubject(c, x) && !x.terminal) ?? null;

const coolingFor = (c) => c.campaigns.filter((x) => sameSubject(c, x) && x.terminal && x.endedAt).find((x) => Date.parse(c.now) - Date.parse(x.endedAt) < cooldownMs(c.values)) ?? null;

const generatedFor = (c) => c.campaigns.filter((x) => sameSubject(c, x) && Date.parse(c.now) - Date.parse(x.startedAt ?? c.now) < retentionMs(c.values)).reduce((n, x) => n + (x.generated ?? 0), 0);

const min = (c) => improvementOf(c.values);

// The order is the argument: a person's switch first, then a campaign already on it, then what no new version could
// answer, then whether there is enough INDEPENDENT evidence -- one failure, or retries in one session, never is.
export const ELIGIBILITY = [
  { id: "DETECTION_OFF", fails: (c) => min(c).detect === false, missing: () => [], say: () => "a person turned detection off (improvement.detect) — recorded, and nothing starts" },
  { id: "CAMPAIGN_OPEN", fails: (c) => Boolean(openFor(c)), missing: () => [], say: (c) => `${openFor(c).id} is already improving ${c.group.subject.id}` },
  { id: "NOT_A_DEFINITION_DEFECT", fails: (c) => !categoryOf(c.group.category)?.candidate, missing: () => [], say: (c) => `${categoryOf(c.group.category)?.say ?? "nothing a definition decides"} — recorded, and nothing is generated to work around it` },
  { id: "TOO_FEW_RUNS", fails: (c) => c.group.runs < min(c).minRuns, missing: (c) => [`${min(c).minRuns - c.group.runs} more run(s) showing it`], say: (c) => `${c.group.runs} run(s) show it and ${min(c).minRuns} are needed — one failure is not a recurring problem` },
  { id: "TOO_FEW_SESSIONS", fails: (c) => c.group.sessions < min(c).minSessions, missing: (c) => [`${min(c).minSessions - c.group.sessions} more independent session(s)`], say: (c) => `${c.group.sessions} independent session(s) and ${min(c).minSessions} are needed — runs repeated in one session are one observation` },
  { id: "CONTRADICTED", fails: (c) => c.group.against >= c.group.sessions, missing: () => ["sessions where it fails outnumbering those where it holds"], say: (c) => `${c.group.pin} also held in ${c.group.against} independent session(s) — as many as showed the problem` },
  { id: "COOLING_DOWN", fails: (c) => Boolean(coolingFor(c)), missing: () => [], say: (c) => `${coolingFor(c).id} ended less than ${min(c).cooldownHours}h ago — ${c.group.subject.id} is not improved again so soon` },
  { id: "SUBJECT_CAP", fails: (c) => generatedFor(c) >= min(c).maxCandidatesPerSubject, missing: () => [], say: (c) => `${c.group.subject.id} already had ${generatedFor(c)} candidate(s) generated within the retention window (maxCandidatesPerSubject)` },
];

export const ELIGIBILITY_IDS = ELIGIBILITY.map((r) => r.id);

const eligibilityOf = (c) => ((row) => (row ? { eligible: false, check: row.id, because: row.say(c), missing: row.missing(c) } : { eligible: true, check: "ELIGIBLE", because: `${c.group.runs} run(s) across ${c.group.sessions} independent session(s) show it, and nothing holds it back`, missing: [] }))(ELIGIBILITY.find((r) => r.fails(c)));

// What is KNOWN to differ between the runs, and what the evidence cannot say -- stated, never filled in.
const differencesOf = (g) => [...(g.hosts > 1 ? [`the runs came from ${g.hosts} machines`] : []), ...((g.providers?.length ?? 0) > 1 ? [`the failing steps were answered by ${g.providers.length} different providers`] : [])];

const limitationsOf = (g) => [`attribution: ${g.attribution.bound} of ${g.attribution.of} run(s) bound to their run by the engine (${g.attribution.words.join(", ") || "none"})`, "a session is one machine on one UTC day, as learn counts it -- a session mark a shell can set is never counted", "a provider's answer is never kept: only what its owner's receipts say"];

const documentOf = (c, kept) => ((g, d, e) => ({ id: opportunityIdOf(fingerprintOf(g)), fingerprint: fingerprintOf(g), subject: g.subject, pin: g.pin, signal: g.signal, category: g.category, signature: g.signature, runs: g.runs, sessions: g.sessions, against: g.against, hosts: g.hosts, evidence: g.evidence, tasks: g.tasks ?? [], attribution: g.attribution, environment: differencesOf(g), limitations: limitationsOf(g), cause: d.cause, confidence: d.confidence, improvement: d.candidate ? `a successor version of ${g.subject.id}` : null, eligible: e.eligible, check: e.check, because: e.because, missing: e.missing, campaign: openFor(c)?.id ?? kept?.campaign ?? null, firstSeen: kept?.firstSeen ?? g.first, lastSeen: g.last, detectedAt: kept?.detectedAt ?? c.now }))(c.group, diagnosisOf(c.group, c.values), eligibilityOf(c));

// What makes a kept document worth writing again: its evidence or its eligibility moved -- never the clock alone.
const MOVED = ["runs", "sessions", "against", "eligible", "check", "campaign", "cause", "lastSeen"];

const moved = (kept, doc) => !kept || MOVED.some((k) => JSON.stringify(kept[k]) !== JSON.stringify(doc[k]));

const keptBy = (kept) => new Map((kept ?? []).filter((d) => d && !d.unreadable).map((d) => [d.id, d]));

// An opportunity nobody acted on and nothing has shown for longer than the retention window is forgotten: it is
// derived from the owners' records, so forgetting it loses nothing they keep.
const expiredOf = (x, current) => (x.kept ?? []).filter((d) => d && !d.unreadable && !d.campaign && !current.has(d.id) && Date.parse(x.now) - Date.parse(d.lastSeen ?? x.now) > retentionMs(x.values)).map((d) => d.id);

export function analyse(x) {
  const kept = keptBy(x.kept);
  const docs = (x.groups ?? []).map((group) => ((c) => documentOf(c, kept.get(opportunityIdOf(fingerprintOf(group)))))({ group, campaigns: x.campaigns ?? [], values: x.values, now: x.now }));
  const current = new Set(docs.map((d) => d.id));
  return { opportunities: docs, changed: docs.filter((d) => moved(kept.get(d.id), d)), eligible: docs.filter((d) => d.eligible), expired: expiredOf(x, current), unreadable: (x.kept ?? []).filter((d) => d?.unreadable).map((d) => d.id) };
}
