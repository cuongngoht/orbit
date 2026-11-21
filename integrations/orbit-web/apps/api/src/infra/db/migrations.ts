// THE SCHEMA, as numbered migrations. Each is applied once, in order, and remembered with the SHA-256 of its text
// (orbit.schema_migrations, migrate.ts): a migration already applied is never applied again, and one whose
// text changed after it was applied is refused at start -- a database is never quietly moved onto a schema nobody
// wrote down. A change of schema is a NEW migration at the end, never an edit of one that shipped.
//
// Three schemas, one per domain, each reached by its unqualified names (the connection's search path):
//
//   app         accounts and their Claude identities, browser sessions, settings, and the chats (Claude Code
//               workspaces) with their messages, event journal, runs, shares and images
//   research    research workspaces, their sources (immutable revisions, chunks indexed for full-text search), sessions,
//               runs, citations, notes and findings
//   governance  each account's policy (revisions, overrides), run bindings, approvals, the audit record (one hash
//               chain per account), findings' resolutions, reports, isolation checks
//
// THE ACCOUNT IS THE BOUNDARY. Every root record carries the account that owns it, and every child carries it too, held
// to its parent's by a composite foreign key: a message, a chunk or a citation cannot belong to a chat, a revision or a
// workspace of another account, whatever the code above it does. The audit record is never cascaded from anything:
// deleting a chat or a research workspace leaves its governance records where they are.
//
// pgvector is enabled (the `vector` type, cosine distance) and checked at every start; nothing stores a vector yet.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const INITIAL = String.raw`
CREATE SCHEMA app;
CREATE SCHEMA research;
CREATE SCHEMA governance;

-- A row's owner never changes: a record moves to another account by nobody's write.
CREATE FUNCTION app.account_never_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'a record never moves to another account' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ===================================================================================================================
-- ACCOUNTS: one internal account per verified Claude identity.
-- ===================================================================================================================

CREATE TABLE app.accounts (
  id uuid PRIMARY KEY,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL
);

-- The Claude identity an account is: the CLI's own account email (lower case) in the organization the CLI names by id.
-- Never a display name: a renamed organization is the same identity, and two organizations of one email are two.
CREATE TABLE app.account_identities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES app.accounts (id),
  provider text NOT NULL CHECK (provider = 'claude.ai'),
  email_norm text NOT NULL CHECK (email_norm = lower(email_norm) AND email_norm <> ''),
  org_key text NOT NULL,
  email text NOT NULL,
  org_name text,
  plan text,
  created_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  UNIQUE (provider, email_norm, org_key)
);

-- The ONE identity this runtime's Claude CLI serves now (an account, or nobody). Every sign-in, sign-out and switch locks
-- this row; a browser session is valid only for the account it names.
CREATE TABLE app.runtime_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  account_id uuid REFERENCES app.accounts (id),
  epoch bigint NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL
);
INSERT INTO app.runtime_identity (singleton, account_id, epoch, changed_at) VALUES (true, NULL, 0, now());

-- A browser's session, issued once that browser finished a Claude sign-in. Only the SHA-256 of its token is kept.
CREATE TABLE app.account_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  epoch bigint NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  user_agent text
);
CREATE INDEX account_sessions_open ON app.account_sessions (account_id) WHERE revoked_at IS NULL;

-- What is the deployment's (not any account's): one value per key.
CREATE TABLE app.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

-- What an account set for itself: its preferences, its privileged switches, its connector choices.
CREATE TABLE app.account_settings (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, key)
);

-- ===================================================================================================================
-- CHATS (Claude Code workspaces)
-- ===================================================================================================================

