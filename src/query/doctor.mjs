// `query doctor`: what this project needs on THIS machine, and what is missing.
//
// Installing the plugin installs the engine and nothing else. The browser driver
// and the database client are somebody else's software, and when one is absent
// the first case to run fails somewhere that reads like a product defect -- so
// the question is asked once, before any case is written.
//
// WHICH tools are required is read off what the project DECLARED, the same rule
// as everywhere else: `sql.command` matters only when there is one, a `launcher`
// only when the project named one. The engine holds no fixed list.
import { existsSync } from "node:fs";
import { BROWSER_CLI, BROWSER_CLI_PACKAGE } from "../browser/index.mjs";
import { out } from "./format.mjs";

export const doctorFindings = (ctx) => required(ctx).map(asked);

export function doctor(ctx) {
  const rows = doctorFindings(ctx);
  for (const r of rows) out(`${r.ok ? "ok  " : "MISS"}  ${r.what.padEnd(26)} ${r.detail}`);
  const missing = rows.filter((r) => !r.ok);
  advise(missing);
  return { findings: missing.length };
}

function required(ctx) {
  const sql = ctx.config.sql.command?.[0];
  const launcher = ctx.config.launcher;
  return [
    { what: BROWSER_CLI, install: BROWSER_CLI_PACKAGE, ask: () => ctx.tools.present(BROWSER_CLI), fix: `the engine drives the browser through \`${BROWSER_CLI}\` — \`node <plugin>/cli/setup.mjs --install\` installs it` },
    ...(sql ? [{ what: sql, ask: () => ctx.tools.present(sql), fix: `project.json sql.command runs \`${sql}\` — install it, or point sql.command at something else` }] : []),
    ...(launcher ? [{ what: "launcher", ask: () => file(launcher), fix: `project.json launcher names ${launcher}, and nothing is there` }] : []),
    ...capabilityTools(ctx),
  ];
}

// A capability DECLARED which commands it shells out to, and a missing one is
// BLOCKED at run time -- correctly, but after somebody waited for a browser. The
// same rule as everywhere else applies: WHICH tools are required is read off what
// was declared, and the engine holds no fixed list.
function capabilityTools(ctx) {
  const pairs = ctx.capabilities?.list?.().flatMap((c) => (c.tools ?? []).map((bin) => [bin, c.id])) ?? [];
  const bins = [...new Set(pairs.map(([bin]) => bin))];
  return bins.map((bin) => ({ what: bin, ask: () => ctx.tools.present(bin), fix: `${askedBy(pairs, bin)} needs \`${bin}\` — install it, or point that capability at something else` }));
}

const askedBy = (pairs, bin) => pairs.filter(([b]) => b === bin).map(([, id]) => id).join(" and ");

// A state that knows WHY something is unusable usually knows the fix better
// than the requirement that asked for it, so its advice wins.
function asked(r) {
  const state = r.ask();
  return { ...r, ...said(state), fix: state.fix ?? r.fix };
}

const said = (state) => ({ ok: state.ok, detail: state.ok ? state.said || "present" : state.why });

const file = (path) => (existsSync(path) ? { ok: true, said: path } : { ok: false, why: "not there" });

// A doctor that only lists what is wrong has done half the job.
function advise(missing) {
  listed(missing);
  scope();
}

function listed(missing) {
  if (!missing.length) return out("\nevery tool this project declared is usable here.");
  out(`\n${missing.length} missing — a case cannot run until each is fixed:`);
  for (const m of missing) out(`  ${m.what}: ${m.fix}`);
}

// What it does NOT speak for, said out loud. "every tool this project declared
// is usable here" is a narrow claim -- three tools at most, and only that each
// can start -- and it was being read as a general all-clear. The session's own
// tools and MCP servers are the case people got wrong: those are observed by
// whoever is driving, and there is nothing here that could infer them.
function scope() {
  out("\nThat covers the tools this project DECLARED, on this machine, and only whether each can");
  out("start. It says nothing about whether the product is reachable, whether a browser is signed");
  out("in, or which tools and MCP servers this session has — that last is observed, never inferred.");
}
