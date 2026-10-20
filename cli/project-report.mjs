#!/usr/bin/env node
// A PROJECT REPORT for a product owner: the project's source read once, frozen,
// computed and rendered as one offline page. Run it from the project's checkout.
//
//   node project-report.mjs where                    where this project's reports and their data live
//   node project-report.mjs status [--json]          settings, connection, runtime and the last runs
//   node project-report.mjs settings [--json]        the report settings, with the revision a change names
//   node project-report.mjs set <key=value>… --revision=<r> [--human]
//                                                    change settings; approving a replacement needs --human
//   node project-report.mjs run [--months=N | --from=D --to=D | --all] [--as-of=D] [--out=DIR] [--dry] [--json]
//                                                    collect once, freeze, compute, render (default: the
//                                                    last two complete months; --dry touches nothing)
//   node project-report.mjs render [<run-id>|latest] [--json]
//                                                    render a frozen run again -- no source is asked
//   node project-report.mjs runs [--json]            the runs on record
//   node project-report.mjs parts [--json]           standard and project parts, and which would run, why
//   node project-report.mjs probe [--json]           test the bound connection against this project's scope
//   node project-report.mjs connections [--json]     this machine's connections (never a credential)
//   node project-report.mjs connect <id> --provider=<p> --organization=<o> [--host=<url>] [--credential-env=<NAME>]
//                                                    create or change a connection whose credential is an
//                                                    environment variable (a stored one: Orbit Control)
//
// Exit 0 = done · 2 = REFUSED (the request or the settings are wrong) ·
// 3 = BLOCKED (no connection, no credential, no Python, the source would not answer).
// A credential is never an argument: a --token or --pat is refused by name.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundReport } from "../skills/orbit-report/bind.mjs";
import { Refused } from "../src/errors.mjs";
import { command } from "../src/project/command.mjs";
import { planReport, renderRun, reportStatus, runReport } from "../src/project-report/index.mjs";
import { setPath, writeSettings } from "../src/project-report/settings.mjs";
import { runIds } from "../src/project-report/store.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const args = rest.filter((a) => !a.startsWith("--"));
const flag = (n) => rest.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const has = (n) => rest.includes(`--${n}`);
const json = has("json");

const COMMANDS = { where, status, settings, set, run, render, runs, parts, probe, connections, connect };

async function main() {
  refuseSecrets(rest);
  if (rest.some((a) => a.startsWith("--") && !["revision", "human", "months", "from", "to", "all", "as-of", "out", "dry", "json", "provider", "organization", "host", "credential-env"].includes(a.slice(2).split("=")[0]))) throw new Refused("unknown report option");
  if (!cmd || cmd === "--help") return help();
  if (!COMMANDS[cmd]) throw new Refused(`unknown report command: ${cmd}`);
  await COMMANDS[cmd](await boundReport({ env: process.env, cwd: process.cwd(), log: (l) => console.error(l) }));
}

// Anything that looks like a credential on the command line is refused before
// anything reads it: argv is visible to every process on the machine.
function refuseSecrets(list) {
  if (list.some((a) => /^--(token|pat|password|secret|credential)(=|$)/i.test(a))) throw new Refused("a credential is never an argument; set it in Orbit Control → Connections, or name an environment variable with --credential-env");
}

const say = (label, text) => console.log(`${label.padEnd(11)} ${text}`);
const printed = (value, human) => (json ? console.log(JSON.stringify(value, null, 2)) : human(value));

// ---- where, status ----------------------------------------------------------------

function where(b) {
  say("reports", b.rctx.settings.output?.dir ?? `${b.rctx.reportsDir}/project-reports`);
  say("data", b.rctx.room.root);
  say("settings", b.rctx.room.settings);
  say("runs", b.rctx.room.runs);
  console.log(`\nEverything but the page lives in the machine store, outside every repository; a plugin update does not touch it.`);
}

function status(b) {
  const s = reportStatus(b.rctx);
  printed({ ...s, connection: b.rctx.connection ? b.connections.get(b.rctx.connection.id) : null, pythonProblem: b.rctx.pythonProblem?.reason ?? null }, (v) => statusLines(v, b));
}

