// Brings the database to this build's schema, idempotently, under an advisory lock so that two
// roles starting together cannot race each other's CREATE.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, WORKLOADS, config, log } from "./config.mjs";
import { sql } from "./db.mjs";

const LOCK = 4242001;

// The guard against a second reminder for one business key. The no-dedupe variant has none at
// all, so the index is dropped there rather than merely left out.
const guard = (variant) => (variant === "no-dedupe" ? "DROP INDEX IF EXISTS reminders_business_key;" : "CREATE UNIQUE INDEX IF NOT EXISTS reminders_business_key ON reminders (business_key);");

function clockRow() {
  const injected = config.clockInjection === "live";
  const start = injected ? Date.parse(config.clockStart) : null;
  if (injected && !Number.isFinite(start)) throw new Error("CLOCK_START is not an ISO 8601 instant");
  const mode = injected ? "injected" : "real";
  return sql`INSERT INTO clock_state (id, mode, now_ms, evaluated_through_ms) VALUES (1, ${mode}, ${start}, ${start})
    ON CONFLICT (id) DO UPDATE SET
      now_ms = CASE WHEN clock_state.mode = EXCLUDED.mode THEN clock_state.now_ms ELSE EXCLUDED.now_ms END,
      evaluated_through_ms = CASE WHEN clock_state.mode = EXCLUDED.mode THEN clock_state.evaluated_through_ms ELSE EXCLUDED.evaluated_through_ms END,
      mode = EXCLUDED.mode, updated_at = now();`;
}

const controlRows = () => WORKLOADS.map((w) => sql`INSERT INTO controls (workload) VALUES (${w}) ON CONFLICT (workload) DO NOTHING;`).join("\n");

export async function migrate(db) {
  const schema = readFileSync(join(APP_DIR, "schema.sql"), "utf8");
  await db.query(`SELECT pg_advisory_lock(${LOCK});\n${schema}\n${guard(config.variant)}\n${clockRow()}\n${controlRows()}\nSELECT pg_advisory_unlock(${LOCK});`);
  log("migrate", "schema is current");
}