CREATE TABLE app.sessions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  owner_email text NOT NULL,
  title text NOT NULL,
  source text,
  repository text,
  repository_id text,
  branch text,
  work_branch text,
  base_commit text,
  model text NOT NULL,
  effort text NOT NULL,
  mode text NOT NULL,
  workspace_path text NOT NULL,
  claude_session_id text NOT NULL,
  turns integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  status_reason text,
  last_seq bigint NOT NULL DEFAULT 0,
  pending_prompt text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id)
);
CREATE INDEX sessions_by_account ON app.sessions (account_id, updated_at DESC);
CREATE INDEX sessions_by_status ON app.sessions (status);
CREATE TRIGGER sessions_account_fixed BEFORE UPDATE ON app.sessions FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- Who an owner shared a chat with, by the email of their Claude identity.
CREATE TABLE app.session_access (
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  email text NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, email),
  FOREIGN KEY (account_id, session_id) REFERENCES app.sessions (account_id, id) ON DELETE CASCADE
);
CREATE INDEX session_access_by_email ON app.session_access (email);

CREATE TABLE app.messages (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  run_id text,
  role text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, session_id) REFERENCES app.sessions (account_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_by_session ON app.messages (session_id, seq);

-- The journal of a chat's durable events, numbered per chat by the chat's own counter (sessions.last_seq).
CREATE TABLE app.events (
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  seq bigint NOT NULL,
  run_id text,
  type text NOT NULL,
  data jsonb NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (account_id, session_id) REFERENCES app.sessions (account_id, id) ON DELETE CASCADE
);

CREATE TABLE app.runs (
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  status text NOT NULL,
  model text NOT NULL,
  effort text,
  mode text,
  resumed boolean NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  exit_code integer,
  signal text,
  cost_usd double precision,
  FOREIGN KEY (account_id, session_id) REFERENCES app.sessions (account_id, id) ON DELETE CASCADE
);
CREATE INDEX runs_by_session ON app.runs (session_id);
CREATE INDEX runs_running ON app.runs (status) WHERE status = 'running';

CREATE TABLE app.project_inventories (
  session_id text PRIMARY KEY,
  account_id uuid NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, session_id) REFERENCES app.sessions (account_id, id) ON DELETE CASCADE
);

CREATE TABLE app.shares (
  session_id text PRIMARY KEY,
  account_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  include_tools boolean NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, session_id) REFERENCES app.sessions (account_id, id) ON DELETE CASCADE
);

-- A chat message's images: uploaded by an account, then claimed by one chat (and then that chat's account's).
CREATE TABLE app.images (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  media_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer,
  height integer,
  sha256 text NOT NULL,
  session_id text,
  message_id text,
  position integer,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, session_id) REFERENCES app.sessions (account_id, id) ON DELETE CASCADE
);
CREATE INDEX images_by_session ON app.images (session_id, message_id, position);
CREATE INDEX images_unclaimed ON app.images (created_at) WHERE session_id IS NULL;

-- ===================================================================================================================
-- RESEARCH
-- ===================================================================================================================

-- Full-text search over research passages: diacritics are folded by Orbit Web before the text reaches the index (so
-- "ro ri" finds "rò rỉ"), English words are stemmed, and NO word is dropped as a stop word -- a folded Vietnamese word
-- ("so", "me") must never vanish because it spells an English one.
CREATE TEXT SEARCH DICTIONARY research.english_stem_all (TEMPLATE = snowball, Language = english);
CREATE TEXT SEARCH CONFIGURATION research.orbit_search (COPY = pg_catalog.simple);
ALTER TEXT SEARCH CONFIGURATION research.orbit_search
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part WITH research.english_stem_all;

CREATE TABLE research.research_workspaces (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  owner_email text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  next_finding integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id)
);
CREATE INDEX research_workspaces_by_account ON research.research_workspaces (account_id, updated_at DESC);
CREATE TRIGGER research_workspaces_account_fixed BEFORE UPDATE ON research.research_workspaces FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

CREATE TABLE research.research_workspace_access (
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  email text NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, email),
  FOREIGN KEY (account_id, workspace_id) REFERENCES research.research_workspaces (account_id, id) ON DELETE CASCADE
);
CREATE INDEX research_workspace_access_by_email ON research.research_workspace_access (email);

