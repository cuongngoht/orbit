#!/usr/bin/env node
// THE EVALUATOR'S ONE ENTRY POINT. A campaign runs detached-safe: everything it decides is in its journal under
// $ORBIT_EVAL_HOME (default ~/.orbit-eval), so a controller that dies is resumed from there. A model arm's credential is
// handed by NAME: launch as `CLAUDE_CODE_OAUTH_TOKEN="$..." node evaluator/cli.mjs run <campaign.json>`; its value is
// never printed, written or logged.
//
//   node cli.mjs run <campaign.json> [--ca-file=<pem>] [--keep-scratch]     start a campaign
//   node cli.mjs resume <id> [--ca-file=<pem>]                              carry one on from its journal
//   node cli.mjs status <id> [--json]                                       where it stands, and its ledger
//   node cli.mjs report <id> [--md]                                         the report (written to its room too)
//   node cli.mjs export <id> --to=<dir>                                     what to commit, under evaluator/results/
//   node cli.mjs cleanup <id>                                               remove its leftover containers and networks
//   node cli.mjs selfcheck [--ca-file=<pem>] [--tasks=pack:a,swebench:b] [--controls=gold-done,noop-done] [--keep-images]
//   node cli.mjs packs list | verify [<id>...] | convert --from=<old benchmark dir>
//   node cli.mjs tools [--ca-file=<pem>]                                    the tools volume (Node + pinned Claude Code)
//   node cli.mjs prereg verify [--file=<prereg.json>]                       the registered order re-derived from its rule
//   node cli.mjs prereg campaign <phase> [--rev=<commit>] [--id=] [--ca-file=] [--out=]   a phase's campaign, from it
//   node cli.mjs checks                                                     the evaluator's own checks (no Docker)
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { LABEL, listByLabel, removeContainer, removeNetwork } from "./lib/core/docker.mjs";
import { ensureTools } from "./lib/core/tools.mjs";
import { ensureDir, EVALUATOR_DIR, evalHome, writeJson } from "./lib/core/util.mjs";
import { campaignOf, loadPrereg, PREREG_DIR, verifyPrereg } from "./lib/prereg/index.mjs";
import { campaignStatus, resumeCampaign, startCampaign } from "./lib/run/campaign.mjs";
import { exportCampaign } from "./lib/run/export.mjs";
import { markdownOf, writtenReport } from "./lib/run/report.mjs";
import { selfcheck } from "./lib/run/selfcheck.mjs";
import { verifyPacks } from "./lib/run/verify-packs.mjs";
import { convertAll } from "./lib/tasks/convert-all.mjs";
import { PACKS_DIR, packIds } from "./lib/tasks/packs.mjs";

const flags = (args) => Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => ((m) => [m[1], m[2] ?? true])(/^--([a-z-]+)(?:=(.*))?$/.exec(a) ?? [null, a, true])));

const positional = (args) => args.filter((a) => !a.startsWith("--"));

const print = (v) => process.stdout.write(typeof v === "string" ? `${v}\n` : `${JSON.stringify(v, null, 2)}\n`);

const home = () => evalHome();

const roomOf = (id) => join(home(), "campaigns", id);

const COMMANDS = {
  run: async ([file], f) => print(summaryLine(await startCampaign(file, { caFile: f["ca-file"], keepScratch: f["keep-scratch"] === true }))),
  resume: async ([id], f) => print(summaryLine(await resumeCampaign(id, { caFile: f["ca-file"], keepScratch: f["keep-scratch"] === true }))),
  status: ([id], f) => ((s) => print(f.json ? s : statusText(s)))(campaignStatus(id)),
  report: ([id], f) => ((r) => print(f.md ? markdownOf(r) : r))(writtenReport(roomOf(id))),
  export: ([id], f) => print(exportCampaign(id, f.to ?? join(EVALUATOR_DIR, "results"))),
  cleanup: ([id]) => print(cleanedUp(id)),
  selfcheck: async (_, f) => selfcheckPrinted(await selfcheck({ caFile: f["ca-file"], tasks: f.tasks ? String(f.tasks).split(",") : undefined, controls: f.controls ? String(f.controls).split(",") : undefined, keepImages: f["keep-images"] === true, scratchDir: ensureDir(join(home(), "selfcheck")) })),
  packs: async ([sub, ...ids], f) => PACKS[sub ?? "list"](ids, f),
  tools: (_, f) => print(ensureTools({ caFile: f["ca-file"] })),
  prereg: ([sub, ...rest], f) => PREREG[sub ?? "verify"](rest, f),
  checks: () => process.exit(spawnSync(process.execPath, ["--test", ...readdirSync(join(EVALUATOR_DIR, "checks")).filter((n) => n.endsWith(".check.mjs")).map((n) => join(EVALUATOR_DIR, "checks", n))], { stdio: "inherit" }).status ?? 1),
};

