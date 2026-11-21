// IDEMPOTENCY: a command with a side effect names its request once (the Idempotency-Key header). The same key and the
// same request answer the same result; the same key and another request is a conflict. The scope is (account, actor,
// operation, key), the request is compared by the SHA-256 of its canonical JSON, and a record is kept for
// IDEMPOTENCY_TTL_HOURS. A replay still passes the CURRENT authorization (the route's gate) before the stored answer is
// returned.
//
// The key is taken under an advisory lock of its scope, in the transaction of the command, so two requests with one key
// never both run the command: the second waits, then reads the first's answer.
import { Inject, Injectable } from "@nestjs/common";
import { IDEMPOTENCY_TTL_HOURS } from "@orbit-web/contracts";
import { createHash } from "node:crypto";
import { Db, jsonParam } from "../../../infra/db/db.js";
import { conflictWith } from "../domain.js";

export interface StoredAnswer {
  status: number;
  body: unknown;
}

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};

export const requestDigest = (request: unknown): string => createHash("sha256").update(canonical(request)).digest("hex");

export interface IdempotencyScope {
  orbitId: string;
  actor: string;
  operation: string;
  key: string;
}

@Injectable()
export class Idempotency {
  constructor(@Inject(Db) private readonly db: Db) {}

  // Inside the command's transaction: the stored answer of an earlier request with this key (same request), or null
  // when this one is the first. A different request under the same key is refused.
  async begin(scope: IdempotencyScope, request: unknown): Promise<StoredAnswer | null> {
    await this.db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 7))", [`${scope.orbitId}|${scope.actor}|${scope.operation}|${scope.key}`]);
    const row = await this.db.one("SELECT request_digest, status_code, response FROM workforce.idempotency_keys WHERE account_id = $1 AND actor = $2 AND operation = $3 AND key = $4 AND expires_at > now()", [scope.orbitId, scope.actor, scope.operation, scope.key]);
    if (row === null) return null;
    if (String(row.request_digest) !== requestDigest(request)) throw conflictWith("idempotency_conflict", "This Idempotency-Key was already used for a different request. Use a new key for a new request.");
    return { status: Number(row.status_code), body: row.response };
  }

  // Keeps the answer of this request under its key (in the command's transaction, or after a refusal in one of its own).
  async complete(scope: IdempotencyScope, request: unknown, answer: StoredAnswer): Promise<void> {
    const now = Date.now();
    await this.db.query(
      `INSERT INTO workforce.idempotency_keys (account_id, actor, operation, key, request_digest, status_code, response, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (account_id, actor, operation, key) DO UPDATE SET request_digest = excluded.request_digest, status_code = excluded.status_code, response = excluded.response, created_at = excluded.created_at, expires_at = excluded.expires_at`,
      [scope.orbitId, scope.actor, scope.operation, scope.key, requestDigest(request), answer.status, jsonParam(answer.body), new Date(now).toISOString(), new Date(now + IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString()],
    );
  }
}