function statusLines(v, b) {
  say("project", `${v.project.name} (${v.project.root})`);
  say("source", v.provider ? `${v.provider} · scope ${JSON.stringify(b.rctx.settings.scope ?? {})}` : "not chosen — set provider=github|azure-devops and a scope");
  say("connection", v.connection ? `${v.connection.id} · credential ${v.connection.credential.set ? `from ${v.connection.credential.from}` : "NOT SET"}${v.connection.lastTest ? ` · last test ${v.connection.lastTest.ok ? "ok" : "failed"} ${v.connection.lastTest.at}` : ""}` : "none bound — set connection=<id> (see `connections`)");
  say("python", v.python ? `${v.python.version} (${v.python.from}) ${v.python.file}` : `missing — ${v.pythonProblem}`);
  say("runs", v.runs.length ? v.runs.slice(0, 5).map((r) => `${r.runId} ${r.window?.from ?? "start"}→${r.window?.to ?? "?"} ${r.status}`).join("\n          ") : "none yet");
}

// ---- settings --------------------------------------------------------------------------

function settings(b) {
  printed({ revision: b.rctx.revision, settings: b.rctx.settings }, (v) => console.log(`${JSON.stringify(v.settings, null, 2)}\nrevision: ${v.revision ?? "(none yet — the first change needs no revision)"}`));
}

function set(b) {
  if (!args.length) throw new Refused("node project-report.mjs set <key=value>… --revision=<r> [--human]");
  const next = args.reduce((doc, pair) => setPath(doc, ...pairOf(pair)), b.rctx.settings);
  approvals(b.rctx.settings, next);
  const kept = writeSettings(b.rctx.room, b.rctx.io, { next, revision: flag("revision") ?? null, by: has("human") ? "person" : "orbit", providers: b.rctx.pack.providers, now: new Date().toISOString() });
  printed(kept, (v) => say("saved", `revision ${v.revision}`));
}

function pairOf(pair) {
  const at = pair.indexOf("=");
  if (at <= 0) throw new Refused(`${pair} is not key=value`);
  return [pair.slice(0, at), pair.slice(at + 1)];
}

// Approving a part that REPLACES a standard one is a person's act, relayed.
function approvals(was, next) {
  const added = Object.entries(next.parts ?? {}).filter(([id, p]) => p?.replace === true && was.parts?.[id]?.replace !== true).map(([id]) => id);
  if (added.length && !has("human")) throw new Refused(`approving ${added.join(", ")} as a replacement of a standard part is a person's decision; relay it with --human, or approve it in Orbit Control → PO Reports → Extensions`);
}

// ---- run, render ------------------------------------------------------------------------

async function run(b) {
  const request = { months: flag("months") ? Number(flag("months")) : undefined, from: flag("from"), to: flag("to"), asOf: flag("as-of"), all: has("all") };
  const rctx = await zoned(outFor(b.rctx));
  if (has("dry")) return printed(planReport(rctx, request, b.deps), planLines);
  printed(await runReport(rctx, request, b.deps), headline);
}

const outFor = (rctx) => (flag("out") ? { ...rctx, settings: { ...rctx.settings, output: { ...rctx.settings.output, dir: resolve(flag("out")) } } } : rctx);

// A project's reports are in ITS zone; the first run records this machine's,
// so a report run later somewhere else draws the same days.
async function zoned(rctx) {
  if (rctx.settings.timezone) return rctx;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const kept = writeSettings(rctx.room, rctx.io, { next: { ...rctx.settings, timezone: tz }, revision: rctx.revision, by: "orbit", providers: rctx.pack.providers, now: new Date().toISOString() });
  return (console.error(`time zone: ${tz} (this machine's), recorded in the report settings — change it with set timezone=<IANA name>`), { ...rctx, settings: kept, revision: kept.revision });
}

async function render(b) {
  const ids = runIds(b.rctx.room, b.rctx.io);
  const id = !args[0] || args[0] === "latest" ? ids[0] : args[0];
  if (!id) throw new Refused("there is no run to render yet: node project-report.mjs run");
  printed(await renderRun(b.rctx, id, b.deps), headline);
}

function headline(out) {
  say("report", out.report);
  say("window", `${out.window.from ?? "start"} → ${out.window.to}${out.window.partial ? " (to date)" : ""} · cut-off ${out.window.cutoff} · ${out.window.tz}`);
  say("run", `${out.runId} · render ${out.n} · ${out.status.toUpperCase()}`);
  say("coverage", Object.entries(out.completeness).map(([k, c]) => `${k} ${c.status}${c.permission ? ` (needs ${c.permission})` : ""}`).join(" · "));
  lastLines(out);
}

