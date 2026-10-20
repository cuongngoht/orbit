// What the LEDGER is for. A run-log lives in one evidence directory and only
// ever saw one run, so the questions people actually ask -- has this case ever
// passed, what did it fail on last time, is it flaky or is it simply broken --
// had no file that could answer them. One appended line per finished run does.
export const forCase = (runs, id) => runs.filter((r) => r.case === id);

export function summarize(runs) {
  const byCase = new Map();
  for (const r of runs) byCase.set(r.case, [...(byCase.get(r.case) ?? []), r]);
  return [...byCase].map(([id, rs]) => row(id, rs));
}

// A PARTIAL run is a slice of a case, not a verdict about it. Counting one as a
// pass is how a debugging session makes a broken case look green; counting the
// flips into and out of it makes every such session look like flakiness. It
// still shows as `last`, because hiding what just happened helps nobody.
export const whole = (r) => r.status !== "PARTIAL";

function row(id, rs) {
  const judged = rs.filter(whole);
  const last = rs[rs.length - 1];
  const flapped = flapping(judged);
  return { case: id, runs: judged.length, last: last.status, at: last.at ?? null, pass: judged.filter((r) => r.status === "PASS").length, flaky: flapped.length > 0, flapped, hosts: hostVerdicts(judged) };
}

// The argument everyone actually has -- "it passes on mine" -- is answerable
// only once the machines share one ledger: the latest verdict per host, so two
// machines disagreeing about the same case is a fact on screen, not a debate.
export function hostVerdicts(runs) {
  const latest = new Map();
  for (const r of runs) latest.set(hostOf(r), r.status);
  return [...latest].map(([host, last]) => ({ host, last }));
}

export const disagree = (hosts) => new Set(hosts.map((h) => h.last)).size > 1;

// WHICH machines flap -- not merely whether the ledger looks unsettled.
// Flipping is a property of ONE machine's history, and the merged ledger
// interleaves them: a green laptop and a red one, neither of which ever changed
// its mind, read as a verdict alternating every other run. So the case somebody
// BROKE on Tuesday and FIXED on Friday came out FLAKY, naming a laptop that had
// only ever been green -- the exact mistake the rule below is written to avoid.
// Grouped per machine first, counted after.
export const flapping = (runs) => [...byHost(runs)].filter(([, statuses]) => flips(statuses) > 1).map(([host]) => host);

function byHost(runs) {
  const per = new Map();
  for (const r of runs) per.set(hostOf(r), [...(per.get(hostOf(r)) ?? []), r.status]);
  return per;
}

const hostOf = (r) => r.host ?? "?";

// Two or more changes of verdict on one machine. A case that broke once and
// stayed broken -- or broke once and was fixed -- is not flaky, and filing it
// as flaky is how a real regression gets ignored.
const flips = (statuses) => statuses.filter((s, i) => i > 0 && s !== statuses[i - 1]).length;
