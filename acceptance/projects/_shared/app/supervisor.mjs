// The in-container supervisor: one per workload, each running its role as a child process and
// holding it to `controls.desired`. A test changes `desired` (stop, start) or bumps
// `restart_gen` (restart) through the control hook; the supervisor does the rest and records what
// actually is. A child that exits at an armed FAULT POINT stays down -- desired becomes stopped --
// until a test starts or restarts it, so what a crash left behind can be looked at first. Any
// other unexpected exit is restarted after a backoff, as a process manager would.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { APP_DIR, CONTROLLABLE, FAULT_EXIT, log } from "./config.mjs";
import { sql } from "./db.mjs";

const TICK_MS = 250;
const KILL_AFTER_MS = 5000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export function supervise(db, workload) {
  const controllable = CONTROLLABLE.includes(workload);
  const st = { child: null, exited: null, seenGen: null, failures: 0, notBefore: 0, stopping: false, ending: false };

  const actual = (state, extra = "") => db.query(`UPDATE controls SET actual = ${sql`${state}`}${extra}, updated_at = now() WHERE workload = ${sql`${workload}`}`).catch(() => {});

  // `starting` is recorded BEFORE the child exists, so the child's own `running` always lands last.
  async function start() {
    await actual("starting");
    const child = spawn(process.execPath, [join(APP_DIR, "main.mjs"), workload], { stdio: ["ignore", "inherit", "inherit"], env: process.env });
    st.child = child;
    st.exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    st.exited.then((how) => exited(child, how));
    log("supervisor", `started ${workload} (pid ${child.pid})`);
  }

  async function exited(child, how) {
    if (st.child === child) st.child = null;
    if (st.stopping || st.ending) return;
    if (how.code === FAULT_EXIT) {
      log("supervisor", `${workload} exited at a fault point; it stays down until started`);
      return db.query(sql`UPDATE controls SET desired = 'stopped', actual = 'stopped', reason = 'fault', updated_at = now() WHERE workload = ${workload}`).catch(() => {});
    }
    st.failures += 1;
    st.notBefore = Date.now() + Math.min(5000, 250 * 2 ** st.failures);
    log("supervisor", `${workload} exited (${how.signal ?? how.code}); restarting`);
    return actual("restarting", sql`, restarts = restarts + 1, reason = ${`exit ${how.signal ?? how.code}`}`);
  }

  async function stop(state) {
    const child = st.child;
    if (!child) return;
    st.stopping = true;
    await actual(state);
    child.kill("SIGTERM");
    const killer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
    await st.exited;
    clearTimeout(killer);
    st.stopping = false;
    st.failures = 0;
    await actual("stopped");
  }

  async function tick() {
    const row = (await db.query(sql`SELECT desired, restart_gen FROM controls WHERE workload = ${workload}`)).rows[0];
    if (!row) return;
    if (st.seenGen === null) st.seenGen = row.restart_gen;
    const desired = controllable ? row.desired : "running";
    if (row.restart_gen !== st.seenGen) {
      st.seenGen = row.restart_gen;
      st.failures = 0;
      st.notBefore = 0;
      await stop("restarting");
    }
    if (desired === "stopped" && st.child) await stop("stopping");
    if (desired === "running" && !st.child && Date.now() >= st.notBefore) await start();
  }

  async function loop() {
    while (!st.ending) {
      await tick().catch((e) => log("supervisor", `${workload}: ${e.message}`));
      await pause(TICK_MS);
    }
  }

  async function end() {
    st.ending = true;
    if (!st.child) return;
    st.child.kill("SIGTERM");
    const killer = setTimeout(() => st.child?.kill("SIGKILL"), KILL_AFTER_MS);
    await st.exited;
    clearTimeout(killer);
  }

  loop();
  return { end };
}
