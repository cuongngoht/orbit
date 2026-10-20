// `engineering doctor` (1.8.9): is the observer on HERE, has it run, and what stopped it. The first reader of the
// findings the hooks and the observer leave when something is refused or throws -- a failure that never reaches a
// turn is still a failure somebody can find. It reads only, and every machine fact it shows (the switches in effect,
// a protocol-2 session's checkpoint queue) is computed by cli/engineering.mjs and handed in, so nothing here reads an
// environment.
import { out } from "../../query/format.mjs";

export const FINDING_KINDS = ["subscriber-failed", "observer-candidate-refused"];
export const MAX_FINDINGS = 20;

// -> { switches, observations: [{ host, count, last }], queue, findings }
export function doctorView(ctx) {
  const lines = ctx.eng.observations();
  const hosts = [...new Set(lines.map((l) => l.seenBy?.host ?? "unknown"))].sort();
  const findings = ctx.eng.findings().filter((f) => FINDING_KINDS.includes(f.kind)).slice(-MAX_FINDINGS);
  return { switches: ctx.switches(), observations: hosts.map((host) => observedBy(lines, host)), queue: ctx.queue(), findings };
}

const observedBy = (lines, host) => ((mine) => ({ host, count: mine.length, last: mine.map((l) => l.at).sort().at(-1) ?? null }))(lines.filter((l) => (l.seenBy?.host ?? "unknown") === host));

export function doctor(ctx, args = []) {
  const view = doctorView(ctx);
  if (args.includes("--json")) return out(JSON.stringify(view, null, 2));
  out("ENGINEERING DOCTOR  is the observer on here, has it run, and what stopped it");
  for (const [title, rows] of sections(view)) printed(title, rows);
}

const sections = (view) => [
  ["switches", view.switches.map((s) => `${s.name.padEnd(20)} ${s.on ? "on " : "off"}  (${s.source})`)],
  ["observations", view.observations.map((o) => `${o.host.padEnd(24)} ${o.count} observation(s) · the last at ${o.last}`)],
  ["checkpoint queue", [view.queue ? `${view.queue.pending} pending · ${view.queue.leased} leased — drained by its own hook, and by this session's next Orbit command` : "none in this session: a protocol-1 host's hooks observe inline"]],
  [`findings (the last ${MAX_FINDINGS})`, view.findings.map((f) => `${f.at}  ${f.kind}  ${f.subscriber ?? f.candidateKey ?? ""}  ${f.say ?? ""}`)],
];

function printed(title, rows) {
  out(`\n${title}`);
  for (const row of rows.length ? rows : ["(none yet)"]) out(`  ${row}`);
}
