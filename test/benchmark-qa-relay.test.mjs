// The QA benchmark's relay: how a coding host in the runner drives an investigation whose engine runs beside the
// controller. What a host may ask is a table -- a subcommand it names, the flags it allows, the run's own
// investigation, a decision on stdin and never a path -- and the mailbox is files the runner writes and the controller
// answers, one request at a time. A help probe is answered by the relay itself, from the engine CLI's own usage, and
// runs nothing. The client here is the real one, run as a child the way the runner runs it.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { admitted, NOT_RELAYED, RELAY, relayServer } from "../benchmark/lib/qa/relay.mjs";
import { serveOf } from "../benchmark/lib/qa/round.mjs";
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

// ---- a help probe (0.5.0, backlog B9) -----------------------------------------------------------------------------------
//
// What every 0.4.0 and 0.5.0 QA row's room showed: the host's first call to the relay was a `--help` -- the very probe the
// engine's own refusals name (`node cli/autonomous-qa.mjs --help for the usage`) -- and the relay refused it, so the host
// spent a failed call learning nothing and then guessed a flag. The relay now answers it itself, from the engine CLI's own
// usage header, read from the frozen source and never run.

// The usage lines the engine's CLI documents for one subcommand, read here from the file itself.
const CLI_HEADER = readFileSync(join(ROOT, "cli", "autonomous-qa.mjs"), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, ""));

const usageLine = (sub) => CLI_HEADER.find((l) => new RegExp(`^\\s*node autonomous-qa\\.mjs ${sub}(\\s|$)`).test(l));

// A context over this checkout's own engine CLI, and an engine that records what it is asked to run.
function served(engineDir = ROOT) {
  const ran = [];
  const engine = { cli: async (name, argv) => (ran.push([name, ...argv]), { ok: true, status: 0, out: "{}\n", err: "" }) };
  const serve = serveOf({ engineDir, case: { limits: { engine: { stepSeconds: 1, callSeconds: 1 } } } }, engine, INV);
  return { ran, serve, ask: (argv, stdin = "") => ((a) => (a.refused ? { exit: 2, stdout: "", stderr: a.refused } : serve.run(a)))(serve.admit({ argv, stdin })) };
}

test("a help probe is admitted as one -- `--help` or `-h` anywhere, `help <subcommand>`, or no subcommand at all -- and is never refused", () => {
  for (const argv of [["context", "--help"], ["--help", "context"], ["help", "context"], ["context", `--investigation=${INV}`, "-h"]]) assert.deepEqual(ok(argv), { help: { about: "context", sub: "context" } }, argv.join(" "));
  for (const argv of [["--help"], ["-h"], ["help"], []]) assert.deepEqual(ok(argv), { help: { about: null, sub: "--help" } }, argv.join(" ") || "(nothing)");
  assert.deepEqual(ok(["step", "--help"], '{"decisionId":"q-1"}'), { help: { about: "step", sub: "step" } }, "a decision sent with a probe is never stepped");
  assert.deepEqual(ok(["help", "../../etc/passwd"]), { help: { about: "../../etc/passwd", sub: "--help" } }, "a word no subcommand could be is filed under --help");
  assert.equal(ok(["finish", "--why=--help"]).refused, undefined, "a flag's value is no probe");
  assert.deepEqual(ok(["finish", "--why=--help"]).argv, ["finish", `--investigation=${INV}`, "--why=--help"]);
});

test("a relayed subcommand's probe is answered with its usage as the engine's CLI documents it, and what the relay takes of it -- running nothing", async () => {
  const s = served();
  const context = await s.ask(["context", "--help"]);
  assert.equal(context.exit, 0);
  assert.ok(context.stdout.includes(usageLine("context")), "the usage line, verbatim");
  assert.match(context.stdout, new RegExp(`--investigation is ${INV}, named or not`));
  assert.match(context.stdout, /no other flag or word; nothing on stdin/);
  assert.match((await s.ask(["help", "report"])).stdout, /through this relay: .*--json, and no other flag or word/, "the CLI documents --out and --internal; the relay says it takes --json alone");
  assert.match((await s.ask(["step", "--help"], '{"decisionId":"q-1"}')).stdout, /a decision on stdin -- or in a file named by --decision=<file> or --file=<file>/);
  assert.match((await s.ask(["finish", "-h"])).stdout, /--why="…" \(one line\), and no other flag or word/);
  assert.match((await s.ask(["reproduce", "--help"])).stdout, /--finding=fnd-<n>, --json, and no other flag or word/);
  assert.match((await s.ask(["protocol", "--help"])).stdout, /through this relay: no flag or word; nothing on stdin/, "the protocol is about no investigation");
  assert.deepEqual(s.ran, [], "nothing reached the engine: a probe costs it no time");
});

