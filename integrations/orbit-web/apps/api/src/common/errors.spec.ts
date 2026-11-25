// THE ONE SHAPE OF AN ERROR, and the words it keeps: a body the JSON reader refused is told by the type it names; what
// the sandbox refused on purpose keeps its own status and words; nothing else is relabelled because it carries a status
// (a sandbox's refusal once reached an employee as "The request body is not valid JSON").
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArgumentsHost } from "@nestjs/common";
import { AllocatorError } from "../contexts/execution/infrastructure/sandbox/allocator-protocol.js";
import { SandboxInputError } from "../contexts/execution/infrastructure/sandbox/ids.js";
import { ApiExceptionFilter } from "./errors.js";

function answer(exception: unknown): { status: number; body: { error: { code: string; message: string } } } {
  const out = { status: 0, body: { error: { code: "", message: "" } } };
  const res = {
    headersSent: false,
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: typeof out.body) {
      out.body = body;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  const filter = new ApiExceptionFilter();
  (filter as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
  filter.catch(exception, host);
  return out;
}

const bodyParser = (type: string, status: number) => Object.assign(new Error("raw words"), { type, status, expose: true });

test("a body the JSON reader refused is told by the type it names", () => {
  assert.deepEqual([answer(bodyParser("entity.parse.failed", 400)).status, answer(bodyParser("entity.parse.failed", 400)).body.error.message], [400, "The request body is not valid JSON."]);
  assert.deepEqual([answer(bodyParser("entity.too.large", 413)).status, answer(bodyParser("entity.too.large", 413)).body.error.message], [413, "The request body is too large."]);
  assert.match(answer(bodyParser("request.size.invalid", 400)).body.error.message, /Content-Length/);
  assert.equal(answer(bodyParser("charset.unsupported", 415)).status, 415);
});

test("an error that only carries a status is never called invalid JSON", () => {
  const a = answer(Object.assign(new Error("something else entirely"), { status: 400 }));
  assert.equal(a.status, 500);
  assert.doesNotMatch(a.body.error.message, /JSON/);
});

test("what the sandbox refused on purpose keeps its status and its own words; what failed inside it does not leak", () => {
  const refused = answer(new AllocatorError("bad_request", "reading /input/x: /input is read-only"));
  assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.message], [400, "bad_request", "reading /input/x: /input is read-only"]);
  assert.deepEqual([answer(new AllocatorError("not_found", "/work/x does not exist")).status, answer(new AllocatorError("file_too_large", "too large")).status], [404, 413]);
  assert.deepEqual([answer(new SandboxInputError("path must be inside /work")).status, answer(new SandboxInputError("path must be inside /work")).body.error.message], [400, "path must be inside /work"]);
  const inside = answer(new AllocatorError("internal", "exec failed: secret detail"));
  assert.equal(inside.status, 500);
  assert.doesNotMatch(inside.body.error.message, /secret detail/);
});
