// The commands of AUTONOMOUS SELF-IMPROVEMENT, as a table: `run` answers with DATA and `say` puts it in words, and
// `writes` is what governance.mjs says it may change. What is NOT here is the point: promoting, reverting or rejecting
// a candidate and every setting are a person's, in Orbit Control (NOT_IMPROVE).
import { Refused } from "../errors.mjs";
import { flag, has, words } from "../learn/args.mjs";
import { linkMission } from "./evaluators.mjs";
import { advance, analyseNow, campaignOf, proposeCandidate, reconcile, step } from "./loop.mjs";
import { qualityOf, phasesOf } from "./metrics.mjs";
import { modelOf, phaseOf } from "./model.mjs";
import { start } from "./ops.mjs";
import { improvementOf } from "./policy.mjs";
import { campaignRow, campaignView, opportunityView } from "./views.mjs";
import { CODES, ID } from "./vocab.mjs";

const refused = (code, say) => Object.assign(new Refused(`${code}: ${say}`), { code });

function named(args, i, re, what) {
  const word = words(args)[i];
  if (!re.test(String(word ?? ""))) throw refused(CODES.INVALID, `name ${what}`);
  return word;
}

const campaignArg = (args) => named(args, 0, ID.campaign, "the campaign: an imp- id (improve status lists them)");

const models = (ports) => ports.store.list().map((id) => ({ id, m: modelOf(ports.store.read(id) ?? []) })).filter((x) => x.m.meta);

const views = (ports) => models(ports).map((x) => campaignView(x.id, x.m, ports.values()));

// A candidate's id, or its campaign's: what `evaluate` and `show` accept.
const byCandidate = (ports, id) => models(ports).find((x) => x.m.candidate?.candidate === id)?.id ?? null;

function resolved(ports, args) {
  const word = words(args)[0];
  const id = ID.candidate.test(String(word)) ? byCandidate(ports, word) : word;
  if (!ID.campaign.test(String(id ?? ""))) throw refused(CODES.INVALID, "name a campaign (imp-…) or a candidate (cand-…): improve status and improve candidates list them");
  return id;
}

// ---- reads ---------------------------------------------------------------------------------------------------------

const opportunitiesOf = (ports) => ports.store.opportunities().map(opportunityView).sort((a, b) => String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? "")));

function statusOf(ports) {
  const all = views(ports);
  const opps = opportunitiesOf(ports);
  return { room: ports.store.paths.room, switches: improvementOf(ports.values()), analysed: ports.store.analysed(), phases: phasesOf(models(ports).map((x) => x.m)), opportunities: { total: opps.length, eligible: opps.filter((o) => o.eligible).length, unreadable: opps.filter((o) => o.unreadable).length }, active: all.filter((v) => !v.ended).map(campaignRow), ended: all.filter((v) => v.ended).slice(-5).map(campaignRow) };
}

const candidatesOf = (ports) => views(ports).filter((v) => v.candidate).map((v) => ({ candidate: v.candidate.id, pin: v.candidate.pin, succeeds: v.pin, campaign: v.id, phase: v.phase, verdict: v.aggregate?.verdict ?? null, outcome: v.ended?.outcome ?? null, changed: v.candidate.changed }));

function shown(ports, args) {
  const word = words(args)[0];
  if (ID.opportunity.test(String(word))) return { opportunity: opportunityView(ports.store.opportunity(word)) };
  const id = resolved(ports, args);
  return { campaign: campaignView(id, campaignOf(ports, id).m, ports.values()) };
}

const historyOf = (ports, args) => ((subject) => ({ subject, campaigns: views(ports).filter((v) => v.subject.id === subject).map(campaignRow), opportunities: opportunitiesOf(ports).filter((o) => o.subject?.id === subject) }))(named(args, 0, /^([a-z0-9][a-z0-9-]{1,47}|(rol|atp|skl|wft)-[a-z0-9][a-z0-9-]{0,47})$/, "the playbook or Satellite definition: its id"));

const metricsOf = (ports) => ({ metrics: qualityOf({ campaigns: models(ports).map((x) => x.m), opportunities: ports.store.opportunities(), reuse: ports.reuse?.() ?? null }) });

const doctorOf = (ports) => ({ rows: ports.doctor(), damaged: ports.store.list().map((id) => ({ id, lines: ports.store.damaged(id) })).filter((x) => x.lines > 0), unreadable: ports.store.opportunities().filter((o) => o?.unreadable).map((o) => o.id), open: views(ports).filter((v) => v.open).map((v) => ({ campaign: v.id, evaluation: v.open, phase: v.phase })) });

// ---- writes, each through the loop's one door ------------------------------------------------------------------