CREATE TABLE research.research_sources (
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  origin text,
  state text NOT NULL,
  state_reason text,
  current_revision_id text,
  -- The number the next revision of this source gets: handed out by an UPDATE of this row, never by MAX()+1.
  next_revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES research.research_workspaces (account_id, id) ON DELETE CASCADE
);
CREATE INDEX research_sources_by_workspace ON research.research_sources (workspace_id, created_at);

CREATE TABLE research.research_source_revisions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  source_id text NOT NULL,
  number integer NOT NULL,
  content_hash text NOT NULL,
  byte_size bigint NOT NULL,
  media_type text NOT NULL,
  file_name text,
  url text,
  final_url text,
  fetched_at timestamptz,
  status text NOT NULL,
  error text,
  page_count integer,
  char_count integer NOT NULL DEFAULT 0,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  indexed_at timestamptz,
  UNIQUE (source_id, number),
  UNIQUE (account_id, id),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id, source_id) REFERENCES research.research_sources (account_id, workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX research_revisions_by_hash ON research.research_source_revisions (workspace_id, content_hash);
CREATE INDEX research_revisions_pending ON research.research_source_revisions (status) WHERE status = 'pending';

CREATE TABLE research.research_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  source_id text NOT NULL,
  revision_id text NOT NULL,
  ordinal integer NOT NULL,
  page integer,
  section text,
  char_start integer NOT NULL,
  char_end integer NOT NULL,
  text text NOT NULL,
  -- The text and the section with their diacritics folded, as Orbit Web folds a question's words: what is indexed.
  folded text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('research.orbit_search'::regconfig, folded)) STORED,
  UNIQUE (revision_id, ordinal),
  FOREIGN KEY (account_id, workspace_id, revision_id) REFERENCES research.research_source_revisions (account_id, workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX research_chunks_search ON research.research_chunks USING gin (tsv);
CREATE INDEX research_chunks_scope ON research.research_chunks (account_id, workspace_id, revision_id, ordinal);

CREATE TABLE research.research_sessions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  title text NOT NULL,
  model text NOT NULL,
  effort text NOT NULL,
  status text NOT NULL,
  status_reason text,
  last_seq bigint NOT NULL DEFAULT 0,
  draft_question text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES research.research_workspaces (account_id, id) ON DELETE CASCADE
);
CREATE INDEX research_sessions_by_workspace ON research.research_sessions (workspace_id);

CREATE TABLE research.research_session_sources (
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  source_id text NOT NULL,
  PRIMARY KEY (session_id, source_id),
  FOREIGN KEY (account_id, session_id) REFERENCES research.research_sessions (account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, source_id) REFERENCES research.research_sources (account_id, id) ON DELETE CASCADE
);

CREATE TABLE research.research_messages (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  run_id text,
  role text NOT NULL,
  text text NOT NULL,
  partial boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, session_id) REFERENCES research.research_sessions (account_id, id) ON DELETE CASCADE
);
CREATE INDEX research_messages_by_session ON research.research_messages (session_id, seq);

CREATE TABLE research.research_runs (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  workspace_id text NOT NULL,
  status text NOT NULL,
  model text NOT NULL,
  effort text NOT NULL,
  question_id text,
  answer_id text,
  passages integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  exit_code integer,
  signal text,
  cost_usd double precision,
  input_tokens integer,
  output_tokens integer,
  error text,
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, session_id) REFERENCES research.research_sessions (account_id, id) ON DELETE CASCADE
);
CREATE INDEX research_runs_by_session ON research.research_runs (session_id, started_at);
CREATE INDEX research_runs_running ON research.research_runs (status) WHERE status = 'running';

-- The revisions a run's evidence is frozen to, and the passages it was given.
CREATE TABLE research.research_run_revisions (
  account_id uuid NOT NULL,
  run_id text NOT NULL,
  source_id text NOT NULL,
  revision_id text NOT NULL,
  title text NOT NULL,
  PRIMARY KEY (run_id, revision_id),
  FOREIGN KEY (account_id, run_id) REFERENCES research.research_runs (account_id, id) ON DELETE CASCADE
);