test("a probe of the whole CLI says every subcommand the relay carries, in the usage's own order, and names the rest without their usage", async () => {
  const s = served();
  for (const argv of [["--help"], ["help"], []]) {
    const a = await s.ask(argv);
    assert.equal(a.exit, 0);
    for (const sub of Object.keys(RELAY)) assert.ok(a.stdout.includes(usageLine(sub)), `${argv.join(" ")}: ${sub}`);
    for (const sub of Object.keys(NOT_RELAYED)) assert.ok(!a.stdout.includes(usageLine(sub) ?? `node autonomous-qa.mjs ${sub} `), `no usage of ${sub}, which the relay refuses`);
    assert.match(a.stdout, new RegExp(`Not carried here: ${Object.keys(NOT_RELAYED).join(", ")}`));
    assert.ok(a.stdout.indexOf(usageLine("draft-plan")) < a.stdout.indexOf(usageLine("context")), "the usage's own order");
  }
  assert.deepEqual(s.ran, []);
});

test("a probe of a subcommand the relay does not carry says why and what it carries; one of no subcommand at all, what it carries", async () => {
  const s = served();
  const plan = await s.ask(["plan", "--help"]);
  assert.equal(plan.exit, 0);
  assert.ok(plan.stdout.includes(`the relay runs no \`plan\`: ${NOT_RELAYED.plan}`));
  assert.ok(!plan.stdout.includes(usageLine("plan")), "never the usage of what it would refuse");
  assert.ok(plan.stdout.includes(`It carries: ${Object.keys(RELAY).join(", ")}`));
  assert.match((await s.ask(["help", "settings"])).stdout, /a person's approval, never a host's/);
  const none = await s.ask(["help", "constructor"]);
  assert.match(none.stdout, /the relay runs no `constructor`: the engine's usage documents no such subcommand/, "an own property only: no word reads Object's prototype");
  assert.match((await s.ask(["--help", "x".repeat(300)])).stdout, /runs no `x{40}`:/, "a word that is no subcommand is echoed bounded");
  assert.deepEqual(s.ran, []);
});

// The playbook a QA host follows shows each call it makes exactly (0.5.0, backlog B9: a host that guesses a flag spends a
// refused call learning it): one row per subcommand the relay carries, every flag one the engine's own usage documents
// for that subcommand and the relay takes -- or one the client reads on its own side (a decision's or a plan's file).
const PLAYBOOK = readFileSync(join(ROOT, "skills", "orbit-qa", "SKILL.md"), "utf8").replaceAll("\r\n", "\n");

const CLIENT_SIDE = ["investigation", "decision", "file"];

const playbookCalls = () => [...PLAYBOOK.matchAll(/^\| `([a-z][a-z-]*)((?: [^`]*)?)` \|/gm)].map((m) => ({ sub: m[1], flags: [...m[2].matchAll(/--([a-z][a-z-]*)/g)].map((f) => f[1]) }));

test("the QA playbook shows every subcommand the relay carries as one exact call, with only flags its usage documents and the relay takes", () => {
  const calls = playbookCalls();
  assert.deepEqual(Object.keys(RELAY).filter((sub) => !calls.some((c) => c.sub === sub)), [], "a subcommand a host may run that the playbook never shows");
  for (const c of calls.filter((x) => Object.hasOwn(RELAY, x.sub))) {
    for (const f of c.flags) assert.ok(CLIENT_SIDE.includes(f) || RELAY[c.sub].flags.includes(f), `${c.sub}: --${f} is not a flag the relay takes`);
    for (const f of c.flags.filter((x) => x !== "file" || c.sub === "draft-plan")) assert.ok(usageLine(c.sub).includes(`--${f}`) || (f === "decision" && c.sub === "step"), `${c.sub}: --${f} is not in its usage line`);
  }
  assert.match(PLAYBOOK, /autonomous-qa\.mjs --help` prints the usage of each/);
});

test("a probe where the engine's usage cannot be read says so, and still says what the relay takes -- inventing no usage", async (t) => {
  const empty = mkdtempSync(join(tmpdir(), "orbit-bench-relay-nocli-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const s = served(empty);
  const a = await s.ask(["context", "--help"]);
  assert.equal(a.exit, 0);
  assert.match(a.stdout, /the engine's usage could not be read here/);
  assert.match(a.stdout, /node autonomous-qa\.mjs context \(the engine's usage documents no line for it here\)/);
  assert.match(a.stdout, new RegExp(`--investigation is ${INV}, named or not`));
  assert.deepEqual(s.ran, []);
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

test("through the mailbox, the real client's `--help` is answered with the usage and exits 0; the log files it under the subcommand it asked about, as help", async (t) => {
  const box = mailbox(t);
  const s = served();
  const server = relayServer(box.dirs, s.serve, { everyMs: 20 });
  const sub = await client(box, ["context", "--help"]);
  const whole = await client(box, ["--help"]);
  const asked = await client(box, ["help", "step"]);
  const real = await client(box, ["context"]);
  await server.stop();
  assert.deepEqual([sub.code, whole.code, asked.code, real.code], [0, 0, 0, 0]);
  assert.ok(sub.stdout.includes(usageLine("context")) && whole.stdout.includes(usageLine("step")) && asked.stdout.includes(usageLine("step")));
  const lines = readFileSync(box.dirs.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.sub, l.help === true, l.refused, l.exit]), [["context", true, null, 0], ["--help", true, null, 0], ["step", true, null, 0], ["context", false, null, 0]]);
  assert.deepEqual(s.ran, [["autonomous-qa.mjs", "context", `--investigation=${INV}`]], "only the request that was no probe reached the engine");
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
