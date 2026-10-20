// A live console reads a sandbox's log from a byte offset: only the lines it has not shown, whole lines, bounded -- and
// masked exactly as the last-lines read masks the whole log, because each read masks the whole log and shows a slice of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_SHOWN, logsOf, MAX_FOLLOW } from "../src/runtime/sandbox/view.mjs";
import { scrub } from "../src/scrub.mjs";
import { LOG_BYTES } from "../src/runtime/sandbox/vocab.mjs";
import { prepared, sandboxWorld, TASK } from "./sandbox.harness.mjs";

async function started() {
  const w = sandboxWorld(undefined, { env: { PATH: "/usr/bin" } });
  await prepared(w);
  const session = (await w.run("sandbox-start", TASK, ["--wait=0"])).started[0].session;
  return { w, session, path: w.sandbox().sessions.logs(session).out, logs: (args) => w.run("sandbox-logs", TASK, [`--session=${session}`, ...args]) };
}

test("from an offset, a log answers its lines up to the last ended one, and `next` is where the next read starts", async () => {
  const s = await started();
  s.w.io.write(s.path, "one\ntwo\nthr");
  const first = await s.logs(["--from=0"]);
  assert.deepEqual([first.lines, first.from, first.next, first.truncated], [["one", "two"], 0, 8, true]);
  s.w.io.write(s.path, "one\ntwo\nthree\nfour\n");
  const second = await s.logs([`--from=${first.next}`]);
  assert.deepEqual([second.lines, second.next, second.size, second.truncated], [["three", "four"], 19, 19, false]);
  const none = await s.logs([`--from=${second.next}`]);
  assert.deepEqual([none.lines, none.next, none.bytes], [[], 19, 0]);
});

test("a read is bounded by LOG_BYTES, a line longer than the bound is read whole and shown cut after masking, and an offset past the end is a reset", async () => {
  const s = await started();
  s.w.io.write(s.path, `${"y".repeat(LOG_BYTES + 100)}\nafter\n`);
  const first = await s.logs(["--from=0"]);
  assert.deepEqual([first.lines.length, first.next, first.truncated], [1, LOG_BYTES + 101, true]);
  assert.match(first.lines[0], /more characters not shown\]$/);
  assert.equal(first.lines[0].indexOf(" … ["), LINE_SHOWN);
  assert.deepEqual((await s.logs([`--from=${first.next}`])).lines, ["after"]);
  const reset = await s.logs(["--from=999999"]);
  assert.deepEqual([reset.reset, reset.from, reset.next, reset.lines], [true, 0, 0, []]);
});

// Each case below separates a secret's name from its value, or cuts a match, where a read boundary falls -- and is masked
// as the whole-log read masks it. The last three were found by an adversarial search against an earlier design.
async function readInTwo(s, head, tail) {
  s.w.io.write(s.path, head);
  const first = await s.logs(["--from=0"]);
  s.w.io.write(s.path, `${head}${tail}`);
  const second = await s.logs([`--from=${first.next}`]);
  return { first, shown: [...first.lines, ...second.lines].join("\n"), whole: (await s.logs(["--tail=200"])).lines.join("\n") };
}

test("a name and its value lines apart are masked, however many blank lines lie between", async () => {
  const s = await started();
  const near = await readInTwo(s, "booting\npassword:\n", "  hunter2-near\nready\n");
  assert.deepEqual(near.first.lines, ["booting", "password:"]);
  assert.ok(!near.shown.includes("hunter2") && !near.whole.includes("hunter2"));
  const far = await readInTwo(s, `password:${"\n".repeat(70_000)}`, "  hunter2-far\nready\n");
  assert.ok(!far.shown.includes("hunter2") && !far.whole.includes("hunter2"));
});

test("a token on a line longer than the bound is masked before the line is cut", async () => {
  const s = await started();
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(40)}.${"b".repeat(40)}`;
  s.w.io.write(s.path, `${"z".repeat(LOG_BYTES - 20)}${jwt}\npassword:\n hunter2-after-long\nnext\n`);
  const shown = [];
  for (let from = 0, i = 0; i < 4; i += 1) {
    const got = await s.logs([`--from=${from}`]);
    shown.push(...got.lines);
    from = got.next;
  }
  assert.ok(!shown.join("\n").match(/eyJhbGci|hunter2/), shown.join(" | ").slice(-200));
  assert.equal(shown.at(-1), "next");
});

test("a cursor inside a line goes on from the next line; one inside the unfinished last line waits", async () => {
  const s = await started();
  s.w.io.write(s.path, "alpha\nbravo\ncharlie\ndel");
  assert.deepEqual((await s.logs(["--from=2"])).lines, ["bravo", "charlie"]);
  const waiting = await s.logs(["--from=21"]);
  assert.deepEqual([waiting.lines, waiting.next], [[], 21]);
});

test("a quoted value that spans lines is masked whole; one still open is held back until it closes", async () => {
  const s = await started();
  s.w.io.write(s.path, 'starting\npassword: "my secret phrase\n');
  const first = await s.logs(["--from=0"]);
  assert.deepEqual([first.lines, first.next, first.held], [["starting"], "starting\n".length, true]);
  s.w.io.write(s.path, 'starting\npassword: "my secret phrase\nand more of it"\nready\n');
  const second = await s.logs([`--from=${first.next}`]);
  assert.ok(!second.lines.join("\n").match(/secret phrase|more of it/), second.lines.join(" | "));
  assert.deepEqual([second.lines.at(-1), second.held], ["ready", false]);
});

test("a closing quote that opens another value pairs as the mask pairs it: no word of the first value is shown", async () => {
  const s = await started();
  s.w.io.write(s.path, 'password: "correct horse battery staple\ntoken: "abc\n');
  const got = await s.logs(["--from=0"]);
  assert.ok(!got.lines.join("\n").match(/horse|battery|staple/), got.lines.join(" | "));
});

test("a value open for more than one read is never shown in pieces, and nothing after it is shown bare", async () => {
  const s = await started();
  const filler = Array.from({ length: 4500 }, (_, i) => `filler-${String(i).padStart(5, "0")} LEAKVALUE${i}`).join("\n");
  const got = await readInTwo(s, `password: "start\n${filler}\n`, 'end"\nready\n');
  assert.ok(!got.whole.includes("LEAKVALUE"));
  assert.ok(!got.shown.includes("LEAKVALUE"), got.shown.slice(0, 200));
});

