// THE TOOL DOOR answers a refusal as the tool's answer, in the refusal's own words -- the sandbox's too: an employee
// reading a path its tool plane will not open reads WHY, and can correct itself (never an HTTP error it cannot read).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import type { PrincipalResolver } from "../../../modules/auth/principals.js";
import type { ToolsService } from "../application/tools.service.js";
import { AllocatorError } from "../infrastructure/sandbox/allocator-protocol.js";
import { SandboxInputError } from "../infrastructure/sandbox/ids.js";
import { ToolsController } from "./tools.controller.js";

const principals = { context: () => ({ correlationId: "c", accountId: "a", principal: { kind: "agent", binding: { kind: "assignment", runId: "run-1" } } }) } as unknown as PrincipalResolver;
const door = (failure: unknown) => {
  const c = new ToolsController(principals, { call: () => Promise.reject(failure) } as unknown as ToolsService);
  (c as unknown as { logger: { warn: () => void } }).logger = { warn: () => undefined };
  return c;
};
const req = {} as Request;

test("a sandbox's refusal is the tool's answer, in its own words", async () => {
  assert.deepEqual(await door(new AllocatorError("bad_request", "reading /input/x: path must be inside /work")).call(req, { name: "read_file", arguments: { path: "/input/x" } }), { text: "reading /input/x: path must be inside /work", isError: true });
  assert.deepEqual(await door(new SandboxInputError("/input is read-only: it holds what was handed to you")).call(req, { name: "write_file", arguments: {} }), { text: "/input is read-only: it holds what was handed to you", isError: true });
  assert.deepEqual(await door(new AllocatorError("file_too_large", "the file is larger than allowed (900000 bytes)")).call(req, { name: "read_file", arguments: {} }), { text: "the file is larger than allowed (900000 bytes)", isError: true });
});

test("what is not a refusal is still the server's error", async () => {
  await assert.rejects(door(new Error("a bug")).call(req, { name: "read_file", arguments: {} }), /a bug/);
});