async function startedFrom(ports, args) {
  const doc = ports.store.opportunity(named(args, 0, ID.opportunity, "the opportunity: an opp- id (improve opportunities lists them)"));
  if (!doc || doc.unreadable || !doc.eligible) throw refused(CODES.PHASE, doc ? doc.because ?? `${doc.id} cannot be read` : "no such opportunity in this project");
  const s = start(ports.ctx, doc);
  return { ...s, advanced: await advance(ports, s.campaign, { cheap: true }) };
}

async function evaluated(ports, args) {
  const id = resolved(ports, args);
  if (!["VALIDATED", "EVALUATING"].includes(phaseOf(campaignOf(ports, id).m))) throw refused(CODES.PHASE, `${id} is ${phaseOf(campaignOf(ports, id).m)} — evaluate takes a validated candidate`);
  return step(ports, id);
}

const proposed = (ports, args) => proposeCandidate(ports, campaignArg(args), ports.readJson(flag(args, "file") ?? refusedFlag("candidate <imp> --file=<content.json>")));

const linked = (ports, args) => linkMission(ports, campaignOf(ports, campaignArg(args)), { mission: named([flag(args, "mission")], 0, /^msn-[a-f0-9]{12}$/, "--mission=<msn-…>"), side: named([flag(args, "side")], 0, /^(baseline|candidate)$/, "--side=baseline|candidate") });

function refusedFlag(usage) {
  throw refused(CODES.INVALID, usage);
}

// ---- words -------------------------------------------------------------------------------------------------------

const rowLine = (r) => `  ${r.id}  ${String(r.phase).padEnd(18)} ${r.subject ?? "?"} ${r.pin ?? ""}${r.candidate ? ` → ${r.candidate}` : ""}${r.outcome ? ` · ${r.outcome}` : ""}`;

const sayStatus = (s) => [`IMPROVEMENT ${s.room}`, `SWITCHES    detect ${s.switches.detect} · generate ${s.switches.generate} · evaluate ${s.switches.evaluate} · promote ${s.switches.promote} · ${s.switches.minSessions} sessions · ${s.switches.minRuns} runs`, `ANALYSED    ${s.analysed?.at ?? "never"}`, `OPPORTUNITY ${s.opportunities.total} · ${s.opportunities.eligible} eligible${s.opportunities.unreadable ? ` · ${s.opportunities.unreadable} unreadable (kept as they are)` : ""}`, s.active.length ? "ACTIVE" : "ACTIVE      none", ...s.active.map(rowLine), ...(s.ended.length ? ["ENDED", ...s.ended.map(rowLine)] : [])].join("\n");

const oppLine = (o) => (o.unreadable ? `  ${o.id}  UNREADABLE (${o.unreadable}) — kept as it is` : `  ${o.id}  ${o.eligible ? "ELIGIBLE " : "recorded "} ${o.subject?.id ?? "?"} ${o.pin} ${o.signal} · ${o.runs} run(s) in ${o.sessions} session(s), ${o.against} against · ${o.cause}/${o.confidence}${o.campaign ? ` · ${o.campaign}` : ""}\n      ${o.because}`);

const sayAnswer = (a) => [`${a.campaign ?? ""} ${a.did}${a.phase ? ` → ${a.phase}` : ""}${a.outcome ? ` · ${a.outcome}` : ""}`.trim(), a.say ? `  ${a.say}` : null, a.needs ? `  NEEDS ${a.needs}${a.how ? `: ${a.how}` : ""}` : null].filter(Boolean).join("\n");

const sayAnalysed = (r) => (r.debounced ? "ANALYSED    recently — nothing done (the hook's debounce)" : [`ANALYSED    ${r.opportunities.length} evidence group(s) · ${r.eligible.length} eligible · ${r.started.filter((s) => s.created).length} campaign(s) started${r.dry ? " · DRY: nothing written" : ""}`, ...r.opportunities.map(oppLine), ...(r.advanced ?? []).map(sayAnswer)].join("\n"));

const sayShow = (r) => (r.opportunity ? oppLine(r.opportunity) : sayCampaign(r.campaign));

const evaluationLine = (e) => `  ${e.evaluation} ${e.verdict ?? (e.open ? "OPEN" : "?")} · ${e.recorded}${e.planned ? `/${e.planned}` : ""} run(s) · ${e.session ?? e.host ?? "?"}${e.metrics ? ` · baseline met ${e.metrics.baseline.met}/${e.metrics.baseline.runs}, candidate met ${e.metrics.candidate.met}/${e.metrics.candidate.runs}` : ""}${e.because ? `\n      ${e.because}` : ""}`;

