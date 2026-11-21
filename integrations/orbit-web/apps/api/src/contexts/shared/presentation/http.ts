// What every controller of the virtual office shares: the version a change was made against (`If-Match`), and how a
// command's answer that was stored for an idempotency key is sent again with its own status.
import { HttpStatus } from "@nestjs/common";
import { versionOf } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { ApiError } from "../../../common/errors.js";
import type { StoredAnswer } from "../infrastructure/idempotency.js";

// `If-Match: "<version>"` is required on every change of an existing record; without it the change is refused (428).
export function expectedVersion(req: Request): number {
  const v = versionOf(req.headers["if-match"]);
  if (v === null) throw new ApiError(HttpStatus.PRECONDITION_REQUIRED, "if_match_required", 'Send If-Match: "<version>" with the version of the record you read.');
  return v;
}

export function sendStored(res: Response, answer: StoredAnswer): unknown {
  res.status(answer.status);
  return answer.body;
}
