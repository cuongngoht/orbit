// What a PROMOTED version's later runs show -- ordinary work's runs, read off their owners' records exactly as
// detection reads them, never the evaluation's own -- against the evidence it was chosen on. Ordered rows, the first
// that holds decides. A regression needs what an opportunity needs: the definition's own failure in independent
// sessions. An environment that stopped the runs is a confounder, and a few runs are never a verdict either way.
//
//   observationOf({ records, values }) -> { word, because, runs, sessions, clean, failing, failingSessions, blocked, evidence }
import { improvementOf } from "./policy.mjs";
import { independent, signalOf } from "./signals.mjs";
import { categoryOf, signalRow } from "./vocab.mjs";

const defective = (r) => categoryOf(signalRow(signalOf(r).signal)?.category)?.candidate === true;

const healthy = (r) => signalRow(signalOf(r).signal)?.healthy === true;

const blocked = (r) => signalOf(r).signal === "environment-blocked";

const refOf = (r) => (r.kind === "satellite" ? `agentrun:${r.mission}/${r.run}` : `skillrun:${r.task}/${r.run}`);

const factsOf = (x) => ((runs) => ({ runs, min: improvementOf(x.values).minSessions, minRuns: improvementOf(x.values).minRuns, failing: runs.filter(defective), clean: runs.filter(healthy), blocked: runs.filter(blocked) }))((x.records ?? []).filter((r) => signalOf(r).signal));

export const MONITOR = [
  { word: "REGRESSED", when: (f) => independent(f.failing) >= f.min, because: (f) => `the definition's own failure came back in ${independent(f.failing)} independent session(s) (${f.failing.length} run(s)) since it was chosen` },
  { word: "INSUFFICIENT", when: (f) => f.runs.length < f.minRuns || independent(f.runs) < f.min, because: (f) => `${f.runs.length} run(s) in ${independent(f.runs)} independent session(s) since it was chosen — ${f.minRuns} runs in ${f.min} sessions are needed to say anything` },
  { word: "CONFOUNDED", when: (f) => f.blocked.length * 2 > f.runs.length, because: (f) => `${f.blocked.length} of ${f.runs.length} run(s) were stopped by the environment — a confounder, never a regression; still watching` },
  { word: "STABLE", when: (f) => independent(f.clean) >= f.min, because: (f) => `${f.clean.length} run(s) held in ${independent(f.clean)} independent session(s) since it was chosen, and its failure did not come back in enough sessions to be one` },
  { word: "INSUFFICIENT", when: () => true, because: (f) => `${independent(f.clean)} independent session(s) held — ${f.min} are needed` },
];

export const observationOf = (x) => ((f) => ((row) => ({ word: row.word, because: row.because(f), runs: f.runs.length, sessions: independent(f.runs), clean: f.clean.length, failing: f.failing.length, failingSessions: independent(f.failing), blocked: f.blocked.length, evidence: f.failing.map(refOf).slice(-12) }))(MONITOR.find((r) => r.when(f))))(factsOf(x));