function lastLines(out) {
  say("parts", out.parts.map((p) => `${p.id} ${p.version} ${p.status}`).join(" · "));
  for (const s of out.skipped) say("skipped", `${s.id} — ${s.why}`);
  say("baseline", out.baseline ? `compared with ${out.baseline}` : "none — see the report's Baseline section for why");
  if (out.warning) say("warning", out.warning);
}

function planLines(p) {
  say("window", `${p.window.from ?? "start"} → ${p.window.to} · cut-off ${p.window.cutoff} · ${p.window.tz}`);
  say("source", `${p.provider ?? "NOT SET"} · connection ${p.connection ?? "NONE"}`);
  say("python", p.python ? `${p.python.version} (${p.python.from})` : "MISSING — Orbit Control → Tools → Python");
  plannedParts(p);
}

function plannedParts(p) {
  say("collect", p.collectors.run.map((x) => x.id).join(" · ") || "nothing");
  say("compute", p.computed.run.map((x) => `${x.id} ${x.version}`).join(" · ") || "nothing");
  for (const s of [...p.collectors.skipped, ...p.computed.skipped]) say("skipped", `${s.id} — ${s.why}`);
}

function runs(b) {
  printed(reportStatus(b.rctx).runs, (rows) => (rows.length ? rows.forEach((r) => say(r.status, `${r.runId} ${r.window?.from ?? "start"} → ${r.window?.to ?? "?"} · ${r.renders} render(s)${r.report ? ` · ${r.report}` : ""}`)) : console.log("no runs yet")));
}

function parts(b) {
  const plan = planReport(b.rctx, {}, b.deps);
  printed({ standard: b.rctx.pack.parts.map(partRow), project: b.rctx.extensions.parts.map(partRow), refused: b.rctx.extensions.refused, contested: b.rctx.extensions.contested, would: { collect: plan.collectors.run.map((p) => p.id), compute: plan.computed.run.map((p) => p.id), skipped: [...plan.collectors.skipped, ...plan.computed.skipped] } }, partLines);
}

const partRow = (p) => ({ id: p.id, version: p.version, kind: p.kind, from: p.from ?? "orbit", doc: p.doc, replaces: p.replaces ?? null });

function partLines(v) {
  for (const p of [...v.standard, ...v.project]) say(p.kind, `${p.id} ${p.version} · ${p.from}${p.replaces ? ` · replaces ${p.replaces}` : ""} — ${p.doc}`);
  for (const r of v.refused) say("refused", `${r.id} — ${r.why}`);
  say("would run", [...v.would.collect, ...v.would.compute].join(" · "));
  for (const s of v.would.skipped) say("skipped", `${s.id} — ${s.why}`);
}

// ---- connections ------------------------------------------------------------------------

async function probe(b) {
  if (!b.rctx.connection) throw new Refused("no connection is bound to this project's report; set connection=<id> (see `connections`)");
  const result = await b.connections.test(b.rctx.connection.id, b.probe);
  printed(result, (r) => r.checks.forEach((c) => say(c.status, `${c.id}${c.permission && c.status !== "ok" ? ` — needs ${c.permission}` : ""}${c.message ? ` · ${c.message}` : ""}`)));
  process.exitCode = result.ok ? 0 : 3;
}

function connections(b) {
  printed(b.connections.list(), (rows) => (rows.length ? rows.forEach((c) => say(c.provider, `${c.id} · ${c.organization} · ${c.host} · credential ${c.credential.set ? `from ${c.credential.from}${c.credential.name ? ` ${c.credential.name}` : ""}` : "not set"}`)) : console.log("no connections yet — Orbit Control → Connections, or `connect`")));
}

async function connect(b) {
  const [id] = args;
  if (!id) throw new Refused("node project-report.mjs connect <id> --provider=<p> --organization=<o> [--host=<url>] [--credential-env=<NAME>]");
  const exists = b.connections.list().some((c) => c.id === id);
  const saved = exists ? b.connections.update(id, { host: flag("host"), organization: flag("organization") }) : b.connections.create({ id, provider: flag("provider"), organization: flag("organization"), ...(flag("host") ? { host: flag("host") } : {}) });
  printed(flag("credential-env") ? await b.connections.setCredential(id, { env: flag("credential-env") }) : saved, (c) => say("saved", `${c.id} · credential ${c.credential.set ? `from ${c.credential.from} ${c.credential.name ?? ""}` : "not set"} — bind it with: set connection=${c.id}`));
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}

command(main);
