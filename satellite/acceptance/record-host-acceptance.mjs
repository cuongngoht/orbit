#!/usr/bin/env node
// RECORD NATIVE HOST ACCEPTANCE: what a person saw a REAL host session do with Satellite, kept as a receipt keyed to the
// exact source it ran on (satellite/src, satellite/cli, skills/satellite, agents/satellite-*). The host matrix counts a
// claimed capability `verified` only while a receipt for THIS source says its result passed; any edit to that source
// makes every receipt stale, and a stale receipt counts for nothing. Nothing here runs a host or checks what it is told:
// it keeps a person's account of a live run, refuses one that is malformed (exit 2), and writes nowhere but
// satellite/acceptance/host-acceptance.json. An unsupported document there is refused and kept byte for byte.
//
//   node satellite/acceptance/record-host-acceptance.mjs --host=claude --version="<host version>"
//        --result=claude:agent-dispatch:mission.start,dispatch,agent.report:passed [--result=…] [--dry]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Refused } from "../../src/errors.mjs";
import { command } from "../../src/project/command.mjs";
import { sourceFilesOf } from "../cli/bind.mjs";
import { ACCEPTANCE_FILE, ACCEPTANCE_SCHEMA, passedOn, receiptOf, recordedDoc, recordProblems, resultOf, sourceDigestOf } from "../src/hosts/acceptance.mjs";
import { CAPABILITIES, HOSTS, HOST_IDS } from "../src/hosts/matrix.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(ROOT, "satellite", "acceptance", ACCEPTANCE_FILE);
const ARGV = process.argv.slice(2);

const flagOf = (name) => ARGV.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const asked = () => ({ host: flagOf("host"), version: flagOf("version"), results: ARGV.filter((a) => a.startsWith("--result=")).map((a) => ((text) => ({ text, parsed: resultOf(text) }))(a.slice(9))) });

function current() {
  const doc = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { schema: ACCEPTANCE_SCHEMA, receipts: [] };
  if (doc.schema !== ACCEPTANCE_SCHEMA) throw new Refused(`${FILE} is schema ${doc.schema}; this recorder writes schema ${ACCEPTANCE_SCHEMA} and leaves the file as it is`);
  return doc;
}

// Which claimed cells of this host the recorded results would earn, on this source.
const earned = (doc, host, code) => ((passed) => CAPABILITIES.filter((cap) => HOSTS[host][cap].value === "verified" && passed.has(HOSTS[host][cap].by.acceptance)))(passedOn(doc, code));

function main() {
  const r = asked();
  const problems = recordProblems(r, HOST_IDS.filter((h) => h !== "unknown"));
  if (problems.length) throw new Refused(problems.map((p) => `${p.id}: ${p.say}`).join("; "));
  const doc = recordedDoc(current(), receiptOf(r, sourceDigestOf(sourceFilesOf(ROOT)), new Date().toISOString(), { platform: process.platform, arch: process.arch, node: process.version }));
  return written(doc, r.host, ARGV.includes("--dry"));
}

function written(doc, host, dry) {
  if (!dry) writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
  const receipt = doc.receipts.find((x) => x.host.id === host);
  console.log(JSON.stringify({ file: dry ? null : FILE, dry, host, code: receipt.host.code, results: receipt.results, earns: earned(doc, host, receipt.host.code) }, null, 2));
}

command(main);
