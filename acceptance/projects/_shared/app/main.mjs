// The one entrypoint.
//
//   node app/main.mjs [all]       migrate, then supervise every role in INVOICE_ROLES (the image's
//                                 default command: one container runs the whole application)
//   node app/main.mjs <role>      run one role in this process: api, sink, scheduler, relay,
//                                 worker or hooks (hooks only with ORBIT_TEST_HOOKS=on)
//   node app/main.mjs migrate     bring the schema up to date and exit
//   node app/main.mjs health      exit 0 when everything that should run, runs
import { pathToFileURL } from "node:url";
import { WORKLOADS, config, log } from "./config.mjs";
import { createDb, lit } from "./db.mjs";
import { hooksRefusal } from "./hooks.mjs";
import { migrate } from "./migrate.mjs";
import { onStop } from "./role.mjs";
import { loadSchedule } from "./schedule.mjs";
import { sinkRefusal } from "./sink.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const dbFor = (role) => createDb({ ...config.db, application: `invoice-${role}` });

// The transport is the stack's (transport.mjs beside app/), so nothing in app/ names a broker.
// A broker that is still starting is waited for; one that goes away ends the role, and its
// supervisor starts it again.
async function openTransport(role) {
  const mod = await import(pathToFileURL(config.transport).href);
  const deadline = Date.now() + 120000;
  for (;;) {
    try {
      const transport = await mod.open({ role, log });
      transport.ended.then((why) => {
        log(role, `the broker connection ended (${why ?? "closed"}); exiting`);
        process.exit(1);
      });
      return transport;
    } catch (e) {
      if (Date.now() >= deadline) throw e;
      log(role, `the broker is not reachable yet (${e.message}); retrying`);
      await pause(1000);
    }
  }
}

const ROLES = {
  api: async (db) => (await import("./api.mjs")).runApi(db),
  sink: async (db) => (await import("./sink.mjs")).runSink(db),
  scheduler: async (db) => (await import("./scheduler.mjs")).runScheduler(db),
  hooks: async (db) => (await import("./hooks.mjs")).runHooks(db),
  relay: async (db) => {
    const transport = await openTransport("relay");
    onStop(() => transport.close());
    return (await import("./relay.mjs")).runRelay(db, transport);
  },
  worker: async (db) => {
    const refused = sinkRefusal();
    if (refused) throw new Error(`the worker refuses to start: it notifies the sink, and ${refused.replace(/^the sink refuses to start: /, "")}`);
    const transport = await openTransport("worker");
    const consumer = await (await import("./worker.mjs")).runWorker(db, transport, loadSchedule(config.scheduleFile));
    onStop(async () => {
      await consumer.stop();
      await transport.close();
    });
  },
};

async function runRole(role) {
  const db = dbFor(role);
  onStop(() => db.close());
  await ROLES[role](db);
}

// What this application will not start without: the sink's secret (the worker needs it too), and
// -- when the test hooks are switched on -- the hooks' own secret.
const refusals = () => [sinkRefusal(), config.testHooks ? hooksRefusal() : null].filter(Boolean);

async function all() {
  const refused = refusals();
  if (refused.length) {
    for (const why of refused) log("supervisor", why);
    process.exit(2);
  }
  const db = dbFor("supervisor");
  await migrate(db);
  const roles = config.roles.filter((r) => r !== "hooks" || config.testHooks);
  const here = `ARRAY[${roles.map((r) => lit(r)).join(", ")}]::text[]`;
  await db.query(`UPDATE controls SET desired = 'running', actual = 'stopped', reason = NULL, updated_at = now() WHERE workload = ANY (${here});
    UPDATE controls SET desired = 'stopped', actual = 'stopped', reason = 'not run here', updated_at = now() WHERE NOT (workload = ANY (${here}));
    UPDATE faults SET armed = FALSE;`);
  const { supervise } = await import("./supervisor.mjs");
  const running = roles.map((r) => supervise(db, r));
  log("supervisor", `supervising ${roles.join(", ")}`);
  onStop(async () => {
    await Promise.all(running.map((s) => s.end()));
    await db.close();
  });
}

async function health() {
  try {
    const r = await fetch(`http://127.0.0.1:${config.ports.api}/health?all=1`, { signal: AbortSignal.timeout(3000) });
    process.exit(r.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

async function migrateOnly() {
  const db = dbFor("migrate");
  await migrate(db);
  await db.close();
}

const command = process.argv[2] ?? "all";
const COMMANDS = { all, health, migrate: migrateOnly };

if (COMMANDS[command]) await COMMANDS[command]();
else if (WORKLOADS.includes(command)) await runRole(command);
else {
  console.error(`usage: node app/main.mjs [all | migrate | health | ${WORKLOADS.join(" | ")}]`);
  process.exit(2);
}
