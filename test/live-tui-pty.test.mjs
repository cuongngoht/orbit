// `live tui` in a REAL pseudo-terminal, as a person runs it: Python's pty module stands in for the terminal
// (Node has none). It enters the alternate screen, draws the task, leaves on `q` with exit 0, gives the screen
// back, says on stderr what it left -- and the task's journal is byte for byte what it was. Skipped where no
// POSIX pty exists (Windows) or no python3 is installed; that is said, never counted as a pass elsewhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.platform === "win32" ? null : ["python3"].find((p) => spawnSync(p, ["-c", "import pty"], { encoding: "utf8" }).status === 0) ?? null;

// The terminal: a pty of 100×30, the keys typed after the first frame, everything the viewer wrote, its exit.
const DRIVER = `
import os, pty, sys, time, select, struct, fcntl, termios, json
argv, cwd, keys = json.loads(sys.argv[1]), sys.argv[2], sys.argv[3]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd); os.execv(argv[0], argv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
out = b""
def pump(t):
    global out
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: out += os.read(fd, 65536)
            except OSError: return
deadline = time.time() + 15
while b"ORBIT LIVE" not in out and time.time() < deadline: pump(0.2)
pump(0.5)
if len(sys.argv) > 4:
    import subprocess
    subprocess.run(json.loads(sys.argv[4]), cwd=cwd, check=True, capture_output=True)
    deadline = time.time() + 15
    while sys.argv[5].encode() not in out and time.time() < deadline: pump(0.2)
    pump(0.5)
for k in keys: os.write(fd, k.encode()); pump(0.4)
pump(1.0)
_, st = os.waitpid(pid, 0)
sys.stdout.buffer.write(json.dumps({"exit": os.waitstatus_to_exitcode(st), "out": out.decode("utf8", "replace")}).encode())
`;

test("in a real terminal it enters the alternate screen, leaves on q with exit 0, and the journal is untouched", { skip: python ? false : "no POSIX pty here (Windows, or no python3): NOT TESTED" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-tui-pty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", TERM: "xterm-256color" });
  const task = (...args) => execFileSync(process.execPath, [join(ROOT, "cli", "task.mjs"), ...args], { cwd: repo, env, encoding: "utf8" });
  const id = JSON.parse(task("create", "PBI-482 Refund validation", "--json")).task;
  task("stage", id, "BUILDING");
  const journal = () => readFileSync(join(dir, "store", readFileSync(join(dir, "store", "state", "checkouts", execFileSync("ls", [join(dir, "store", "state", "checkouts")], { encoding: "utf8" }).trim()), "utf8").match(/"key":\s*"([^"]+)"/)[1], "tasks", id, "journal.jsonl"), "utf8");
  const before = journal();
  const got = JSON.parse(execFileSync(python, ["-c", DRIVER, JSON.stringify([process.execPath, join(ROOT, "cli", "live.mjs"), "tui"]), repo, "?xe\u001bq"], { env, encoding: "utf8", timeout: 40_000 }));
  assert.equal(got.exit, 0);
  const plain = got.out.replace(/\u001b\[[0-9;]*m/g, "");
  assert.ok(got.out.startsWith("\u001b[?1049h"), "the alternate screen first");
  assert.match(plain, /STAGE +EXECUTING · BUILDING/);
  assert.match(plain, /KEYS/, "? showed the keys");
  assert.match(plain, /EVIDENCE/, "e showed the evidence");
  assert.match(plain, /[◐◓◑◒] ORBITING/, "the viewer's own state is in the header at this width too");
  const left = got.out.lastIndexOf("\u001b[?1049l");
  assert.ok(left > 0 && got.out.lastIndexOf("\u001b[?25h") < left && got.out.lastIndexOf("\u001b[?7h") < left, "colour, wrap and cursor restored, then the screen given back");
  assert.match(got.out.slice(left), new RegExp(`live: detached — ${id} EXECUTING BUILDING .*the task itself is untouched`));
  assert.equal(journal(), before, "not one byte of the journal changed");
});

test("opened FIRST, in a repository Orbit never wrote for, it shows the task started there afterwards", { skip: python ? false : "no POSIX pty here (Windows, or no python3): NOT TESTED" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-tui-pty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", TERM: "xterm-256color" });
  const started = JSON.stringify([process.execPath, join(ROOT, "cli", "task.mjs"), "create", "PBI-482 Refund validation, started after the viewer opened"]);
  const got = JSON.parse(execFileSync(python, ["-c", DRIVER, JSON.stringify([process.execPath, join(ROOT, "cli", "live.mjs"), "tui"]), repo, "q", started, "PBI-482"], { env, encoding: "utf8", timeout: 60_000 }));
  const plain = got.out.replace(/\u001b\[[0-9;]*m/g, "");
  assert.equal(got.exit, 0);
  assert.match(plain, /not a Orbit checkout yet/);
  assert.match(plain, /STAGE +QUEUED/, "the task started in the repository is shown without a key");
});

// 1.8.5 (ADR 0020): the viewer /orbit-help opens holds this session's LEASE. In a real terminal it says it is READY
// once it has drawn (with its pid and when that pid started), it waits for the session's task instead of opening
// the picker, and q records that a person LEFT it -- so a workflow's own ask never brings it back.
import { hostname } from "node:os";
import { safeName } from "../src/project/paths.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { launching, leaseWhere, readLease, updateLease } from "../src/live/lease.mjs";

test("a leased viewer says it is ready, waits for the session's task, and records the detach on q", { skip: python ? false : "no POSIX pty here (Windows, or no python3): NOT TESTED" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-tui-pty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", TERM: "xterm-256color" });
  const where = leaseWhere(stateRooms(storeBase(env)).live, safeName(hostname()), "0123456789abcdef");
  const owner = "fedcba9876543210";
  updateLease(realIo(), where, (current) => launching(current, { key: where.key, host: "claude", session: "1111222233334444", checkout: "c".repeat(64), machine: safeName(hostname()), owner, at: new Date().toISOString(), entry: "help" }));
  const got = JSON.parse(execFileSync(python, ["-c", DRIVER, JSON.stringify([process.execPath, join(ROOT, "cli", "live.mjs"), "tui", `--lease=${where.key}.${owner}`]), repo, "q"], { env, encoding: "utf8", timeout: 40_000 }));
  const plain = got.out.replace(/\u001b\[[0-9;]*m/g, "");
  assert.equal(got.exit, 0);
  assert.match(plain, /waiting for this session's task/, "no picker forced on a viewer opened for a session");
  const lease = readLease(realIo(), where);
  assert.equal(lease.owner, owner);
  assert.ok(lease.readyAt, "it said it was ready");
  assert.ok(Number.isInteger(lease.pid) && lease.pid > 1, "with its own pid");
  assert.equal(lease.state, "detached");
  assert.equal(lease.detachedWhy, "detached", "q is a person leaving it");
});
