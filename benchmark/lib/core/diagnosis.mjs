// A RUN'S DIAGNOSIS, read off its own records, so that a person looking at a failed model-carried row reads one bundle
// and not the room (0.5.0, backlog B6): how the host's session ended, round by round (its finish reason); the budget it
// used against what it was allowed; and, for a QA run, what the relay refused, what the engine stopped, and where a run
// a step dispatched stopped short (`result.stopped`, as the relay kept it). Every number is what the host or the
// controller REPORTED, and what nobody said is null. It decides nothing: the verdict stays the run's.
//
//   diagnosisOf(d) -> { finish: [line], budget, relay, stopped }      relayLines(file) -> [line] | null      FINISH
//   diagnosisLines(diagnosis) -> [markdown line]
//   d: { manifest, ending, rounds: [{ round, host, timedOut, interrupted, error }], relay: [relay line] | null }
import { readRegular } from "./room.mjs";

// How many of each kind of relay line a bundle shows: the latest, which is where a round ended up.
export const SHOWN = 5;

// Why a host's round ended, in its own words where it said them -- first match wins, the last always matching.
export const FINISH = [
  { id: "INTERRUPTED", when: (r) => r.interrupted === true, says: () => "interrupted: a restart cut the round short, and what it left was read back" },
  { id: "DEADLINE", when: (r) => r.timedOut === true, says: () => "stopped at the round's deadline" },
  { id: "NO_SESSION", when: (r) => r.host?.started === false, says: () => "the host never started a session" },
  { id: "SAID", when: (r) => typeof r.host?.subtype === "string", says: (r) => `${r.host.subtype}${r.host.isError ? " (an error)" : ""}` },
  { id: "UNSAID", when: () => true, says: () => "unknown: the host's stream says no ending" },
];

const finishOf = (r) => ({ round: r.round ?? null, reason: FINISH.find((x) => x.when(r)).says(r), turns: r.host?.turns ?? null, toolCalls: r.host?.toolCalls ?? null, error: r.host?.errorText ?? r.error ?? null });

const sum = (xs) => (xs.some((x) => typeof x === "number") ? Math.round(xs.filter((x) => typeof x === "number").reduce((n, x) => n + x, 0) * 10000) / 10000 : null);

// How long the run took, from its freeze to its ending, as its own records say them.
const minutesOf = (m, e) => (m?.at && e?.at ? Math.round((Date.parse(e.at) - Date.parse(m.at)) / 60000) : null);

const budgetOf = (d) => ({ usd: { used: sum(d.rounds.map((r) => r.host?.costUsd)), cap: d.manifest?.config?.usd ?? null }, minutes: { used: minutesOf(d.manifest, d.ending), cap: d.manifest?.config?.minutes ?? null }, rounds: { used: d.rounds.length, cap: d.manifest?.config?.rounds ?? null } });

const latest = (xs) => xs.slice(-SHOWN);

// What the relay refused (its own word), what the engine stopped (an exit that was not 0, with the engine's first line),
// and the requests it could not even read -- each counted, the latest shown.
const relayOf = (lines) => ((refused, stopped) => ({ requests: lines.length, refused: refused.length, stopped: stopped.length, refusals: latest(refused.map((l) => ({ sub: l.sub ?? null, why: l.refused }))), stops: latest(stopped.map((l) => ({ sub: l.sub ?? null, exit: l.exit ?? null, why: l.why ?? l.error ?? null }))) }))(lines.filter((l) => l.refused), lines.filter((l) => !l.refused && l.exit !== 0));

export const diagnosisOf = (d) => ({ finish: d.rounds.map(finishOf), budget: budgetOf(d), relay: d.relay ? relayOf(d.relay) : null, stopped: d.relay ? latest(d.relay.filter((l) => l.stopped).map((l) => l.stopped)) : null });

const parsedLine = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

// A round's relay log (rounds/<k>/relay/relay.jsonl), read as a regular file of bounded size, a line that does not
// parse left out -- or null, for a run that kept none.
export const relayLines = (file) => ((buf) => (buf ? buf.toString("utf8").split("\n").map(parsedLine).filter((l) => l && typeof l === "object") : null))(readRegular(file, 16 * 1024 * 1024));

// ---- in words, for a run's report.md --------------------------------------------------------------------------------------

const val = (v) => (v === null || v === undefined || v === "" ? "unknown" : v);

const finishLine = (f) => `- round ${val(f.round)}: ${f.reason}${f.turns === null ? "" : `, ${f.turns} turns`}${f.toolCalls === null ? "" : `, ${f.toolCalls} tool calls`}${f.error ? ` — ${f.error}` : ""}`;

const budgetLine = (b) => `- budget used: ${val(b.usd.used)} of ${val(b.usd.cap)} USD (reported), ${val(b.minutes.used)} of ${val(b.minutes.cap)} minutes, ${b.rounds.used} of ${val(b.rounds.cap)} round(s)`;

const relayLinesSaid = (r) => (r ? [`- relay: ${r.requests} request(s), ${r.refused} refused by the relay, ${r.stopped} stopped by the engine`, ...r.refusals.map((x) => `  - refused \`${val(x.sub)}\`: ${x.why}`), ...r.stops.map((x) => `  - stopped \`${val(x.sub)}\` (exit ${val(x.exit)}): ${val(x.why)}`)] : []);

const stoppedLine = (x) => `- a run stopped short at step ${val(x.step)} (${val(x.do)} ${val(x.capability)}, ${val(x.as)}; ${val(x.outcome)} ${val(x.rule)}): ${val(x.says)}`;

export const diagnosisLines = (d) => [...d.finish.map(finishLine), budgetLine(d.budget), ...relayLinesSaid(d.relay), ...(d.stopped ?? []).map(stoppedLine)];
