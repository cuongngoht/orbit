#!/usr/bin/env node
// THE QA RELAY'S CLIENT, in the benchmark's runner. In a QA benchmark round this file stands where Orbit's
// cli/autonomous-qa.mjs stands in the plugin the coding host is given: the investigation's engine runs beside the
// controller, where the application's isolated sandbox is, and this container cannot reach either. So the same
// command a playbook types -- `node <plugin>/cli/autonomous-qa.mjs context --investigation=<id>`, a decision on stdin
// for `step` -- is written as a request into the run's mailbox and answered by the engine there: its output printed,
// its exit code returned. A --decision or --file is read HERE and sent as stdin; nothing names a path on the other side.
// The controller runs only the subcommands its relay table allows (benchmark/lib/qa/relay.mjs) and refuses the rest.
//
//   node cli/autonomous-qa.mjs <subcommand> [--flags] [< decision.json]      mailbox: $ORBIT_QA_RELAY (/work/relay)
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const MAILBOX = process.env.ORBIT_QA_RELAY || "/work/relay";

// The longest a request is waited for: every engine step is bounded on the controller's side, well inside this.
const WAIT_MS = 75 * 60 * 1000;

const READS_STDIN = new Set(["step", "draft-plan"]);

const FILE_FLAG = /^--(decision|file)=(.+)$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stdinText = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};

// The flags as sent: a file a flag names is read here, and its text is what stdin carries.
const fileOf = (argv) => argv.map((a) => FILE_FLAG.exec(a)).find(Boolean)?.[2] ?? null;

const stdinFor = async (argv) => (fileOf(argv) ? readFileSync(fileOf(argv), "utf8") : READS_STDIN.has(argv[0]) && !process.stdin.isTTY ? await stdinText() : "");

function asked(argv, stdin) {
  const name = `${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}.json`;
  writeFileSync(join(MAILBOX, "requests", `.${name}.part`), JSON.stringify({ v: 1, argv: argv.filter((a) => !FILE_FLAG.test(a)), stdin }));
  renameSync(join(MAILBOX, "requests", `.${name}.part`), join(MAILBOX, "requests", name));
  return name;
}

async function answerOf(name, until) {
  const file = join(MAILBOX, "responses", name);
  while (!existsSync(file) && Date.now() < until) await sleep(250);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { exit: 3, stdout: "", stderr: `BLOCKED the benchmark's relay did not answer within ${WAIT_MS / 60000} minutes\n` };
}

async function main(argv) {
  if (!existsSync(join(MAILBOX, "requests"))) return { exit: 3, stdout: "", stderr: "BLOCKED this plugin's autonomous-qa runs through a benchmark relay, and none is here\n" };
  return answerOf(asked(argv, await stdinFor(argv)), Date.now() + WAIT_MS);
}

main(process.argv.slice(2)).then((a) => (process.stdout.write(a.stdout ?? ""), process.stderr.write(a.stderr ?? ""), (process.exitCode = Number.isInteger(a.exit) ? a.exit : 3)));
