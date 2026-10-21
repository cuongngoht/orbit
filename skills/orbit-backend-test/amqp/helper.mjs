#!/usr/bin/env node
// The helper behind the AMQP 0-9-1 reference adapter (adapters.json `amqp.reference`): one
// orbit.helper/v1 request in on stdin, one answer line out (ADR 0035, 0036). Started by the
// engine, never by a person; where it runs -- this machine, a task's isolated worker -- is the
// launcher's decision. What it does is operations.mjs; this file only binds the real world to it
// and makes sure the process never outlives its answer.
import { answerLine, failureLine, parsedRequest, readAll } from "../../../src/capability/helper-protocol.mjs";
import { run } from "./operations.mjs";
import { connect } from "./session.mjs";

const DEPS = { connect, env: process.env, now: () => performance.now(), wall: () => Date.now(), timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t), now: () => Date.now() } };

async function main() {
  const parsed = parsedRequest(await readAll(process.stdin));
  if (!parsed.ok) return said(failureLine("refused", parsed.why));
  const r = await run(parsed.request, DEPS);
  said(r.failure ? failureLine(r.failure.class, r.failure.message, extraOf(r.failure)) : answerLine(r.value));
}

const extraOf = (f) => Object.fromEntries(Object.entries({ operationKey: f.operationKey }).filter(([, v]) => v !== undefined));

// The answer is flushed, and then the process ends: a socket the broker holds open must never keep
// a helper alive after it has answered.
const said = (line) => process.stdout.write(line, () => process.exit(0));

main().catch((e) => said(failureLine("protocol", `the amqp helper failed — ${e?.message ?? e}`)));