CREATE TABLE research.research_run_passages (
  account_id uuid NOT NULL,
  run_id text NOT NULL,
  label text NOT NULL,
  chunk_id bigint,
  source_id text NOT NULL,
  revision_id text NOT NULL,
  rank integer NOT NULL,
  score double precision,
  match text NOT NULL,
  PRIMARY KEY (run_id, label),
  FOREIGN KEY (account_id, run_id) REFERENCES research.research_runs (account_id, id) ON DELETE CASCADE
);

CREATE TABLE research.research_citations (
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  session_id text,
  run_id text,
  message_id text,
  label text NOT NULL,
  source_id text NOT NULL,
  revision_id text NOT NULL,
  revision_number integer,
  chunk_ordinal integer NOT NULL,
  page integer,
  section text,
  char_start integer NOT NULL,
  char_end integer NOT NULL,
  source_title text NOT NULL,
  quote text NOT NULL,
  match text NOT NULL,
  rank integer NOT NULL,
  score double precision,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES research.research_workspaces (account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, session_id) REFERENCES research.research_sessions (account_id, id) ON DELETE SET NULL (session_id)
);
CREATE INDEX research_citations_by_session ON research.research_citations (session_id);
CREATE INDEX research_citations_by_message ON research.research_citations (message_id);

CREATE TABLE research.research_notes (
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  session_id text,
  title text NOT NULL,
  body text NOT NULL,
  source_id text,
  citation_id text,
  created_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, workspace_id) REFERENCES research.research_workspaces (account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, session_id) REFERENCES research.research_sessions (account_id, id) ON DELETE SET NULL (session_id),
  FOREIGN KEY (account_id, citation_id) REFERENCES research.research_citations (account_id, id) ON DELETE SET NULL (citation_id)
);
CREATE INDEX research_notes_by_workspace ON research.research_notes (workspace_id);

CREATE TABLE research.research_findings (
  id text PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id text NOT NULL,
  session_id text,
  number integer NOT NULL,
  title text NOT NULL,
  statement text NOT NULL,
  status text NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, number),
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES research.research_workspaces (account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, session_id) REFERENCES research.research_sessions (account_id, id) ON DELETE SET NULL (session_id)
);

CREATE TABLE research.research_finding_citations (
  account_id uuid NOT NULL,
  finding_id text NOT NULL,
  citation_id text NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (finding_id, citation_id),
  FOREIGN KEY (account_id, finding_id) REFERENCES research.research_findings (account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, citation_id) REFERENCES research.research_citations (account_id, id) ON DELETE CASCADE
);

CREATE TABLE research.research_events (
  account_id uuid NOT NULL,
  session_id text NOT NULL,
  seq bigint NOT NULL,
  run_id text,
  type text NOT NULL,
  data jsonb NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (account_id, session_id) REFERENCES research.research_sessions (account_id, id) ON DELETE CASCADE
);

-- ===================================================================================================================
-- GOVERNANCE
-- ===================================================================================================================

-- What an account's governance may point at: its chats and its research workspaces. A row outlives the record it names
-- (deleted_at): the policy, the approvals and the audit that concerned it keep a target.
CREATE TABLE governance.account_resources (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  kind text NOT NULL CHECK (kind IN ('workspace', 'research_workspace')),
  id text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (account_id, kind, id),
  UNIQUE (kind, id)
);

CREATE TABLE governance.policy_heads (
  account_id uuid PRIMARY KEY REFERENCES app.accounts (id),
  last_revision integer NOT NULL DEFAULT 0
);

