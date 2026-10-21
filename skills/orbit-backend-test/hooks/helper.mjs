#!/usr/bin/env node
// The helper behind the test-hook reference adapters (adapters.json `scheduler.hooks`,
// `clock.hooks`, `workload.hooks`, `worker.hooks`): one orbit.helper/v1 request in on stdin, one
// answer line out (ADR 0035, 0036). What it does is operations.mjs; this file binds the real
// fetch and clocks to it and makes sure the process never outlives its answer.
import { answerLine, failureLine, parsedRequest, readAll } from "../../../src/capability/helper-protocol.mjs";
import { run } from "./operations.mjs";

const DEPS = { fetch: (url, opts) => fetch(url, opts), env: process.env, now: () => performance.now(), timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) } };

async function main() {
  const parsed = parsedRequest(await readAll(process.stdin));
  if (!parsed.ok) return said(failureLine("refused", parsed.why));
  const r = await run(parsed.request, DEPS);
  said(r.failure ? failureLine(r.failure.class, r.failure.message, extraOf(r.failure)) : answerLine(r.value));
}

const extraOf = (f) => Object.fromEntries(Object.entries({ operationKey: f.operationKey, gap: f.gap }).filter(([, v]) => v !== undefined));

const said = (line) => process.stdout.write(line, () => process.exit(0));

main().catch((e) => said(failureLine("protocol", `the hooks helper failed — ${e?.message ?? e}`)));