const sayCampaign = (v) => [`CAMPAIGN    ${v.id} · ${v.phase} (revision ${v.revision}) · ${v.carrier} · mode ${v.mode}`, `SUBJECT     ${v.subject.kind} ${v.subject.id} @ ${v.pin}`, `SIGNAL      ${v.signal} on ${v.signature.join(", ") || "—"} · ${v.runs} run(s) in ${v.sessions} session(s)`, v.diagnosis ? `CAUSE       ${v.diagnosis.cause} (${v.diagnosis.confidence}) — ${v.diagnosis.hypothesis}` : null, v.candidate ? `CANDIDATE   ${v.candidate.id} ${v.candidate.pin}${v.candidate.changed.length ? ` · changed ${v.candidate.changed.join(", ")}` : ""}` : null, ...v.evaluations.map(evaluationLine), v.aggregate ? `VERDICT     ${v.aggregate.verdict} — ${v.aggregate.because}` : null, v.gates ? `GATES       ${v.gates.rows.map((g) => `${g.holds ? "✓" : "✗"}${g.id}`).join(" ")}` : null, v.promotion ? `PROMOTED    ${v.promotion.from} → ${v.promotion.to} by ${v.promotion.by}` : null, v.rollback ? `ROLLBACK    ${v.rollback.state} ${v.rollback.from} → ${v.rollback.to}` : null, v.blocked ? `BLOCKED     ${v.blocked.stop} — ${v.blocked.because}` : null, v.ended ? `ENDED       ${v.ended.outcome} — ${v.ended.because}` : null, v.learned ? `LEARNED     ${v.learned.kept ? "kept" : "not kept"} — ${v.learned.because}` : null].filter(Boolean).join("\n");

const sayMetrics = (r) => r.metrics.map((m) => `  ${m.id.padEnd(24)} ${m.value === null ? "unknown" : m.unit === "ratio" ? `${m.numerator}/${m.denominator}` : String(m.value)}${m.because ? ` — ${m.because}` : ""}`).join("\n");

const sayDoctor = (r) => [...r.rows.map((x) => `${x.ok ? "ok  " : "!!  "} ${x.name.padEnd(22)} ${x.say}`), ...r.damaged.map((d) => `!!   ${d.id} has ${d.lines} unreadable journal line(s) — dropped on read, never rewritten`), ...r.unreadable.map((id) => `!!   ${id} cannot be read — kept as it is`), ...r.open.map((o) => `..   ${o.campaign} ${o.evaluation} is open`)].join("\n");

const sayList = (key, line) => (r) => (r[key].length ? r[key].map(line).join("\n") : `no ${key} in this project`);

export const COMMANDS = {
  status: { run: (ports) => statusOf(ports), say: sayStatus, writes: "nothing" },
  opportunities: { run: (ports) => ({ opportunities: opportunitiesOf(ports) }), say: sayList("opportunities", oppLine), writes: "nothing" },
  candidates: { run: (ports) => ({ candidates: candidatesOf(ports) }), say: sayList("candidates", (c) => `  ${c.candidate} ${c.pin} succeeds ${c.succeeds} · ${c.campaign} ${c.phase}${c.verdict ? ` · ${c.verdict}` : ""}${c.outcome ? ` · ${c.outcome}` : ""}`), writes: "nothing" },
  show: { run: shown, say: sayShow, writes: "nothing" },
  history: { run: historyOf, say: (r) => [`HISTORY     ${r.subject}`, ...r.campaigns.map(rowLine), ...r.opportunities.map(oppLine)].join("\n"), writes: "nothing" },
  metrics: { run: metricsOf, say: sayMetrics, writes: "nothing" },
  doctor: { run: doctorOf, say: sayDoctor, writes: "nothing" },
  where: { run: (ports) => ({ room: ports.store.paths.room }), say: (r) => `ROOM        ${r.room}`, writes: "nothing" },
  analyse: { run: (ports, args) => analyseNow(ports, { dry: has(args, "dry"), hook: has(args, "hook") }), say: sayAnalysed, writes: "store" },
  start: { run: startedFrom, say: (r) => [`STARTED     ${r.campaign}${r.created ? "" : " (already open for this subject)"}`, ...r.advanced.map(sayAnswer)].join("\n"), writes: "store" },
  step: { run: (ports, args) => step(ports, campaignArg(args)), say: sayAnswer, writes: "store" },
  resume: { run: async (ports, args) => ({ steps: await advance(ports, campaignArg(args)) }), say: (r) => r.steps.map(sayAnswer).join("\n"), writes: "store" },
  evaluate: { run: evaluated, say: sayAnswer, writes: "store" },
  candidate: { run: proposed, say: sayAnswer, writes: "store" },
  link: { run: linked, say: sayAnswer, writes: "store" },
  reconcile: { run: (ports, args) => reconcile(ports, campaignArg(args)), say: sayAnswer, writes: "store" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
