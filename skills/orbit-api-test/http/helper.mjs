#!/usr/bin/env node
// The helper behind orbit.http.read and orbit.http.write: one orbit.helper/v1 request in on
// stdin, one answer line out (ADR 0036). Started by the engine, never by a person; where it
// runs -- this machine, a task's isolated worker -- is the launcher's decision.
//
// `read` sends only GET, HEAD and OPTIONS; `write` only POST, PUT, PATCH and DELETE, and is
// what a test grant covers (ADR 0037). The credential, when an identity is bound, is read from
// this process's environment under the name the binding gave; it is never in the request.
import { answerLine, failureLine, parsedRequest, readAll } from "../../../src/capability/helper-protocol.mjs";
import { exchange } from "./exchange.mjs";

const METHODS = { read: ["GET", "HEAD", "OPTIONS"], write: ["POST", "PUT", "PATCH", "DELETE"] };

async function main() {
  const parsed = parsedRequest(await readAll(process.stdin));
  if (!parsed.ok) return void process.stdout.write(failureLine("refused", parsed.why));
  const r = await answered(parsed.request);
  process.stdout.write(r.failure ? failureLine(r.failure.class, r.failure.message, extraOf(r.failure)) : answerLine(r.value));
}

function answered(asked) {
  const method = String(asked.request.method ?? "").toUpperCase();
  if (!(METHODS[asked.op] ?? []).includes(method)) return { failure: { class: "refused", message: `${asked.op} does not send ${method || "no method"} — read sends ${METHODS.read.join(", ")}, write ${METHODS.write.join(", ")}` } };
  return exchange(asked, { fetch, now: () => performance.now(), env: process.env });
}

const extraOf = (f) => Object.fromEntries(Object.entries({ gap: f.gap, operationKey: f.operationKey }).filter(([, v]) => v !== undefined));

main().catch((e) => process.stdout.write(failureLine("protocol", `the http helper failed — ${e?.message ?? e}`)));
