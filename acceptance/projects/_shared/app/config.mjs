// What every role reads: the environment first, then the defaults this image was built with.
//
// The variant is the one thing that is ground truth for an acceptance run, so it is read here and
// nowhere is it SAID: no endpoint, header or log line names it. It comes from INVOICE_VARIANT, or
// from app/VARIANT (one word, written by assemble.mjs), or it is "correct".
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(APP_DIR);

export const VARIANTS = ["correct", "no-tenant-check", "broken-auth", "no-dedupe", "early-ack", "no-db-write", "toast-without-persistence"];

// The workloads this application runs, and which of them a test may stop, start, restart or fault.
export const WORKLOADS = ["api", "sink", "scheduler", "relay", "worker", "hooks"];
export const CONTROLLABLE = ["scheduler", "relay", "worker", "sink"];
export const FAULT_POINTS = {
  worker: ["before-effect", "after-commit-before-ack", "after-sink-before-ack", "after-ack-before-effect"],
  relay: ["after-confirm-before-mark"],
};
export const FAULT_EXIT = 70;

const env = (name, fallback) => (process.env[name] !== undefined && process.env[name] !== "" ? process.env[name] : fallback);

function fileVariant() {
  try {
    return readFileSync(join(APP_DIR, "VARIANT"), "utf8").trim() || "correct";
  } catch {
    return "correct";
  }
}

function variantOf() {
  const chosen = env("INVOICE_VARIANT", null) ?? fileVariant();
  if (!VARIANTS.includes(chosen)) throw new Error(`unknown INVOICE_VARIANT (one of ${VARIANTS.join(", ")})`);
  return chosen;
}

export const config = {
  variant: variantOf(),
  db: { host: env("PGHOST", "127.0.0.1"), port: Number(env("PGPORT", "5432")), user: env("PGUSER", "invoice"), database: env("PGDATABASE", "invoice"), password: env("PGPASSWORD", null) },
  transport: env("INVOICE_TRANSPORT", join(ROOT, "transport.mjs")),
  clockInjection: env("CLOCK_INJECTION", "none") === "live" ? "live" : "none",
  clockStart: env("CLOCK_START", "2026-10-22T08:00:00+07:00"),
  scheduleFile: env("SCHEDULE_FILE", join(ROOT, "contracts", "schedule.json")),
  ports: { api: Number(env("API_PORT", "8080")), sink: Number(env("SINK_PORT", "8081")), hooks: Number(env("HOOKS_PORT", "9090")) },
  sinkUrl: env("SINK_URL", "http://127.0.0.1:8081"),
  testHooks: env("ORBIT_TEST_HOOKS", "off") === "on",
  hooksToken: env("ORBIT_TEST_HOOKS_TOKEN", null),
  sinkToken: env("ORBIT_SINK_TOKEN", null),
  roles: env("INVOICE_ROLES", WORKLOADS.join(",")).split(",").map((r) => r.trim()).filter((r) => WORKLOADS.includes(r)),
  maxDeliveries: Number(env("MAX_DELIVERIES", "3")),
  retryBackoffMs: Number(env("RETRY_BACKOFF_MS", "250")),
  barrierMs: Number(env("HOOK_BARRIER_MS", "30000")),
  notDueEveryMs: Number(env("NOT_DUE_EVERY_MS", "60000")),
};

// A shared secret this application accepts: set, and at least this long. Anything shorter is
// treated as unset, so a role that needs one refuses to start rather than run on a guessable one.
export const MIN_SECRET = 16;
export const secretOk = (s) => typeof s === "string" && s.length >= MIN_SECRET;

export const log = (role, ...parts) => console.log(`[${new Date().toISOString()}] ${role}:`, ...parts);
