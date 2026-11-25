// THE NETWORK LOG OF AN EMPLOYEE'S RUN (workforce.run_connections): every connection the egress proxy decided for an
// assignment's run -- allowed, refused or limited, and why -- and, once an allowed one ended, how many bytes it carried
// each way. The proxy writes an entry as it decides, BEFORE an allowed connection is made (one that cannot be recorded
// is not made); only an employee's runs are kept here, under the account and the run their binding names -- a chat's or a
// research session's connections are decided and recorded as policy decisions, as before. What the owner reads of a
// mission's work (Network), and what a run's summary on the account's chain is worked out from.
import { canonicalJson } from "@orbit-web/governance-core";
import { createHash } from "node:crypto";
import { Db, type Row } from "../db/db.js";
import type { ConnectionReason, ConnectionSink, ConnectionVerdict, EgressRun } from "./proxy.js";

export interface RunConnectionRecord {
  id: number;
  host: string;
  port: number;
  verdict: ConnectionVerdict;
  // `<cause>: <what the agent was told>` for a refusal, `limit: <why>` for a connection a limit cut; null otherwise.
  reason: string | null;
  bytesIn: number;
  bytesOut: number;
  openedAt: string;
  closedAt: string | null;
}

// One run's connections, summed up: what a record on the account's chain names when the run ends.
export interface RunNetworkSummary {
  connections: number;
  allowed: number;
  refused: number;
  limited: number;
  // The hosts it asked for, each once, in order.
  hosts: string[];
  bytesIn: number;
  bytesOut: number;
  // SHA-256 over the whole log as it is now, entry by entry in the order it was written.
  digest: string;
}

const REASON_LENGTH = 500;

const recordOf = (r: Row): RunConnectionRecord => ({
  id: Number(r.id),
  host: String(r.host),
  port: Number(r.port),
  verdict: String(r.verdict) as ConnectionVerdict,
  reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
  bytesIn: Number(r.bytes_in),
  bytesOut: Number(r.bytes_out),
  openedAt: String(r.opened_at),
  closedAt: r.closed_at === null || r.closed_at === undefined ? null : String(r.closed_at),
});

const reasonText = (reason: ConnectionReason | null): string | null => (reason === null ? null : `${reason.cause}: ${reason.message}`.slice(0, REASON_LENGTH));

export class RunConnectionLog implements ConnectionSink {
  constructor(private readonly db: Db) {}

  // An entry of an employee's run (and nothing for another run's). A refused or limited connection is over at once.
  async opened(run: EgressRun, host: string, port: number, verdict: ConnectionVerdict, reason: ConnectionReason | null): Promise<string | null> {
    if (!run.employee) return null;
    const at = new Date().toISOString();
    const row = await this.db.one("INSERT INTO workforce.run_connections (account_id, run_id, host, port, verdict, reason, opened_at, closed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id", [
      run.accountId,
      run.id,
      host,
      port,
      verdict,
      reasonText(reason),
      at,
      verdict === "allowed" ? null : at,
    ]);
    return `${run.accountId}/${String(row?.id)}`;
  }

  // What an allowed connection carried, once it ended; a limit that cut it makes it `limited`, with why.
  async closed(id: string, bytesIn: number, bytesOut: number, cut: string | null): Promise<void> {
    const slash = id.lastIndexOf("/");
    const cutText = cut === null ? null : `limit: ${cut}`.slice(0, REASON_LENGTH);
    await this.db.query(
      "UPDATE workforce.run_connections SET bytes_in = $3, bytes_out = $4, closed_at = $5, verdict = CASE WHEN $6::text IS NULL THEN verdict ELSE 'limited' END, reason = COALESCE($6::text, reason) WHERE account_id = $1 AND id = $2 AND closed_at IS NULL",
      [id.slice(0, slash), Number(id.slice(slash + 1)), bytesIn, bytesOut, new Date().toISOString(), cutText],
    );
  }

  // What the account's employees downloaded through connections opened since `since` (what ended is counted).
  async downloadedSince(accountId: string, since: string): Promise<number> {
    const row = await this.db.one("SELECT COALESCE(sum(bytes_in), 0) AS n FROM workforce.run_connections WHERE account_id = $1 AND opened_at >= $2", [accountId, since]);
    return Number(row?.n ?? 0);
  }

  // One run's log, oldest first (another account's run is never found: every read names the account).
  async list(accountId: string, runId: string, limit = 1000): Promise<RunConnectionRecord[]> {
    return (await this.db.query("SELECT * FROM workforce.run_connections WHERE account_id = $1 AND run_id = $2 ORDER BY id LIMIT $3", [accountId, runId, limit])).map(recordOf);
  }

  async summary(accountId: string, runId: string): Promise<RunNetworkSummary> {
    const log = (await this.db.query("SELECT * FROM workforce.run_connections WHERE account_id = $1 AND run_id = $2 ORDER BY id", [accountId, runId])).map(recordOf);
    const count = (v: ConnectionVerdict): number => log.filter((c) => c.verdict === v).length;
    return {
      connections: log.length,
      allowed: count("allowed"),
      refused: count("refused"),
      limited: count("limited"),
      hosts: [...new Set(log.map((c) => c.host))],
      bytesIn: log.reduce((n, c) => n + c.bytesIn, 0),
      bytesOut: log.reduce((n, c) => n + c.bytesOut, 0),
      digest: createHash("sha256").update(canonicalJson(log)).digest("hex"),
    };
  }
}