CREATE TABLE governance.policy_revisions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  revision integer,
  state text NOT NULL CHECK (state IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'DISCARDED')),
  document text NOT NULL,
  digest text NOT NULL,
  name text NOT NULL,
  risk text,
  source text NOT NULL,
  based_on text,
  authors jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  confirmed_digest text,
  confirmed_base text,
  confirmed_risk text,
  confirmed_by text,
  confirmed_at timestamptz,
  published_at timestamptz,
  published_by text,
  superseded_at timestamptz,
  UNIQUE (account_id, id),
  UNIQUE (account_id, revision)
);
CREATE UNIQUE INDEX one_policy_in_effect ON governance.policy_revisions (account_id) WHERE state = 'PUBLISHED';
CREATE TRIGGER policy_revisions_account_fixed BEFORE UPDATE ON governance.policy_revisions FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

CREATE FUNCTION governance.published_never_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('PUBLISHED', 'SUPERSEDED') THEN RAISE EXCEPTION 'a published revision is never removed' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('PUBLISHED', 'SUPERSEDED') AND (
       NEW.document IS DISTINCT FROM OLD.document OR NEW.digest IS DISTINCT FROM OLD.digest OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.confirmed_digest IS DISTINCT FROM OLD.confirmed_digest OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
    OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.published_by IS DISTINCT FROM OLD.published_by
    OR NEW.authors IS DISTINCT FROM OLD.authors
    OR (NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'PUBLISHED' AND NEW.state = 'SUPERSEDED'))) THEN
    RAISE EXCEPTION 'a published revision never changes' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER policy_revisions_published BEFORE UPDATE OR DELETE ON governance.policy_revisions FOR EACH ROW EXECUTE FUNCTION governance.published_never_changes();

-- What narrows the account's policy for one chat or one research workspace. Never another account's resource.
CREATE TABLE governance.policy_overrides (
  account_id uuid NOT NULL,
  kind text NOT NULL,
  resource_id text NOT NULL,
  document text NOT NULL,
  digest text NOT NULL,
  set_at timestamptz NOT NULL,
  set_by text NOT NULL,
  PRIMARY KEY (account_id, kind, resource_id),
  FOREIGN KEY (account_id, kind, resource_id) REFERENCES governance.account_resources (account_id, kind, id)
);

-- A run of an agent, bound when it starts: its token (as its SHA-256), the account, the resource it works in and the
-- revision of the account's policy in effect then.
CREATE TABLE governance.run_bindings (
  run_id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  kind text NOT NULL CHECK (kind IN ('chat', 'research')),
  resource_kind text NOT NULL,
  resource_id text NOT NULL,
  research_session_id text,
  agent_id text NOT NULL,
  policy_revision text NOT NULL,
  started_by text NOT NULL,
  work_branch text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  UNIQUE (account_id, run_id),
  CHECK ((kind = 'chat') = (resource_kind = 'workspace')),
  CHECK ((kind = 'research') = (research_session_id IS NOT NULL)),
  FOREIGN KEY (account_id, resource_kind, resource_id) REFERENCES governance.account_resources (account_id, kind, id),
  FOREIGN KEY (account_id, policy_revision) REFERENCES governance.policy_revisions (account_id, id)
);
CREATE TRIGGER run_bindings_account_fixed BEFORE UPDATE ON governance.run_bindings FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

CREATE TABLE governance.approvals (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  action text NOT NULL,
  environment text NOT NULL,
  fingerprint text NOT NULL,
  params jsonb NOT NULL,
  summary text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'granted', 'rejected', 'expired', 'consumed')),
  requested_at timestamptz NOT NULL,
  requested_by text NOT NULL,
  requested_by_type text NOT NULL,
  agent_id text,
  workspace_id text,
  run_id text,
  decision_id text,
  expires_at timestamptz NOT NULL,
  decided_by text,
  -- Only a person decides an approval: never an agent, never a service, never the run that asked.
  decided_by_type text CHECK (decided_by_type IS NULL OR decided_by_type = 'human'),
  decided_at timestamptz,
  consumed_at timestamptz,
  outcome text,
  change jsonb,
  FOREIGN KEY (account_id, run_id) REFERENCES governance.run_bindings (account_id, run_id)
);
CREATE INDEX approvals_by_fingerprint ON governance.approvals (account_id, fingerprint);
CREATE INDEX approvals_by_account ON governance.approvals (account_id, requested_at DESC);
CREATE TRIGGER approvals_account_fixed BEFORE UPDATE ON governance.approvals FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

