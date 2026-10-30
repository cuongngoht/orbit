// The SESSION TRAIL, printed: the decision trace (`turns`, `turn <id>`) and the
// usage analytics (`usage`). Read-only views over the projections -- they
// re-judge nothing and write nothing.
import { Refused } from "../errors.mjs";
import { flag, words } from "../learn/args.mjs";
import { out } from "../query/format.mjs";
import { turnOf, turnsOf } from "./projections/turns.mjs";
import { usageOf } from "./projections/usage.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const daysOf = (args, fallback) => {
  const n = Number(flag(args, "days") ?? fallback);
  if (!Number.isFinite(n) || n <= 0 || n > 90) throw new Refused("--days must be a number of days between 1 and 90 — the trail keeps 90");
  return n;
};

const windowOf = (ctx, args, fallback) => ({ sinceMs: Date.parse(ctx.now()) - daysOf(args, fallback) * DAY_MS });

const clock = (at) => String(at ?? "").slice(11, 19);

const spent = (ms) => (ms === null || ms === undefined ? "open" : ms < 1000 ? `${ms}ms` : `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`);

// How a step ended, as the trail knows it: ok, failed, or not reported -- a host that sends no exit status (AGY,
// Codex's shell) leaves a command's result unknown, and printing that as a failure invented one.
const ENDED = { true: { short: "", long: "" }, false: { short: " ✖", long: "  ✖ failed" }, null: { short: " ?", long: "  ? not reported" } };

export const ended = (s) => ENDED[s.ok === true ? "true" : s.ok === false ? "false" : "null"];

const pathText = (t) => t.path.slice(0, 10).map((s) => `${s.label}${s.times > 1 ? ` ×${s.times}` : ""}${ended(s).short}`).join(" → ") + (t.path.length > 10 ? ` → … ${t.path.length - 10} more` : "");

export function turnsView(ctx, args) {
  const events = ctx.log.read(windowOf(ctx, args, 1));
  const turns = turnsOf(events, { limit: Number(flag(args, "limit") ?? 20) }).filter((t) => !flag(args, "session") || t.session === flag(args, "session"));
  if (args.includes("--json")) return out(JSON.stringify({ version: 1, turns }, null, 2));
  out(`TRACE  last ${daysOf(args, 1)} day(s) · ${turns.length} turn(s) shown · ${new Set(events.map((e) => e.session)).size} session(s)\n`);
  for (const t of turns) out(`  ${clock(t.at)}  ${t.routing?.intent ?? "no routing"}${t.routing?.confidence ? ` (${t.routing.confidence})` : ""} · ${t.followed.verdict.toUpperCase()} · ${t.steps.length} step(s) · ${t.outcome} · ${spent(t.ms)}   ${t.id}\n            ${pathText(t) || "(no steps)"}`);
}

export function turnView(ctx, args) {
  const [id] = words(args);
  const turn = id ? turnOf(ctx.log.read({ sinceMs: Date.parse(ctx.now()) - 90 * DAY_MS }), id) : null;
  if (!turn) throw new Refused(`no turn "${id ?? ""}" in the trail — \`trace turns\` lists them`);
  if (args.includes("--json")) return out(JSON.stringify({ version: 1, turn }, null, 2));
  printedTurn(turn);
}

function printedTurn(t) {
  out(`TURN      ${t.id} · session ${t.session ?? "(a shell)"} · ${t.at} → ${t.endedAt ?? "still open"} (${spent(t.ms)}) · ${t.outcome}`);
  out(`PROMPT    ${t.prompt ? `${t.prompt.chars} character(s)${t.prompt.hash ? ` · fingerprint ${t.prompt.hash} (salted; the text is never kept)` : ""}` : "no prompt was recorded for these steps"}`);
  routed(t.routing);
  walked(t);
}

function walked(t) {
  out("PATH");
  for (const s of t.steps) out(`  ${clock(s.at)}  ${s.kind.padEnd(11)} ${s.label}${ended(s).long}${s.refused ? "  (refused by its switch)" : ""}`);
  out(`FOLLOWED  ${t.followed.verdict} — ${t.followed.say}`);
}

function routed(r) {
  if (r?.routing !== "on") return out("ROUTER    no routing decision was recorded — the router was off or saw no prompt");
  out(`ROUTER    intent ${r.intent} (${r.confidence})${(r.cues ?? []).length ? ` · matched ${r.cues.join(", ")}` : ""} · context ${r.injected ? "added to the prompt" : "not added (nothing worth saying)"}`);
  for (const n of r.graph ?? []) out(`  ${n.requirement.padEnd(30)} ${n.level.padEnd(11)} ${String(n.status).padEnd(10)} ${n.provider ? `${n.provider.kind}:${n.provider.id}` : "—"}${n.transitive ? "  (pulled in by a provider)" : ""}`);
  out(`  selected: ${ids(r.selected)} · needs approval: ${ids(r.approval)} · blocked: ${ids(r.blocked)} · missing: ${ids(r.missing)}`);
}

