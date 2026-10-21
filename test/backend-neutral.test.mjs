// The backend verification engine knows no product (ADR 0033, 0035; AGENTS.md): every module
// 0.1.0 adds under src/ -- the graph's roles, the adapter contract, the obligations, the
// generation, the isolation and the verification -- names no broker, scheduler, database,
// vendor, standard or example project, in code or in strings. Those are adapter, pack, catalog
// or project data. `docker` is the isolation provider src/runtime already designs and is not
// on the list; neither are the protocol words HTTP and JSON.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Directories are walked; single files are read when they exist. A module added under a
// listed directory is covered the day it is written.
const SCOPE = [
  "src/walk.mjs",
  "src/topology",
  "src/adapters",
  "src/qa/obligations",
  "src/qa/backend",
  "src/qa/generation",
  "src/qa/security",
  "src/qa/rules/expects.mjs",
  "src/runtime/isolation",
  "src/capability/helper.mjs",
  "src/run/evaluator.mjs",
  "src/run/envelope.mjs",
  "src/extensions/packs.mjs",
  "src/investigation/verification.mjs",
  "src/investigation/assessments.mjs",
  "src/report/assessment.mjs",
];

const PRODUCTS = /\b(rabbit(mq)?|amqp|kafka|confluent|nats|jetstream|redis|sqs|sns|kinesis|pub\/?sub|event ?hubs?|service ?bus|servicebus|azure|aws|gcp|google|postgres(ql)?|psql|mysql|mariadb|mssql|sql ?server|sqlite|mongo(db)?|cassandra|dynamo(db)?|hangfire|quartz|cronjob|kubernetes|k8s|celery|sidekiq|bullmq|temporal\.io|camunda|masstransit|nservicebus|asvs|owasp|top ?10|invoice|billing|tenant-a|canary-invoice)\b/i;

const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).flatMap((n) => walk(join(p, n))) : [p]);
const files = SCOPE.map((s) => join(ROOT, s)).filter(existsSync).flatMap(walk).filter((p) => p.endsWith(".mjs"));
const code = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("the 0.1.0 modules exist to be held to this", () => {
  assert.ok(files.length >= 10, `scanned ${files.length} files`);
});

test("no new module under src/ names a product, a standard or the example project -- in code or in strings", () => {
  const hits = files.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => PRODUCTS.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 100)}`));
  assert.deepEqual(hits, []);
});

// The graph's roles import nothing but leaves; the adapter contract sits just above the capability
// pipeline it shares a helper shape with (src/capability/helper.mjs), and imports nothing above it.
test("the graph's roles and the adapter families import nothing above them", () => {
  const leaves = files.filter((p) => /src[\\/](topology|adapters)[\\/]/.test(p));
  const bad = leaves.flatMap((p) => [...code(p).matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]).filter((t) => !/^\.\/|^\.\.\/(constraints|walk|catalog|hash|errors)\.mjs$|^\.\.\/topology\/|^\.\.\/capability\/helper\.mjs$/.test(t)).map((t) => `${relative(ROOT, p)} imports ${t}`));
  assert.deepEqual(bad, []);
});
