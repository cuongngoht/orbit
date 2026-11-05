// The QA benchmark's relay: how a coding host in the runner drives an investigation whose engine runs beside the
// controller. What a host may ask is a table -- a subcommand it names, the flags it allows, the run's own
// investigation, a decision on stdin and never a path -- and the mailbox is files the runner writes and the controller
// answers, one request at a time. The client here is the real one, run as a child the way the runner runs it.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { admitted, RELAY, relayServer } from "../benchmark/lib/qa/relay.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");
const CLIENT = join(ROOT, "benchmark", "lib", "qa", "relay-client.mjs");
const INV = "inv-0123456789ab";

const ok = (argv, stdin) => admitted({ argv, stdin }, INV);

test("a host's subcommand reaches the engine about this run's investigation and no other", () => {
  assert.deepEqual(ok(["context"]).argv, ["context", `--investigation=${INV}`]);
  assert.deepEqual(ok(["context", `--investigation=${INV}`]).argv, ["context", `--investigation=${INV}`], "naming its own investigation is the same request");
  assert.match(ok(["context", "--investigation=inv-ffffffffffff"]).refused, /names another investigation: this run's is inv-0123456789ab/);
  assert.deepEqual(ok(["protocol"]).argv, ["protocol"], "the protocol is about no investigation");
  assert.deepEqual(ok(["finish", "--why=the frontier is settled"]).argv, ["finish", `--investigation=${INV}`, "--why=the frontier is settled"]);
  assert.deepEqual(ok(["reproduce", "--finding=fnd-3", "--json"]).argv, ["reproduce", `--investigation=${INV}`, "--finding=fnd-3", "--json"]);
});

test("a decision reaches the engine on stdin, and only where a decision is read", () => {
  const d = JSON.stringify({ schemaVersion: 1, decisionId: "q-1" });
  assert.deepEqual([ok(["step"], d).argv, ok(["step"], d).stdin, ok(["step"], d).budget], [["step", `--investigation=${INV}`], d, "step"]);
  assert.match(ok(["context"], d).refused, /reads nothing on stdin/);
  assert.match(ok(["step"], "x".repeat(600 * 1024)).refused, /larger than a decision is/);
});

test("what is a person's, a second investigation, a path and the browser of an environment are refused by name", () => {
  const refusedFor = (argv) => ok(argv).refused ?? "";
  assert.match(refusedFor(["settings", "set", "enabled=true", "--human"]), /a person's approval, never a host's/);
  assert.match(refusedFor(["answer", "--question=qst-1", "--says=yes", "--human"]), /a person's word/);
  assert.match(refusedFor(["release", "--decision=d-1", "--why=x", "--human"]), /a person's/);
  assert.match(refusedFor(["cancel", "--why=x", "--human"]), /cancelling is a person's/);
  assert.match(refusedFor(["plan", "--objective=x"]), /already open/);
  assert.match(refusedFor(["act", "--goto=/"]), /isolated/);
  assert.match(refusedFor(["report", "--out=/etc/cron.d/x"]), /takes no --out/);
  assert.match(refusedFor(["report", "--internal"]), /takes no --internal/);
  assert.match(refusedFor(["step", "--decision=/etc/passwd"]), /takes no --decision/, "a path never crosses: the client reads the file on its own side");
  assert.match(refusedFor(["reproduce", "--finding=../../x"]), /does not hold a value it may carry/);
  assert.match(refusedFor(["finish", "--why=line\nbreak"]), /does not hold a value/);
  assert.match(refusedFor(["show", "inv-0123456789ab"]), /takes no words/);
  assert.match(refusedFor(["show", "--json=yes"]), /takes no value/);
  assert.match(admitted({ argv: "context" }, INV).refused, /is not a request/);
  assert.match(admitted(null, INV).refused, /is not a request/);
});

test("every relayed subcommand is a subcommand of the engine's own CLI", () => {
  const cli = readFileSync(join(ROOT, "cli", "autonomous-qa.mjs"), "utf8");
  for (const sub of Object.keys(RELAY)) assert.match(cli, new RegExp(`^//   node autonomous-qa\\.mjs ${sub}\\b`, "m"), sub);
});

// ---- the mailbox, with the real client --------------------------------------------------------------------------------

function mailbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-relay-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ["requests", "responses"]) mkdirSync(join(dir, d));
  return { dir, dirs: { requests: join(dir, "requests"), responses: join(dir, "responses"), log: join(dir, "relay.jsonl") } };
}

const client = (box, argv, o = {}) => new Promise((resolve) => {
  const child = execFile(process.execPath, [CLIENT, ...argv], { env: sealed({ ORBIT_QA_RELAY: box.dir }), encoding: "utf8" }, (e, stdout, stderr) => resolve({ code: child.exitCode, stdout, stderr }));
  child.stdin.end(o.stdin ?? "");
});

function engineDouble() {
  const seen = [];
  return { seen, serve: { admit: (req) => admitted(req, INV), run: async (a) => (seen.push(a), { exit: a.argv[0] === "step" ? 0 : 0, stdout: `${JSON.stringify({ ran: a.argv, stdin: a.stdin })}\n`, stderr: "" }) } };
}

test("the client's request is answered by the engine's side: its output printed, its exit code returned", async (t) => {
  const box = mailbox(t);
  const e = engineDouble();
  const server = relayServer(box.dirs, e.serve, { everyMs: 20 });
  const r = await client(box, ["context", `--investigation=${INV}`]);
  const stepped = await client(box, ["step", `--investigation=${INV}`], { stdin: '{"decisionId":"q-1"}' });
  await server.stop();
  assert.deepEqual([r.code, JSON.parse(r.stdout).ran], [0, ["context", `--investigation=${INV}`]]);
  assert.deepEqual([stepped.code, JSON.parse(stepped.stdout).stdin], [0, '{"decisionId":"q-1"}']);
  assert.equal(e.seen.length, 2);
});

test("a refused request runs nothing and exits 2; a decision file is read on the client's side and sent as stdin", async (t) => {
  const box = mailbox(t);
  const e = engineDouble();
  const server = relayServer(box.dirs, e.serve, { everyMs: 20 });
  const refused = await client(box, ["settings", "set", "enabled=false", "--human"]);
  const file = join(box.dir, "decision.json");
  writeFileSync(file, '{"decisionId":"from-a-file"}');
  const fromFile = await client(box, ["step", `--decision=${file}`]);
  await server.stop();
  assert.deepEqual([refused.code, /^REFUSED .*a person's approval/m.test(refused.stderr)], [2, true]);
  assert.equal(JSON.parse(fromFile.stdout).stdin, '{"decisionId":"from-a-file"}');
  assert.deepEqual(e.seen.map((a) => a.argv[0]), ["step"], "the refused one never reached the engine");
});

test("what the runner plants in its mailbox is removed unread, and the log keeps a decision's digest, never the decision", async (t) => {
  const box = mailbox(t);
  const secret = join(box.dir, "outside.txt");
  writeFileSync(secret, "the controller's own file");
  symlinkSync(secret, join(box.dirs.requests, "0001-planted.json"));
  mkdirSync(join(box.dirs.requests, "0002-a-directory.json"));
  const e = engineDouble();
  const server = relayServer(box.dirs, e.serve, { everyMs: 20 });
  const r = await client(box, ["step"], { stdin: '{"decisionId":"q-2","hypothesis":"a sentence the log never keeps"}' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await server.stop();
  assert.equal(readFileSync(secret, "utf8"), "the controller's own file");
  assert.equal(existsSync(join(box.dirs.requests, "0001-planted.json")), false);
  assert.ok(existsSync(join(box.dirs.responses, "0001-planted.json")) && /REFUSED/.test(readFileSync(join(box.dirs.responses, "0001-planted.json"), "utf8")));
  assert.equal(r.code, 0);
  const log = readFileSync(box.dirs.log, "utf8");
  assert.ok(!log.includes("a sentence the log never keeps") && /"digest":"[0-9a-f]{16}"/.test(log));
});

// What a real Claude Code QA row's room showed (0.4.0, ORBIT-QA-006): the host's second `finish --why=x` exited 2 and the
// relay's log said nothing more -- `refused` is the relay's own, null for a request the ENGINE refused -- while the engine
// had answered the host why (`finish` refuses an investigation no longer active: `inv-… is already paused`). The log keeps
// that line.
test("a request the engine stopped is logged with the engine's own first line -- printable, scrubbed and bounded -- and an answer of 0 with nothing it said", async (t) => {
  const box = mailbox(t);
  const said = { finish: { exit: 2, stderr: `\n${INV} is already paused\n  node cli/autonomous-qa.mjs --help for the usage\n` }, reconcile: { exit: 3, stderr: `\u001b[31mBLOCKED\u001b[0m authorization: Bearer abc.def.ghi ${"x".repeat(400)}\n` }, checkpoint: { exit: 2, stderr: "" }, context: { exit: 0, stderr: "a warning nobody asked for\n" } };
  const serve = { admit: (req) => admitted(req, INV), run: async (a) => ({ stdout: "{}\n", ...said[a.argv[0]] }) };
  const server = relayServer(box.dirs, serve, { everyMs: 20 });
  const answered = [];
  for (const argv of [["finish", "--why=x"], ["reconcile"], ["checkpoint"], ["context"], ["settings", "set", "enabled=true", "--human"]]) answered.push(await client(box, argv));
  await server.stop();
  assert.deepEqual(answered.map((r) => r.code), [2, 3, 2, 0, 2]);
  assert.match(answered[0].stderr, /is already paused/, "the host was answered the engine's words");
  const lines = readFileSync(box.dirs.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.sub, l.exit, "why" in l]), [["finish", 2, true], ["reconcile", 3, true], ["checkpoint", 2, true], ["context", 0, false], ["settings", 2, false]]);
  assert.deepEqual([lines[0].why, lines[2].why], [`${INV} is already paused`, null], "its first line said, or null when it said nothing");
  assert.match(lines[1].why, /^\[31mBLOCKED\[0m authorization/, "printable: no escape reaches the log");
  assert.equal(lines[1].why.includes("abc.def.ghi"), false, "scrubbed");
  assert.equal(lines[1].why.length, 240, "bounded");
  assert.match(lines[4].refused, /a person's approval/, "a request the relay refused says why in its own field, as before");
});

// What a person diagnosing a failed QA row read first in the 0.4.0 ships, and found only by reading the host's whole
// stream (0.5.0 backlog B6): where a run the host's `step` dispatched stopped short. The log keeps that one thing of an
// answer of 0 -- `result.stopped`, as the engine's own allow-listed view says it -- and nothing else the answer said.
test("of an answer of 0 the log keeps one thing: where a run the step dispatched stopped short (result.stopped), as the engine said it", async (t) => {
  const box = mailbox(t);
  const stopped = { step: 2, do: "call", capability: "orbit.state.read", as: "refused", says: `request.key … or request.match \u001b[31m${"y".repeat(800)}` };
  const outs = { step: { result: { outcome: "INVALID_TEST", rule: "TEST_WRONG", why: "a word the log never keeps", stopped } }, context: { result: { outcome: "SATISFIED", stopped: null }, note: "never kept either" } };
  const serve = { admit: (req) => admitted(req, INV), run: async (a) => ({ exit: 0, stdout: `${JSON.stringify(outs[a.argv[0]])}\n`, stderr: "" }) };
  const server = relayServer(box.dirs, serve, { everyMs: 20 });
  await client(box, ["step"], { stdin: '{"decisionId":"q-3"}' });
  await client(box, ["context"]);
  await server.stop();
  const lines = readFileSync(box.dirs.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(lines[0].stopped), ["outcome", "rule", "step", "do", "capability", "as", "says"]);
  assert.deepEqual([lines[0].stopped.outcome, lines[0].stopped.step, lines[0].stopped.capability, lines[0].stopped.as], ["INVALID_TEST", 2, "orbit.state.read", "refused"]);
  assert.match(lines[0].stopped.says, /^request\.key … or request\.match \[31my/, "printable");
  assert.equal(lines[0].stopped.says.length, 600, "bounded as the engine bounds it");
  assert.equal("stopped" in lines[1], false, "an answer with nothing stopped keeps nothing");
  assert.equal(readFileSync(box.dirs.log, "utf8").includes("never keeps") || readFileSync(box.dirs.log, "utf8").includes("never kept"), false, "nothing else of what an answer said");
});

test("with no mailbox the client says BLOCKED, and runs nothing", async (t) => {
  const r = await client({ dir: join(tmpdir(), "orbit-bench-no-mailbox-here") }, ["context"]);
  assert.deepEqual([r.code, /BLOCKED .*relay/.test(r.stderr)], [3, true]);
});