const ids = (list) => (list ?? []).map((e) => e.id).join(", ") || "—";

export function usageView(ctx, args) {
  const events = ctx.log.read(windowOf(ctx, args, 30));
  const u = usageOf(events, { allowed: ctx.allowed?.() ?? new Map(), sinceMs: windowOf(ctx, args, 30).sinceMs });
  if (args.includes("--json")) return out(JSON.stringify({ version: 1, ...u }, null, 2));
  headline(u, daysOf(args, 30));
  sections(u);
}

function headline(u, days) {
  out(`USAGE  last ${days} day(s) · ${u.window.events} event(s) · ${u.totals.sessions} session(s) · ${u.totals.turns} prompt(s)`);
  out(`  commands: ${u.totals.orbit} Orbit · ${u.totals.shell} other · ${u.totals.failed.failed} failed of ${u.totals.failed.of} · skills started ${u.totals.skills} · agents ${u.totals.agents} · tool uses ${u.totals.tools}\n`);
}

function sections(u) {
  listed("Orbit commands", u.commands.map((c) => `${`${c.id}${c.sub ? ` ${c.sub}` : ""}`.padEnd(34)} ${c.runs} run(s) · ${c.failed} failed · ${c.sessions} session(s)`));
  listed("other commands (class · executable)", u.shell.map((c) => `${`${c.class}${c.exe ? ` · ${c.exe}` : ""}`.padEnd(34)} ${c.runs} run(s) · ${c.failed} failed`));
  listed("skills (started · refused · Orbit commands while active — a heuristic)", u.skills.map((s) => `${s.id.padEnd(34)} ${s.invoked} · ${s.refused} · ${s.commands} (${s.failed} failed)`));
  listed("flows (A → B)", u.transitions.map((t) => `${t.from} → ${t.to}   ×${t.count}`));
  more(u);
}

function more(u) {
  listed("common paths (per prompt)", u.paths.map((p) => `${p.path}   ×${p.turns}`));
  listed("failures, and what came next", u.failures.map((f) => `${f.label}: ${f.failed} of ${f.of} · then ${f.followedBy.map((n) => `${n.label} ×${n.count}`).join(", ")}`));
  listed("least privilege — pre-approved, never run in this window", u.privilege.unused.map((p) => `${p.skill}: ${p.rule}`));
  listed("least privilege — run without pre-approval (a prompt each time)", u.privilege.unapproved.map((p) => `${p.skill}: ${p.command}`));
  attributed(u.attribution);
}

// 0.2.2, ADR 0044: which agent made a call, as the hosts' own payloads say -- every count with what it counts.
const agentWords = (a) => `${String(a.type ?? "an agent").padEnd(28)} ${a.agent.slice(-8)}${a.by ? ` · launched by ${a.by === "session" ? "the session" : a.by.slice(-8)}` : ""}${a.run ? ` · run ${a.run}` : ""}${a.ended ? " · ended" : a.started ? " · started" : ""}`;

const countWords = (c) => `${c.events} tool event(s) · ${c.calls} call(s) · ${c.failed} failed · ${c.unknown} unknown`;

function attributed(a) {
  if (!a) return;
  listed("agents — the host's own payload, never a guess (tool events · distinct calls · failed · result not reported)", a.byAgent.map((r) => `${agentWords(r)}   ${countWords(r)}${r.skills.length ? ` · skills ${r.skills.join(", ")}` : ""}`));
  out(`  no agent named: ${countWords(a.session)} -- ${a.session.say}`);
  out(`  coverage: ${a.coverage.withAgent} of ${a.coverage.of} ${a.coverage.unit} name an agent · ${a.coverage.withCall} name a call${a.coverage.hosts.length ? ` · ${a.coverage.hosts.map((h) => `${h.host} ${h.withAgent}/${h.events}`).join(", ")}` : ""}\n`);
}

function listed(title, lines) {
  if (!lines.length) return;
  out(`  ${title}`);
  for (const l of lines) out(`    ${l}`);
}

export function whereView(ctx) {
  out(`trail     ${ctx.log.dir}`);
  out("  shards  <YYYY-MM-DD>-<host>.jsonl, append-only, 90 days, capped per shard");
  out(`  state   ${ctx.on ? "recording" : "OFF on this machine (the `trace` option, or ORBIT_TRACE)"}`);
  out("  never   a prompt's text, a response, a command's arguments, a tool's output, a path or a file's contents");
}
