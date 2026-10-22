-- The synthetic invoice application's database. Idempotent: migrate.mjs applies it on every start.
-- Everything a witness below the interface reads is here; the sink, which stands for an external
-- system, keeps its own schema.

CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
  marker text,
  remind boolean NOT NULL DEFAULT false,
  idempotency_key text,
  request_digest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS invoices_tenant_name ON invoices (tenant_id, name);

-- Synthetic bearer tokens, issued only by the identity hook and kept only as their SHA-256: the
-- token itself is handed out once and stored nowhere.
CREATE TABLE IF NOT EXISTS tokens (
  token_hash text PRIMARY KEY,
  principal text NOT NULL,
  tenant_id text NOT NULL REFERENCES tenants (id),
  role text NOT NULL CHECK (role IN ('reader', 'writer')),
  issued_at timestamptz NOT NULL DEFAULT now()
);

-- A page's sign-in: a random session id (kept as its SHA-256) standing for a token, so the cookie
-- never carries the bearer token itself; it expires.
CREATE TABLE IF NOT EXISTS sessions (
  sid_hash text PRIMARY KEY,
  token_hash text NOT NULL REFERENCES tokens (token_hash) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- One row per dispatched occurrence: what was intended (scheduled_for), when it really ran.
CREATE TABLE IF NOT EXISTS billing_jobs (
  id bigint PRIMARY KEY,
  schedule text NOT NULL,
  revision text NOT NULL,
  occurrence_id text NOT NULL UNIQUE,
  scheduled_for timestamptz NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  execution_ref text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  requested integer NOT NULL DEFAULT 0
);
CREATE SEQUENCE IF NOT EXISTS billing_jobs_seq;

CREATE TABLE IF NOT EXISTS reminder_requests (
  id bigserial PRIMARY KEY,
  business_key text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  invoice_id text NOT NULL,
  occurrence_id text NOT NULL,
  execution_ref text NOT NULL,
  message_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Written in the job's transaction with its reminder request; the relay publishes it and marks it.
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  message_id text NOT NULL UNIQUE,
  channel text NOT NULL,
  payload jsonb NOT NULL,
  business_key text NOT NULL,
  execution_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_error text
);

-- The worker's dedupe record, written in the same statement as the reminder it guards.
CREATE TABLE IF NOT EXISTS inbox (
  business_key text PRIMARY KEY,
  message_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- The business effect. Its UNIQUE (business_key) guard is created by migrate.mjs, so that a
-- variant built to drop every guard against a second reminder really has none.
CREATE TABLE IF NOT EXISTS reminders (
  id bigserial PRIMARY KEY,
  business_key text NOT NULL,
  tenant_id text NOT NULL,
  invoice_id text NOT NULL,
  occurrence_id text NOT NULL,
  message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- What the scheduler decided at each evaluation, in order.
CREATE TABLE IF NOT EXISTS schedule_decisions (
  seq bigserial PRIMARY KEY,
  schedule text NOT NULL,
  revision text NOT NULL,
  occurrence_id text,
  scheduled_for timestamptz,
  decision text NOT NULL CHECK (decision IN ('not-due', 'due', 'missed', 'triggered', 'duplicate-dispatch')),
  reason text,
  execution_ref text,
  evaluated_at timestamptz NOT NULL,
  clock text NOT NULL CHECK (clock IN ('injected', 'real')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- The business clock (mode injected: moved only by the clock hook) and how far the decision loop
-- has evaluated it.
CREATE TABLE IF NOT EXISTS clock_state (
  id integer PRIMARY KEY CHECK (id = 1),
  mode text NOT NULL CHECK (mode IN ('injected', 'real')),
  now_ms bigint,
  evaluated_through_ms bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trigger_requests (
  id bigserial PRIMARY KEY,
  schedule text NOT NULL,
  occurrence_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  decision text,
  execution_ref text,
  resolved_occurrence_id text,
  scheduled_for_ms bigint,
  error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);

-- How many times each logical message has reached the worker: its own count, because a broker's
-- redelivery marker may be a flag that cannot count, or may not count a requeue at all.
CREATE TABLE IF NOT EXISTS deliveries (
  message_key text PRIMARY KEY,
  deliveries integer NOT NULL DEFAULT 1,
  last_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- What a workload did with each delivery, in order.
CREATE TABLE IF NOT EXISTS attempts (
  seq bigserial PRIMARY KEY,
  workload text NOT NULL,
  message_id text,
  business_key text,
  delivery_attempt integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('processed', 'duplicate', 'retry', 'dead-lettered', 'dropped', 'fault', 'published', 'publish-failed')),
  execution_ref text,
  reason text,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS faults (
  workload text NOT NULL,
  point text NOT NULL,
  armed boolean NOT NULL DEFAULT false,
  armed_at timestamptz,
  fired_at timestamptz,
  PRIMARY KEY (workload, point)
);

CREATE TABLE IF NOT EXISTS fault_events (
  seq bigserial PRIMARY KEY,
  workload text NOT NULL,
  point text NOT NULL,
  message_id text,
  delivery_attempt integer,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS controls (
  workload text PRIMARY KEY,
  desired text NOT NULL DEFAULT 'running' CHECK (desired IN ('running', 'stopped')),
  actual text NOT NULL DEFAULT 'stopped' CHECK (actual IN ('starting', 'running', 'stopping', 'stopped', 'restarting')),
  reason text,
  restart_gen integer NOT NULL DEFAULT 0,
  restarts integer NOT NULL DEFAULT 0,
  requested_at timestamptz,
  ready_at timestamptz,
  heartbeat_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS sink;

-- The synthetic notification sink: idempotent by key, and read back by key.
CREATE TABLE IF NOT EXISTS sink.notifications (
  idempotency_key text PRIMARY KEY,
  tenant_id text,
  invoice_id text,
  occurrence_id text,
  body jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deliveries integer NOT NULL DEFAULT 1
);

INSERT INTO tenants (id, name) VALUES
  ('tenant-a', 'Synthetic tenant A'),
  ('tenant-b', 'Synthetic tenant B')
ON CONFLICT (id) DO NOTHING;

-- inv-a is the one invoice a billing period reminds; tenant B's invoice is never reminded, so a
-- period that changes tenant B has done something it must not.
INSERT INTO invoices (id, tenant_id, name, amount, status, marker, remind) VALUES
  ('inv-a', 'tenant-a', 'Synthetic invoice A', 120.00, 'open', 'canary-invoice-a', true),
  ('inv-b', 'tenant-b', 'Synthetic invoice B', 80.00, 'open', 'canary-invoice-b', false)
ON CONFLICT (id) DO NOTHING;