test("whitespace the byte-level blank test would not see, however long, still joins a name to its value", async () => {
  const s = await started();
  const got = await readInTwo(s, `password:${"\u00a0\n".repeat(33_000)}`, "  hunter2-unicode\nready\n");
  assert.ok(!got.whole.includes("hunter2"));
  assert.ok(!got.shown.includes("hunter2"));
});

test("a log larger than MAX_FOLLOW is refused for live following, and its last lines stay readable", async () => {
  const s = await started();
  s.w.io.write(s.path, `${"x".repeat(MAX_FOLLOW)}\nlast line\n`);
  await assert.rejects(async () => s.logs(["--from=0"]), (e) => e.code === "LOG_TOO_LARGE");
  assert.ok((await s.logs(["--tail=2"])).lines.includes("last line"));
});

test("every line read from an offset is placed and scrubbed as the last-lines read is", async () => {
  const s = await started();
  const workspace = s.w.workspaces.tasks.get(TASK).path;
  s.w.io.write(s.path, `listening in ${workspace}/web\nTOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789ab\n`);
  const got = await s.logs(["--from=0"]);
  assert.match(got.lines[0], /listening in <workspace>\/web/);
  assert.ok(!got.lines.join("\n").includes("ghp_abc"));
  assert.ok(!JSON.stringify(got).includes(workspace), "no path of this machine");
});

test("from is a whole number or refused; without it, the last-lines answer is what it was", async () => {
  const s = await started();
  await assert.rejects(async () => s.logs(["--from=-1"]), /byte offset/);
  await assert.rejects(async () => s.logs(["--from=../x"]), /byte offset/);
  s.w.io.write(s.path, "a\nb\n");
  assert.deepEqual(Object.keys(await s.logs(["--tail=5"])).sort(), ["bytes", "lines", "session", "stream", "truncated"]);
  await assert.rejects(async () => s.w.run("sandbox-logs", TASK, ["--session=rs-ffffffffffff", "--from=0"]), (e) => e.code === "SESSION_UNKNOWN");
});

// A seeded generator of logs that put secrets where read boundaries fall: names and values lines and blank runs apart,
// quoted values across lines, long lines, tokens. Each log is written in random chunks and read after every chunk; a value
// the whole-log read masks must never appear in what the pieces showed.
function prng(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function generatedLog(rand) {
  const parts = [];
  const secrets = [];
  for (let i = 0; i < 12; i += 1) {
    const secret = `s3cr3t${i}x${Math.floor(rand() * 1e6)}`;
    const shapes = [
      () => `password:${"\n".repeat(1 + Math.floor(rand() * 5))}  ${secret}\n`,
      () => `token = ${secret}\n`,
      () => `password: "${secret} with words\nand ${secret}more"\n`,
      () => `api-key: '${secret} open\ntoken: "x\n`,
      () => `Authorization: Bearer\n${secret}\n`,
      () => `${"w".repeat(Math.floor(rand() * 3) * 40000)} pwd:\n ${secret}\n`,
      () => `plain line ${i}\n`,
    ];
    const pick = Math.floor(rand() * shapes.length);
    parts.push(shapes[pick]());
    if (pick < 6) secrets.push(secret);
  }
  return { text: parts.join(""), secrets };
}

test("whatever the read boundaries, a value the whole-log read masks never reaches a page from the pieces", async () => {
  const s = await started();
  // The reader itself, on the sandbox's own context: the command around it is held by the tests above.
  const ctx = s.w.sandbox();
  const read = (opts) => logsOf(ctx, s.session, opts);
  const rand = prng(20261008);
  for (let round = 0; round < 20; round += 1) {
    const log = generatedLog(rand);
    const shown = [];
    let written = 0;
    let from = 0;
    while (written < log.text.length) {
      written = Math.min(log.text.length, written + 1 + Math.floor(rand() * 24000));
      s.w.io.write(s.path, log.text.slice(0, written));
      const got = read({ from });
      shown.push(...got.lines);
      from = got.reset ? 0 : got.next;
    }
    for (let i = 0; i < 3; i += 1) {
      const got = read({ from });
      shown.push(...got.lines);
      from = got.next;
    }
    // The whole log as the whole-log read masks it -- all of it: the last-lines read shows only its last LOG_BYTES.
    const whole = scrub(log.text);
    const pieces = shown.join("\n");
    for (const secret of log.secrets.filter((x) => !whole.includes(x))) assert.ok(!pieces.includes(secret), `round ${round}: ${secret} leaked`);
  }
});
