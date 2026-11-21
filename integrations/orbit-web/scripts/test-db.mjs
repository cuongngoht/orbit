#!/usr/bin/env node
// THE TESTS' POSTGRESQL: the same pinned pgvector image Orbit Web runs on, started in Docker on a port of this machine
// only, for the API's tests -- each test creates (and drops) a database of its own on it. Nothing else uses it.
//
//   node scripts/test-db.mjs start   # starts it (or finds it running) and prints the line to export
//   node scripts/test-db.mjs url     # prints the URL of the one running, or exits 1
//   node scripts/test-db.mjs stop
//
// The role is the server's superuser on purpose: a test creates databases and enables pgvector in each. Orbit Web's
// own role in a deployment is never one (docker/postgres/init/10-orbit.sh).
import { spawnSync } from "node:child_process";

export const TEST_DB_IMAGE = "pgvector/pgvector:0.8.1-pg17-trixie@sha256:137f044b0efe3d57f39b972b9b53641b1f2045b99d879e298bbf514a25787dcf";
const NAME = "orbit-web-test-db";
const USER = "orbit";
const PASSWORD = "orbit-test";

const docker = (args) => spawnSync("docker", args, { encoding: "utf8" });

const urlOf = (port) => `postgres://${USER}:${PASSWORD}@127.0.0.1:${port}/${USER}`;

function runningPort() {
  const r = docker(["port", NAME, "5432/tcp"]);
  if (r.status !== 0) return null;
  const m = /:(\d+)\s*$/m.exec(r.stdout.trim());
  return m ? Number(m[1]) : null;
}

function ready() {
  return docker(["exec", NAME, "pg_isready", "-h", "127.0.0.1", "-U", USER, "-d", USER, "-q"]).status === 0;
}

export async function startTestDb() {
  let port = runningPort();
  if (port === null) {
    docker(["rm", "-f", NAME]);
    const run = docker(["run", "-d", "--name", NAME, "-p", "127.0.0.1::5432", "-e", `POSTGRES_USER=${USER}`, "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-e", `POSTGRES_DB=${USER}`, "--tmpfs", "/var/lib/postgresql/data", TEST_DB_IMAGE]);
    if (run.status !== 0) throw new Error(`docker run failed: ${(run.stderr || run.stdout).trim()}`);
    port = runningPort();
  }
  for (let i = 0; i < 120 && !ready(); i += 1) await new Promise((r) => setTimeout(r, 500));
  if (!ready() || port === null) throw new Error("the test database did not become ready");
  // The server answers only once its init is done; one more look so the first connection never meets a restart.
  await new Promise((r) => setTimeout(r, 500));
  return urlOf(port);
}

async function main() {
  const command = process.argv[2] ?? "start";
  if (command === "start") {
    const url = await startTestDb();
    process.stdout.write(`export ORBIT_WEB_TEST_DATABASE_URL=${url}\n`);
    return 0;
  }
  if (command === "url") {
    const port = runningPort();
    if (port === null) return 1;
    process.stdout.write(`${urlOf(port)}\n`);
    return 0;
  }
  if (command === "stop") {
    docker(["rm", "-f", NAME]);
    return 0;
  }
  process.stderr.write("usage: test-db.mjs start | url | stop\n");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`test-db: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