CREATE FUNCTION governance.approval_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.params IS DISTINCT FROM OLD.params OR NEW.action IS DISTINCT FROM OLD.action THEN
    RAISE EXCEPTION 'an approval''s action is fixed' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IN ('consumed', 'rejected', 'expired') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'a settled approval stays settled' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approvals_rules BEFORE UPDATE ON governance.approvals FOR EACH ROW EXECUTE FUNCTION governance.approval_rules();

CREATE TABLE governance.finding_resolutions (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  finding_id text NOT NULL,
  resolution text NOT NULL,
  note text,
  resolved_by text NOT NULL,
  resolved_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, finding_id)
);

CREATE TABLE governance.reports (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  day text NOT NULL,
  generated_at timestamptz NOT NULL,
  generated_by text NOT NULL,
  head text,
  content text NOT NULL,
  markdown text NOT NULL
);
CREATE INDEX reports_by_day ON governance.reports (account_id, day);

CREATE TABLE governance.isolation_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  state text NOT NULL,
  checks jsonb NOT NULL,
  detail text NOT NULL
);

-- THE AUDIT RECORD: one hash chain per account, and one for what concerns no account (the deployment's). A chain's
-- head row is locked to append, so records of one chain are numbered and linked one after another whatever writes
-- them concurrently; chains of two accounts never wait for each other.
CREATE TABLE governance.audit_chains (
  id text PRIMARY KEY,
  account_id uuid UNIQUE REFERENCES app.accounts (id),
  head_seq bigint NOT NULL DEFAULT 0,
  head_hash text,
  CHECK ((id = 'deployment') = (account_id IS NULL)),
  CHECK (id = 'deployment' OR id = 'account:' || account_id::text)
);
INSERT INTO governance.audit_chains (id, account_id, head_seq, head_hash) VALUES ('deployment', NULL, 0, NULL);

CREATE TABLE governance.audit_events (
  chain_id text NOT NULL REFERENCES governance.audit_chains (id),
  seq bigint NOT NULL,
  event_id text NOT NULL UNIQUE,
  schema_version integer NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  account_id uuid,
  principal_id text NOT NULL,
  principal_type text NOT NULL,
  agent_id text,
  workspace_id text,
  run_id text,
  correlation_id text NOT NULL,
  causation_id text,
  policy_revision text,
  decision_id text,
  outcome text NOT NULL,
  reason_codes jsonb NOT NULL,
  evidence_refs jsonb NOT NULL,
  data jsonb NOT NULL,
  previous_hash text,
  hash text NOT NULL,
  PRIMARY KEY (chain_id, seq)
);
CREATE INDEX audit_by_type ON governance.audit_events (chain_id, event_type, seq);
CREATE INDEX audit_by_workspace ON governance.audit_events (chain_id, workspace_id, seq);
CREATE INDEX audit_by_time ON governance.audit_events (chain_id, occurred_at);
CREATE INDEX audit_by_decision ON governance.audit_events (decision_id);

CREATE FUNCTION governance.audit_never_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'an audit record is never changed' USING ERRCODE = 'P0001'; END IF;
  RAISE EXCEPTION 'an audit record is never removed' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER audit_never_updated BEFORE UPDATE OR DELETE ON governance.audit_events FOR EACH ROW EXECUTE FUNCTION governance.audit_never_changes();
CREATE TRIGGER audit_never_truncated BEFORE TRUNCATE ON governance.audit_events FOR EACH STATEMENT EXECUTE FUNCTION governance.audit_never_changes();
`;

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: "initial", sql: INITIAL }];