const PACKS = {
  list: () => print(packIds().join("\n")),
  verify: async (ids) => verifyPrinted(await verifyPacks(ids.length ? ids : packIds())),
  convert: (_, f) => print(convertAll(f.from, PACKS_DIR).map((d) => `${d.id}\t${d.excluded ? `EXCLUDED: ${d.excluded}` : d.controls.join(",")}`).join("\n")),
};

const preregFile = (f) => f.file ?? join(PREREG_DIR, "0.6.0.json");

const PREREG = {
  verify: (_, f) => ((r) => (print(r.problems.length ? `PREREG FAILED:\n${r.problems.map((x) => `  - ${x}`).join("\n")}` : `PREREG HOLDS: the registered order is the rule's${r.rowsChecked ? ", rows and digests checked against the cached dataset" : " (packs only: no cached dataset here)"}`), (process.exitCode = r.problems.length ? 1 : 0)))(verifyPrereg(loadPrereg(preregFile(f)), { home: home() })),
  campaign: ([phase], f) => print(writeJson(f.out ?? join(home(), "defs", `${f.id ?? phase}.json`), campaignOf(loadPrereg(preregFile(f)), phase, { id: f.id, rev: f.rev, caFile: f["ca-file"] }))),
};

const summaryLine = (r) => `campaign ${r.campaign.id}: ${r.finished ? "finished" : "stopped"}; ${r.arms.map((a) => `${a.arm} ${a.resolved}/${a.gradable}${a.words.INFRA_ERROR ? ` (+${a.words.INFRA_ERROR} infra)` : ""}`).join(", ")}; charged $${r.ledger.chargedUsd}`;

const statusText = (s) => [`campaign ${s.id} — ${s.finished ? "finished" : s.controller?.alive ? `running (pid ${s.controller.pid})` : "not running"}; budget $${s.ledger.budgetUsd}, charged $${s.ledger.chargedUsd}, reserved $${s.ledger.reservedUsd}, left $${s.ledger.remainingUsd}`, ...s.rows.map((r) => `  ${r.state.padEnd(12)} ${r.key}${r.attempts > 1 ? ` (${r.attempts} attempts)` : ""}${r.why && r.state !== "RESOLVED" ? ` — ${r.why}` : ""}`)].join("\n");

function cleanedUp(id) {
  const containers = listByLabel("container", LABEL.campaign, id);
  const networks = listByLabel("network", LABEL.campaign, id);
  return { containers: containers.map((c) => ({ c, ...removeContainer(c) })), networks: networks.map((n) => ({ n, ...removeNetwork(n) })) };
}

function selfcheckPrinted(r) {
  print(`selfcheck campaign ${r.id}`);
  for (const row of r.rows) print(`  ${row.ok ? "ok  " : "FAIL"} ${row.key.padEnd(48)} expect ${row.expect.padEnd(26)} got ${row.got}`);
  const bad = r.rows.filter((x) => !x.ok).length;
  print(bad ? `SELFCHECK FAILED: ${bad} of ${r.rows.length} control(s) did not end on their word` : `SELFCHECK HELD: ${r.rows.length} of ${r.rows.length} controls ended on their word`);
  process.exitCode = bad ? 1 : 0;
}

function verifyPrinted(rows) {
  for (const r of rows) print(`  ${r.holds ? "ok  " : "FAIL"} ${r.pack.padEnd(18)} ${r.control.padEnd(8)} expect ${r.expect.padEnd(13)} f2p failed ${JSON.stringify(r.f2pFailed)} p2p failed ${JSON.stringify(r.p2pFailed)}${r.why ? ` — ${r.why}` : ""}`);
  const bad = rows.filter((r) => !r.holds).length;
  print(bad ? `PACKS FAILED: ${bad} of ${rows.length}` : `PACKS HELD: ${rows.length} of ${rows.length}`);
  process.exitCode = bad ? 1 : 0;
}

async function main([cmd, ...rest]) {
  if (!COMMANDS[cmd]) return print(`usage: node cli.mjs run|resume|status|report|export|cleanup|selfcheck|packs|tools|prereg|checks ... (see the head of cli.mjs)`), (process.exitCode = 2);
  try { await COMMANDS[cmd](positional(rest), flags(rest)); }
  catch (e) { print(`error: ${e.message}`); process.exitCode = 1; }
  return null;
}

main(process.argv.slice(2));
