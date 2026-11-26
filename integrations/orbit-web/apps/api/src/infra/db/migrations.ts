// THE SCHEMA, as numbered migrations. Each is applied once, in order, and remembered with the SHA-256 of its text
// (orbit.schema_migrations, migrate.ts): a migration already applied is never applied again, and one whose
// text changed after it was applied is refused at start -- a database is never quietly moved onto a schema nobody
// wrote down. A change of schema is a NEW migration at the end, never an edit of one that shipped.
//
// Three schemas, one per domain, each reached by its unqualified names (the connection's search path):
//
//   app         accounts (the OrbitId of every record) and their users, setup codes, sign-in throttling, browser
//               sessions, settings (the deployment's are the system account's), the AI connections of each account, and
//               the chats (Claude Code workspaces) with their messages, event journal, runs, shares and images
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
//
//   workforce   the virtual office: departments, employees and their Personal Sandboxes, missions, assignments and
//               reservations, runs, resources, handoffs and artifacts, decisions, the outbox, schedules, deliveries

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const INITIAL = String.raw`
CREATE SCHEMA app;
CREATE SCHEMA research;
CREATE SCHEMA governance;
CREATE SCHEMA workforce;

-- A row's owner never changes: a record moves to another account by nobody's write.
CREATE FUNCTION app.account_never_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'a record never moves to another account' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ===================================================================================================================
-- ACCOUNTS AND USERS: Orbit's own sign-in. An account (its id is the OrbitId) is made by a one-time setup code or by the
-- trial seed, never by an AI CLI's sign-in; a user signs in to it with a username and a password.
-- ===================================================================================================================

CREATE TABLE app.accounts (
  id uuid PRIMARY KEY,
  -- 'system': the reserved account of what is the deployment's own (its settings, capacity, isolation checks, audit
  -- chain); it never signs in. 'customer': an Orbit account (a tenant).
  kind text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer', 'system')),
  display_name text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  contact_email text,
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX one_system_account ON app.accounts (kind) WHERE kind = 'system';
INSERT INTO app.accounts (id, kind, display_name, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'system', 'Orbit Web (deployment)', now(), now());

-- A person who signs in to Orbit: a username and a password Orbit keeps as a slow hash (scrypt), in ONE account. Only
-- a verified email takes part in sharing; a user without one is shared with by username.
CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  username text NOT NULL UNIQUE CHECK (username = lower(username) AND username ~ '^[a-z][a-z0-9._-]{1,31}$'),
  full_name text NOT NULL,
  email text CHECK (email IS NULL OR email = lower(email)),
  email_verified_at timestamptz,
  role text NOT NULL CHECK (role IN ('owner')),
  password_hash text NOT NULL,
  password_changed_at timestamptz NOT NULL,
  must_change_password boolean NOT NULL DEFAULT false,
  -- The trial seed's password skips the password rules; changing it ends that.
  trial_waiver boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id)
);
CREATE TRIGGER users_account_fixed BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();
-- A verified email names ONE user: a share by email reaches exactly one person.
CREATE UNIQUE INDEX one_user_per_verified_email ON app.users (email) WHERE email_verified_at IS NOT NULL;

-- One-time codes an operator prints in a terminal of the server: the first administrator, a new account, or a password
-- reset. Kept as a hash; consumed by one conditional update, so of two browsers only one succeeds. A code that makes
-- an account belongs to the system account until it is used; a reset's is the account of the user it resets.
-- consumed_by: the user the code made (or reset).
CREATE TABLE app.setup_codes (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  purpose text NOT NULL CHECK (purpose IN ('first_admin', 'new_account', 'reset_password')),
  user_id uuid,
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid,
  CHECK ((purpose = 'reset_password') = (user_id IS NOT NULL)),
  FOREIGN KEY (account_id, user_id) REFERENCES app.users (account_id, id)
);

-- Failed sign-ins counted per key (a username, or a hashed client address) in a window: what slows a guesser down.
CREATE TABLE app.login_throttle (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  key text NOT NULL,
  failures integer NOT NULL,
  window_start timestamptz NOT NULL,
  blocked_until timestamptz,
  PRIMARY KEY (account_id, key)
);

-- A browser's session, issued when a USER signed in. Only the SHA-256 of its token is kept.
CREATE TABLE app.account_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  user_agent text,
  FOREIGN KEY (account_id, user_id) REFERENCES app.users (account_id, id)
);
CREATE INDEX account_sessions_open ON app.account_sessions (account_id) WHERE revoked_at IS NULL;
CREATE INDEX account_sessions_of_user ON app.account_sessions (user_id) WHERE revoked_at IS NULL;

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
  -- The CLI the chat runs on and the account's connection it names (null: the default Claude Code connection).
  runtime text NOT NULL DEFAULT 'claude' CHECK (runtime IN ('claude', 'codex')),
  connection_id uuid,
  -- The CLI's own session: Claude Code's session id, or OpenAI Codex's thread id once its first run named it.
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

-- Who an owner shared a chat with, by their share address (a verified email, or <username>@users.orbit.local).
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
  kind text NOT NULL CHECK (kind IN ('workspace', 'research_workspace', 'employee')),
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
  kind text NOT NULL CHECK (kind IN ('chat', 'research', 'assignment', 'executive')),
  resource_kind text NOT NULL,
  resource_id text NOT NULL,
  research_session_id text,
  agent_id text NOT NULL,
  policy_revision text NOT NULL,
  started_by text NOT NULL,
  work_branch text,
  -- An employee's attempt: the work it does and the department it was dispatched in, with that department's policy
  -- revision then (the department's CURRENT one decides each later operation; this one explains the past).
  assignment_id uuid,
  mission_id uuid,
  department_id uuid,
  department_revision text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  UNIQUE (account_id, run_id),
  CONSTRAINT run_binding_assignment CHECK ((kind = 'assignment') = (assignment_id IS NOT NULL)),
  CHECK ((kind = 'chat') = (resource_kind = 'workspace')),
  CHECK ((kind IN ('assignment', 'executive')) = (resource_kind = 'employee')),
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
  -- The deployment's checks are the system account's.
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  checked_at timestamptz NOT NULL,
  state text NOT NULL,
  checks jsonb NOT NULL,
  detail text NOT NULL
);

-- THE AUDIT RECORD: one hash chain per account -- the deployment's own records are the SYSTEM account's chain. A chain's
-- head row is locked to append, so records of one chain are numbered and linked one after another whatever writes
-- them concurrently; chains of two accounts never wait for each other.
CREATE TABLE governance.audit_chains (
  id text PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES app.accounts (id),
  head_seq bigint NOT NULL DEFAULT 0,
  head_hash text,
  CHECK (id = 'account:' || account_id::text)
);
INSERT INTO governance.audit_chains (id, account_id, head_seq, head_hash) VALUES ('account:00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 0, NULL);

CREATE TABLE governance.audit_events (
  chain_id text NOT NULL REFERENCES governance.audit_chains (id),
  seq bigint NOT NULL,
  event_id text NOT NULL UNIQUE,
  schema_version integer NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
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


const WORKFORCE = String.raw`
-- ===================================================================================================================
-- AI CONNECTIONS: what an account connected of Claude Code, Codex and Antigravity. Each connection has a config home of
-- its own (the CLI's login lives there); nothing here is a credential -- an API key is kept by the server's credential
-- store and named here by reference.
-- ===================================================================================================================

-- What is installed is the deployment's (the system account's).
CREATE TABLE app.runtime_installations (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  runtime text NOT NULL CHECK (runtime IN ('claude', 'codex', 'agy')),
  state text NOT NULL CHECK (state IN ('installed', 'not_installed', 'error')),
  version text,
  detail text,
  checked_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, runtime)
);

CREATE TABLE app.ai_connections (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  runtime text NOT NULL CHECK (runtime IN ('claude', 'codex', 'agy')),
  label text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  method text NOT NULL CHECK (method IN ('subscription', 'api_key', 'cloud')),
  -- The config home, relative to the connections room: <account>/<connection>.
  home text NOT NULL UNIQUE,
  credential_ref text,
  cloud jsonb,
  auth_state text NOT NULL CHECK (auth_state IN ('connected', 'disconnected', 'auth_required', 'error')),
  reason text,
  reason_code text,
  identity text,
  -- What tells two provider identities apart (lower-cased, never shown): one identity, one account.
  identity_key text,
  catalog jsonb NOT NULL,
  capabilities jsonb NOT NULL,
  checked_at timestamptz,
  plugin_revision integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id)
);
CREATE UNIQUE INDEX one_account_per_identity ON app.ai_connections (runtime, identity_key) WHERE identity_key IS NOT NULL AND removed_at IS NULL;
CREATE UNIQUE INDEX one_default_connection ON app.ai_connections (account_id, runtime) WHERE is_default AND removed_at IS NULL;
CREATE TRIGGER ai_connections_account_fixed BEFORE UPDATE ON app.ai_connections FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- The account owner's consent to load the Orbit plugin, per connection, use case and plugin digest.
CREATE TABLE app.plugin_grants (
  account_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  use_case text NOT NULL CHECK (use_case IN ('chat', 'employee')),
  digest text NOT NULL,
  approved boolean NOT NULL,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, connection_id, use_case),
  FOREIGN KEY (account_id, connection_id) REFERENCES app.ai_connections (account_id, id) ON DELETE CASCADE
);

-- ===================================================================================================================
-- THE VIRTUAL OFFICE (workforce): offices, departments, employees and their Personal Sandboxes; missions, assignments,
-- the reservation that makes "one employee, one held assignment" a fact of the database; runs (attempts) with their
-- lease and fence; handoffs and artifacts; resources (capacity, budgets, compute reservations); the outbox journal and
-- consumers' inbox; idempotency keys; decisions (Needs me); schedules, occurrences and deliveries.
-- Every row carries its account, and every child is held to its parent's account by a composite foreign key.
-- ===================================================================================================================

-- The account's office version: moved by every command that changes what the office shows (the pages' resourceVersion).
CREATE TABLE workforce.office_versions (
  account_id uuid PRIMARY KEY REFERENCES app.accounts (id),
  version bigint NOT NULL DEFAULT 0
);

-- The company of an account (its office): activated once, empty. defaults: what an employee of a runtime runs on when
-- its profile and its department leave a field to the company (execution precedence). ceo_revision: the counter its
-- CEO appointments are numbered by (the slot's own row, taken FOR UPDATE by a command that appoints).
CREATE TABLE workforce.offices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES app.accounts (id),
  name text NOT NULL,
  defaults jsonb NOT NULL DEFAULT '{}' CONSTRAINT office_defaults_object CHECK (jsonb_typeof(defaults) = 'object'),
  ceo_revision integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT office_account_id UNIQUE (account_id, id)
);

-- defaults: its execution defaults (above the company's); manager_revision: the counter its manager appointments are
-- numbered by.
CREATE TABLE workforce.departments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  defaults jsonb NOT NULL DEFAULT '{}' CONSTRAINT department_defaults_object CHECK (jsonb_typeof(defaults) = 'object'),
  manager_revision integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id)
);
CREATE UNIQUE INDEX department_names ON workforce.departments (account_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE workforce.employees (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('permanent', 'assistant')),
  department_id uuid,
  manager_id uuid,
  employment text NOT NULL CHECK (employment IN ('candidate', 'probation', 'active', 'suspended', 'archived', 'deleted')),
  employment_reason text,
  profile_revision integer NOT NULL,
  resource_revision integer NOT NULL,
  connection_id uuid,
  -- A temporary assistant: when its engagement ends, the mission it serves, and the lead who engaged it (its quota).
  expires_at timestamptz,
  mission_scope uuid,
  engaged_by uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, department_id) REFERENCES workforce.departments (account_id, id),
  FOREIGN KEY (account_id, manager_id) REFERENCES workforce.employees (account_id, id),
  FOREIGN KEY (account_id, connection_id) REFERENCES app.ai_connections (account_id, id),
  CONSTRAINT assistant_engaged_by FOREIGN KEY (account_id, engaged_by) REFERENCES workforce.employees (account_id, id),
  CHECK (manager_id IS NULL OR manager_id <> id),
  CHECK ((kind = 'assistant') = (expires_at IS NOT NULL)),
  CONSTRAINT assistant_engagement CHECK ((kind = 'assistant') = (engaged_by IS NOT NULL) AND (kind = 'assistant') = (mission_scope IS NOT NULL) AND engaged_by IS DISTINCT FROM id)
);
-- A lead's live assistants (its quota), and an engagement's mission (released when it ends).
CREATE INDEX assistants_by_lead ON workforce.employees (account_id, engaged_by) WHERE kind = 'assistant' AND employment NOT IN ('archived', 'deleted');
CREATE INDEX assistants_by_mission ON workforce.employees (account_id, mission_scope) WHERE kind = 'assistant' AND employment NOT IN ('archived', 'deleted');
CREATE INDEX employees_by_department ON workforce.employees (account_id, department_id) WHERE employment NOT IN ('archived', 'deleted');
CREATE TRIGGER employees_account_fixed BEFORE UPDATE ON workforce.employees FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- APPOINTMENTS: the company's authority -- its CEO, a department's manager -- held by an existing employee; never a
-- title, instructions or a profile switch. One row per appointment, kept as history: at most one INCUMBENT (active or
-- suspended) per slot and per employee, a manager a member of its own department (checked at commit), and each slot's
-- appointments numbered by a counter on the slot's own row (offices.ceo_revision, departments.manager_revision), which
-- a command takes FOR UPDATE -- two appointments of one slot take turns. An appointment never changes who, where or
-- when, and one that ended stays ended.
CREATE TABLE workforce.appointments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  role text NOT NULL CONSTRAINT appointment_role CHECK (role IN ('ceo', 'manager')),
  department_id uuid,
  employee_id uuid NOT NULL,
  state text NOT NULL CONSTRAINT appointment_state CHECK (state IN ('active', 'suspended', 'revoked', 'replaced')),
  slot_revision integer NOT NULL CONSTRAINT appointment_slot_revision CHECK (slot_revision >= 1),
  replaces uuid,
  reason text NOT NULL DEFAULT '',
  appointed_by text NOT NULL,
  appointed_at timestamptz NOT NULL,
  ended_by text,
  ended_at timestamptz,
  end_reason text,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT appointment_account_id UNIQUE (account_id, id),
  CONSTRAINT appointment_department FOREIGN KEY (account_id, department_id) REFERENCES workforce.departments (account_id, id),
  CONSTRAINT appointment_employee FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id),
  CONSTRAINT appointment_replaces FOREIGN KEY (account_id, replaces) REFERENCES workforce.appointments (account_id, id),
  CONSTRAINT appointment_slot CHECK ((role = 'ceo') = (department_id IS NULL)),
  CONSTRAINT appointment_ended CHECK ((state IN ('revoked', 'replaced')) = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_incumbent_ceo ON workforce.appointments (account_id) WHERE role = 'ceo' AND state IN ('active', 'suspended');
CREATE UNIQUE INDEX one_incumbent_manager ON workforce.appointments (account_id, department_id) WHERE role = 'manager' AND state IN ('active', 'suspended');
CREATE UNIQUE INDEX one_appointment_per_employee ON workforce.appointments (account_id, employee_id) WHERE state IN ('active', 'suspended');
CREATE UNIQUE INDEX appointment_slot_revisions ON workforce.appointments (account_id, role, department_id, slot_revision) NULLS NOT DISTINCT;
CREATE TRIGGER appointments_account_fixed BEFORE UPDATE ON workforce.appointments FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();
CREATE FUNCTION workforce.appointment_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appointment % is history: it is never deleted', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.role <> OLD.role OR NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.employee_id <> OLD.employee_id OR NEW.slot_revision <> OLD.slot_revision
     OR NEW.replaces IS DISTINCT FROM OLD.replaces OR NEW.appointed_by <> OLD.appointed_by OR NEW.appointed_at <> OLD.appointed_at THEN
    RAISE EXCEPTION 'appointment % never changes who, where or when', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IN ('revoked', 'replaced') THEN
    RAISE EXCEPTION 'appointment % has ended', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_fixed BEFORE UPDATE OR DELETE ON workforce.appointments FOR EACH ROW EXECUTE FUNCTION workforce.appointment_fixed();

-- DELEGATION GRANTS: what lets an employee who holds no appointment give work to colleagues -- named employees or a
-- department's members -- given by a person, revoked by its state (the row stays as history).
CREATE TABLE workforce.delegation_grants (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  employee_id uuid NOT NULL,
  target_kind text NOT NULL CONSTRAINT delegation_target_kind CHECK (target_kind IN ('employee', 'department')),
  target_employee_id uuid,
  target_department_id uuid,
  state text NOT NULL CONSTRAINT delegation_state CHECK (state IN ('active', 'revoked')),
  note text NOT NULL DEFAULT '',
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_by text,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT delegation_account_id UNIQUE (account_id, id),
  CONSTRAINT delegation_grantee FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id),
  CONSTRAINT delegation_target_employee FOREIGN KEY (account_id, target_employee_id) REFERENCES workforce.employees (account_id, id),
  CONSTRAINT delegation_target_department FOREIGN KEY (account_id, target_department_id) REFERENCES workforce.departments (account_id, id),
  CONSTRAINT delegation_target CHECK ((target_kind = 'employee') = (target_employee_id IS NOT NULL) AND (target_kind = 'department') = (target_department_id IS NOT NULL)),
  CONSTRAINT delegation_not_self CHECK (target_employee_id IS DISTINCT FROM employee_id),
  CONSTRAINT delegation_revoked CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_live_delegation ON workforce.delegation_grants (account_id, employee_id, target_kind, COALESCE(target_employee_id, target_department_id)) WHERE state = 'active';
CREATE TRIGGER delegation_grants_account_fixed BEFORE UPDATE ON workforce.delegation_grants FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- An employee's profile, one immutable revision at a time (an assignment pins the one it was claimed under).
CREATE TABLE workforce.employee_profiles (
  account_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  profile jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  based_on integer,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, employee_id, revision),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);

-- An employee's resource profile (CPU, memory, storage), one immutable revision at a time (an attempt pins the one it
-- was admitted under).
CREATE TABLE workforce.employee_resources (
  account_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  profile jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, employee_id, revision),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);

-- The Personal Sandbox: an employee's persistent desk, toolbox and cache (volumes with quotas), never a running
-- container. READY only once every area exists, was written to, and its enforcement level is recorded with evidence.
CREATE TABLE workforce.sandboxes (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('PROVISIONING', 'READY', 'FAILED', 'ARCHIVED', 'DELETING', 'DELETED')),
  reason text,
  provider text NOT NULL CHECK (provider IN ('container', 'process')),
  areas jsonb NOT NULL,
  desk_version integer NOT NULL DEFAULT 0,
  provision_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  UNIQUE (account_id, employee_id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);

-- What an employee keeps in its toolbox (skills and scripts it wrote), by path and hash.
CREATE TABLE workforce.toolbox_items (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('skill', 'script')),
  path text NOT NULL,
  sha256 text NOT NULL,
  size bigint NOT NULL,
  author_run_id uuid,
  state text NOT NULL CHECK (state IN ('active', 'disabled', 'removed')),
  shared_from uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, employee_id, path),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);

CREATE TABLE workforce.missions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  title text NOT NULL,
  goal text NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'completed', 'cancelled', 'failed')),
  created_by text NOT NULL,
  acceptance_mode text NOT NULL CHECK (acceptance_mode IN ('owner_review', 'manager_review')),
  acceptance_criteria jsonb NOT NULL,
  deliverables jsonb NOT NULL,
  research_workspace_id text,
  source_revision_ids jsonb NOT NULL,
  deadline timestamptz,
  priority integer NOT NULL DEFAULT 5,
  plan_revision integer NOT NULL DEFAULT 1,
  schedule_id uuid,
  occurrence_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id)
);
CREATE INDEX missions_by_account ON workforce.missions (account_id, updated_at DESC, id);
CREATE TRIGGER missions_account_fixed BEFORE UPDATE ON workforce.missions FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

CREATE TABLE workforce.assignments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  parent_id uuid,
  unit_key text,
  employee_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED', 'ASSIGNED', 'RUNNING', 'WAITING_FOR_SUBORDINATES', 'ANSWERING', 'BLOCKED', 'PAUSED', 'RECOVERING', 'REVIEWING', 'AWAITING_ACCEPTANCE', 'CANCELLING', 'COMPLETED', 'CANCELLED', 'FAILED_FINAL')),
  reason text,
  waiting_on text,
  brief jsonb NOT NULL,
  execution jsonb,
  handoff_revision integer NOT NULL DEFAULT 0,
  rework_count integer NOT NULL DEFAULT 0,
  -- How many plans it gave and questions it asked (each bounded, ADR 0061 §8), and the state a pause or a block left, to
  -- return to it (a lead paused while it waits for its team waits again when resumed).
  plan_count integer NOT NULL DEFAULT 0 CONSTRAINT assignment_plan_count CHECK (plan_count >= 0),
  question_count integer NOT NULL DEFAULT 0 CONSTRAINT assignment_question_count CHECK (question_count >= 0),
  paused_from text,
  blocked_from text,
  -- What it was given to: an employee by name, a department (resolved to its manager) or the CEO, and the appointment
  -- that resolved it -- kept as it was when the work was given.
  target_kind text CONSTRAINT assignment_target_kind CHECK (target_kind IN ('employee', 'department', 'ceo')),
  target_department_id uuid,
  target_appointment_id uuid,
  target_appointment_revision integer,
  pinned jsonb,
  priority integer NOT NULL DEFAULT 5,
  eligible_at timestamptz NOT NULL,
  deadline timestamptz,
  -- Moves at every claim and attempt: a worker's write carries the fence it was given, and an older one is refused.
  fence bigint NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  -- A part's key is its lead's to name: unique among the parts of one lead (and one root per mission).
  CONSTRAINT unit_key_per_lead UNIQUE NULLS NOT DISTINCT (account_id, mission_id, parent_id, unit_key),
  CONSTRAINT assignment_target_department CHECK ((target_kind = 'department') = (target_department_id IS NOT NULL)),
  FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id),
  FOREIGN KEY (account_id, parent_id) REFERENCES workforce.assignments (account_id, id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);
CREATE UNIQUE INDEX one_root_per_mission ON workforce.assignments (account_id, mission_id) WHERE parent_id IS NULL;
CREATE INDEX assignments_queue ON workforce.assignments (account_id, employee_id, priority DESC, eligible_at, id) WHERE state = 'QUEUED';
CREATE INDEX assignments_by_mission ON workforce.assignments (account_id, mission_id);
CREATE INDEX assignments_by_employee ON workforce.assignments (account_id, employee_id, updated_at DESC);
CREATE TRIGGER assignments_account_fixed BEFORE UPDATE ON workforce.assignments FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- THE RESERVATION: an employee holds at most ONE assignment (the primary key), an assignment is held by at most one
-- reservation, and -- checked at commit -- an assignment in a holding state has exactly the reservation of its employee,
-- and one in QUEUED or a terminal state has none. Two requests can never both take a free employee.
CREATE TABLE workforce.reservations (
  account_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, employee_id),
  UNIQUE (account_id, assignment_id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id),
  FOREIGN KEY (account_id, assignment_id) REFERENCES workforce.assignments (account_id, id)
);

CREATE FUNCTION workforce.holds_employee(state text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT state NOT IN ('QUEUED', 'COMPLETED', 'CANCELLED', 'FAILED_FINAL')
$$;

CREATE FUNCTION workforce.reservation_matches() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  aid uuid;
  acc uuid;
  a_state text;
  a_employee uuid;
  r_employee uuid;
  has_reservation boolean;
BEGIN
  IF TG_TABLE_NAME = 'assignments' THEN
    aid := NEW.id; acc := NEW.account_id;
  ELSIF TG_OP = 'DELETE' THEN
    aid := OLD.assignment_id; acc := OLD.account_id;
  ELSE
    aid := NEW.assignment_id; acc := NEW.account_id;
  END IF;
  SELECT state, employee_id INTO a_state, a_employee FROM workforce.assignments WHERE account_id = acc AND id = aid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT employee_id INTO r_employee FROM workforce.reservations WHERE account_id = acc AND assignment_id = aid;
  has_reservation := FOUND;
  IF workforce.holds_employee(a_state) AND (NOT has_reservation OR r_employee <> a_employee) THEN
    RAISE EXCEPTION 'assignment % is % without the reservation of its employee', aid, a_state USING ERRCODE = 'P0001';
  END IF;
  IF NOT workforce.holds_employee(a_state) AND has_reservation THEN
    RAISE EXCEPTION 'assignment % is % and still holds a reservation', aid, a_state USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assignment_reservation AFTER INSERT OR UPDATE OF state, employee_id ON workforce.assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce.reservation_matches();
CREATE CONSTRAINT TRIGGER reservation_assignment AFTER INSERT OR UPDATE OR DELETE ON workforce.reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce.reservation_matches();

-- A HANDOVER moves an open assignment to another employee -- a person's act, never a side effect of a replaced
-- appointment -- only before or between attempts, and with a new fence (a result of the old holder's attempt is then
-- refused). The reservation moves with it (checked at commit by assignment_reservation).
CREATE FUNCTION workforce.assignment_holder_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    IF OLD.state NOT IN ('QUEUED', 'ASSIGNED', 'BLOCKED', 'PAUSED', 'WAITING_FOR_SUBORDINATES') THEN
      RAISE EXCEPTION 'assignment % is % and is not handed over', OLD.id, OLD.state USING ERRCODE = 'P0001';
    END IF;
    IF workforce.holds_employee(OLD.state) AND NEW.fence <= OLD.fence THEN
      RAISE EXCEPTION 'handing assignment % over moves its fence', OLD.id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_holder_moves BEFORE UPDATE OF employee_id ON workforce.assignments FOR EACH ROW EXECUTE FUNCTION workforce.assignment_holder_moves();

-- An ACCEPTED assignment's workspace, published to its employee's desk once (this row is that "once"). The next attempt
-- of the employee is prepared only after every accepted workspace of its reached the desk, so its next work starts from
-- what was accepted (its toolbox included).
CREATE TABLE workforce.desk_publications (
  account_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  published boolean NOT NULL,
  desk_version integer NOT NULL,
  changed jsonb NOT NULL,
  reason text,
  at timestamptz NOT NULL,
  PRIMARY KEY (account_id, assignment_id),
  FOREIGN KEY (account_id, assignment_id) REFERENCES workforce.assignments (account_id, id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);

-- A RUN: one attempt of an assignment, from the durable intent (requested) to its end. Its lease says which worker
-- drives it and until when; its fence is the assignment's at the attempt, and a result under an older fence is refused.
CREATE TABLE workforce.runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  state text NOT NULL CHECK (state IN ('requested', 'waiting_for_resources', 'unschedulable', 'starting', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled', 'unknown')),
  dispatch_key text NOT NULL UNIQUE,
  fence bigint NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  requested jsonb NOT NULL,
  resolved jsonb,
  observed jsonb,
  resource_revision integer,
  resources jsonb,
  usage jsonb,
  model_usage jsonb,
  sandbox jsonb,
  sandbox_handle jsonb,
  waiting_reason text,
  waiting_since timestamptz,
  priority integer NOT NULL DEFAULT 5,
  stop_requested text,
  -- Why this attempt was started: claimed, a revision, an answer, a question of its team to answer, its team to review,
  -- a resume, a retry.
  wake_reason text,
  started_at timestamptz,
  ended_at timestamptz,
  detail text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  UNIQUE (account_id, assignment_id, attempt_no),
  FOREIGN KEY (account_id, assignment_id) REFERENCES workforce.assignments (account_id, id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);
CREATE UNIQUE INDEX one_live_run ON workforce.runs (account_id, assignment_id) WHERE state IN ('requested', 'waiting_for_resources', 'unschedulable', 'starting', 'running', 'unknown');
CREATE INDEX runs_pending ON workforce.runs (waiting_since, id) WHERE state IN ('requested', 'waiting_for_resources', 'unschedulable');
CREATE INDEX runs_active ON workforce.runs (lease_until) WHERE state IN ('starting', 'running', 'unknown');
CREATE TRIGGER runs_account_fixed BEFORE UPDATE ON workforce.runs FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- What one run held of the account's and the host's compute (and scratch), from admission until its containers are
-- verified gone.
CREATE TABLE workforce.compute_reservations (
  account_id uuid NOT NULL,
  run_id uuid NOT NULL,
  cpu_millis integer NOT NULL CHECK (cpu_millis > 0),
  memory_mib integer NOT NULL CHECK (memory_mib > 0),
  scratch_mib integer NOT NULL CHECK (scratch_mib >= 0),
  model_plane jsonb NOT NULL,
  reserved_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  PRIMARY KEY (account_id, run_id),
  FOREIGN KEY (account_id, run_id) REFERENCES workforce.runs (account_id, id)
);
CREATE INDEX compute_held ON workforce.compute_reservations (account_id) WHERE released_at IS NULL;

-- A CONVERSATION RUN (Execution, ADR 0062): one bounded inference of an employee with no tool -- the CEO answering in
-- CEO Chat -- admitted by the same pass as the attempts (the host's and the account's compute, the account's
-- concurrency) and never at the same time as another run of its employee: an attempt waits for it, and it for an
-- attempt. It holds its compute from admission until its process is gone (released_at), and a lease names the process
-- that drives it: one whose lease ran out is interrupted, never run again.
CREATE TABLE workforce.conversation_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('requested', 'waiting', 'starting', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled')),
  requested jsonb NOT NULL,
  priority integer NOT NULL DEFAULT 5,
  cpu_millis integer,
  memory_mib integer,
  reserved_at timestamptz,
  released_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  stop_requested text,
  waiting_reason text,
  waiting_since timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  detail text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id),
  CONSTRAINT conversation_run_reserved CHECK ((reserved_at IS NULL) = (cpu_millis IS NULL) AND (cpu_millis IS NULL) = (memory_mib IS NULL))
);
CREATE UNIQUE INDEX one_live_conversation_run ON workforce.conversation_runs (account_id, employee_id) WHERE state IN ('starting', 'running');
CREATE INDEX conversation_runs_pending ON workforce.conversation_runs (waiting_since, id) WHERE state IN ('requested', 'waiting');
CREATE INDEX conversation_runs_live ON workforce.conversation_runs (lease_until) WHERE state IN ('starting', 'running');
CREATE TRIGGER conversation_runs_account_fixed BEFORE UPDATE ON workforce.conversation_runs FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- What the host can give employee containers: the SYSTEM account's one row. The admission pass locks it.
CREATE TABLE workforce.capacity (
  account_id uuid PRIMARY KEY REFERENCES app.accounts (id),
  source text NOT NULL CHECK (source IN ('detected', 'configured', 'unknown')),
  total jsonb NOT NULL,
  headroom jsonb NOT NULL,
  usable jsonb NOT NULL,
  storage jsonb NOT NULL,
  checked_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

-- An account's budget and the counters of what its attempts hold now (moved only under this row's lock).
CREATE TABLE workforce.budgets (
  account_id uuid PRIMARY KEY REFERENCES app.accounts (id),
  cpu_millis bigint NOT NULL CHECK (cpu_millis >= 0),
  memory_mib bigint NOT NULL CHECK (memory_mib >= 0),
  storage_mib bigint NOT NULL CHECK (storage_mib >= 0),
  max_concurrent integer NOT NULL CHECK (max_concurrent >= 0),
  per_employee jsonb NOT NULL,
  authorized jsonb NOT NULL,
  reserved_cpu_millis bigint NOT NULL DEFAULT 0 CHECK (reserved_cpu_millis >= 0),
  reserved_memory_mib bigint NOT NULL DEFAULT 0 CHECK (reserved_memory_mib >= 0),
  running integer NOT NULL DEFAULT 0 CHECK (running >= 0),
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1
);

-- Storage per category and owner: what is committed (a quota) and what is used (measured), with how it is enforced.
CREATE TABLE workforce.storage_usage (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  category text NOT NULL CHECK (category IN ('desk', 'cache', 'team', 'scratch', 'artifacts', 'research', 'logs')),
  owner_ref text NOT NULL,
  committed_mib bigint NOT NULL DEFAULT 0 CHECK (committed_mib >= 0),
  used_mib bigint,
  level text CHECK (level IN ('HARD_ENFORCED', 'SOFT_MONITORED', 'UNSUPPORTED')),
  evidence text,
  measured_at timestamptz,
  PRIMARY KEY (account_id, category, owner_ref)
);

-- Every connection an employee run opened through the egress proxy, and how much went each way.
CREATE TABLE workforce.run_connections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  run_id uuid NOT NULL,
  host text NOT NULL,
  port integer NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('allowed', 'refused', 'limited')),
  reason text,
  bytes_in bigint NOT NULL DEFAULT 0,
  bytes_out bigint NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  FOREIGN KEY (account_id, run_id) REFERENCES workforce.runs (account_id, id)
);
CREATE INDEX run_connections_by_run ON workforce.run_connections (account_id, run_id, id);

-- HANDOFFS: what an employee hands in, one immutable revision at a time; at most one is accepted per assignment.
CREATE TABLE workforce.handoffs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  run_id uuid,
  revision integer NOT NULL CHECK (revision >= 1),
  digest text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted', 'revision_requested', 'accepted', 'superseded')),
  claims jsonb NOT NULL,
  missing jsonb NOT NULL,
  submission_key text NOT NULL,
  submitted_by text NOT NULL,
  submitted_at timestamptz NOT NULL,
  review jsonb,
  UNIQUE (account_id, id),
  UNIQUE (account_id, assignment_id, revision),
  UNIQUE (account_id, submission_key),
  FOREIGN KEY (account_id, assignment_id) REFERENCES workforce.assignments (account_id, id)
);
CREATE UNIQUE INDEX one_acceptance ON workforce.handoffs (account_id, assignment_id) WHERE status = 'accepted';
-- A hand-in is kept as it was handed in: its content never changes, and a reviewed one keeps its status (v1 asked to
-- revise stays so beside v2 accepted).
CREATE FUNCTION workforce.handoff_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignment_id <> OLD.assignment_id OR NEW.revision <> OLD.revision OR NEW.digest <> OLD.digest OR NEW.summary <> OLD.summary OR NEW.claims <> OLD.claims
     OR NEW.missing <> OLD.missing OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.submission_key <> OLD.submission_key OR NEW.submitted_by <> OLD.submitted_by OR NEW.submitted_at <> OLD.submitted_at THEN
    RAISE EXCEPTION 'hand-in % is kept as it was handed in', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND OLD.status <> 'submitted' THEN
    RAISE EXCEPTION 'hand-in % was reviewed: its status stays %', OLD.id, OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.review IS DISTINCT FROM OLD.review AND OLD.review IS NOT NULL THEN
    RAISE EXCEPTION 'hand-in % keeps the review it was given', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handoff_fixed BEFORE UPDATE ON workforce.handoffs FOR EACH ROW EXECUTE FUNCTION workforce.handoff_fixed();

-- The bytes of artifacts, by content: counted once per account (never deduplicated across accounts).
CREATE TABLE workforce.blobs (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size bigint NOT NULL CHECK (size >= 0),
  refcount integer NOT NULL DEFAULT 0 CHECK (refcount >= 0),
  stored_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, sha256)
);

CREATE TABLE workforce.artifacts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deliverable', 'attachment')),
  media_type text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, handoff_id, name),
  FOREIGN KEY (account_id, handoff_id) REFERENCES workforce.handoffs (account_id, id),
  FOREIGN KEY (account_id, sha256) REFERENCES workforce.blobs (account_id, sha256)
);
CREATE FUNCTION workforce.artifact_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'artifact % is part of a hand-in: it never changes', OLD.id USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER artifact_fixed BEFORE UPDATE ON workforce.artifacts FOR EACH ROW EXECUTE FUNCTION workforce.artifact_fixed();

-- NEEDS ME: what waits for a person's decision, pinned to the version it was raised against.
CREATE TABLE workforce.decisions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('acceptance', 'information', 'external_action', 'reconciliation', 'delivery_channel', 'unschedulable', 'blocked', 'report')),
  state text NOT NULL CHECK (state IN ('open', 'resolved', 'expired', 'withdrawn')),
  mission_id uuid NOT NULL,
  assignment_id uuid,
  run_id uuid,
  delivery_id uuid,
  title text NOT NULL,
  reason text NOT NULL,
  waiting text,
  deadline timestamptz,
  pin jsonb NOT NULL,
  dedup_key text NOT NULL,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution text,
  resolved_by text,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id)
);
CREATE UNIQUE INDEX one_open_decision ON workforce.decisions (account_id, dedup_key) WHERE state = 'open';
CREATE INDEX decisions_open ON workforce.decisions (account_id, created_at DESC) WHERE state = 'open';

-- THE OUTBOX JOURNAL: integration events written in the transaction of the change they report. A consumer records each
-- event it handled in its inbox, in the transaction of its own effect: delivered at least once, applied once.
CREATE TABLE workforce.events (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  type text NOT NULL,
  schema_version integer NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL,
  ordinal integer NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  mission_id uuid,
  payload jsonb NOT NULL,
  UNIQUE (aggregate_id, aggregate_version, ordinal)
);
CREATE INDEX events_by_seq ON workforce.events (seq);
CREATE INDEX events_by_mission ON workforce.events (account_id, mission_id, seq) WHERE mission_id IS NOT NULL;

CREATE TABLE workforce.consumer_inbox (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  consumer_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES workforce.events (id),
  processed_at timestamptz NOT NULL,
  -- 'done', or 'dead': it failed every retry (its reason kept) and is set aside for a person.
  outcome text NOT NULL DEFAULT 'done' CHECK (outcome IN ('done', 'dead')),
  error text,
  attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY (consumer_id, event_id)
);

-- A command with a side effect answers the same result to the same key and request, and a conflict to the same key and
-- another request.
CREATE TABLE workforce.idempotency_keys (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  actor text NOT NULL,
  operation text NOT NULL,
  key text NOT NULL,
  request_digest text NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, actor, operation, key)
);

-- A mission's team rooms: the shared workbench of the assignments of one mission, one per data domain (never evidence).
-- A team room is per mission AND per data domain (room_key): the members of one department working on a mission share
-- theirs (department:<id>, the department at dispatch); the employees of no department share the company's (company).
-- An attempt mounts the room of its own key alone, so nothing of one department's working files reaches another's
-- attempts: what crosses departments is a hand-in, shared on purpose (data_shares).
CREATE TABLE workforce.team_rooms (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  room_key text NOT NULL,
  department_id uuid,
  quota_mib integer NOT NULL CHECK (quota_mib > 0),
  state text NOT NULL CHECK (state IN ('open', 'frozen')),
  created_at timestamptz NOT NULL,
  frozen_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  CONSTRAINT one_room_per_key UNIQUE (account_id, mission_id, room_key),
  CONSTRAINT team_room_key CHECK (room_key = 'company' OR room_key ~ '^department:[0-9a-f-]{36}$'),
  CONSTRAINT team_room_key_department CHECK ((room_key = 'company') = (department_id IS NULL)),
  FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id),
  CONSTRAINT team_room_department FOREIGN KEY (account_id, department_id) REFERENCES workforce.departments (account_id, id)
);

-- What changed in a team room, and which attempt changed it: read from the room after every attempt that had it (an
-- attempt's changes are the difference between the room before and after it). A row per change; null sha: removed.
CREATE TABLE workforce.team_room_changes (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  room_id uuid NOT NULL,
  path text NOT NULL,
  sha256 text,
  size bigint,
  run_id uuid,
  assignment_id uuid,
  employee_id uuid,
  changed_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, room_id) REFERENCES workforce.team_rooms (account_id, id)
);
CREATE INDEX team_room_changes_by_room ON workforce.team_room_changes (account_id, room_id, path, seq);

-- What an employee (or a mission) may do with an external connection, typed, scoped, revocable.
CREATE TABLE workforce.connection_grants (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  grantee_kind text NOT NULL CHECK (grantee_kind IN ('employee', 'mission')),
  grantee_id uuid NOT NULL,
  operation text NOT NULL,
  scope jsonb NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id)
);

-- SCHEDULES: the rule that makes recurring work, its revisions, the periods it made (one per period), and deliveries.
CREATE TABLE workforce.schedules (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  name text NOT NULL,
  rule jsonb NOT NULL,
  employee_id uuid NOT NULL,
  template jsonb NOT NULL,
  recipients jsonb NOT NULL,
  missed_policy text NOT NULL CHECK (missed_policy IN ('catch_up_latest', 'catch_up_each', 'skip')),
  catch_up_limit integer NOT NULL CHECK (catch_up_limit BETWEEN 1 AND 8),
  state text NOT NULL CHECK (state IN ('active', 'paused')),
  revision integer NOT NULL DEFAULT 1,
  next_due_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id)
);
CREATE INDEX schedules_due ON workforce.schedules (next_due_at) WHERE state = 'active';

CREATE TABLE workforce.schedule_revisions (
  account_id uuid NOT NULL,
  schedule_id uuid NOT NULL,
  revision integer NOT NULL,
  document jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, schedule_id, revision),
  FOREIGN KEY (account_id, schedule_id) REFERENCES workforce.schedules (account_id, id)
);

CREATE TABLE workforce.occurrences (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  schedule_id uuid NOT NULL,
  period_key text NOT NULL,
  due_at timestamptz NOT NULL,
  schedule_revision integer NOT NULL,
  state text NOT NULL CHECK (state IN ('created', 'skipped')),
  mission_id uuid,
  reason text,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, schedule_id, period_key),
  FOREIGN KEY (account_id, schedule_id) REFERENCES workforce.schedules (account_id, id),
  FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id)
);

CREATE TABLE workforce.deliveries (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  digest text NOT NULL,
  recipient jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING_CHANNEL', 'PENDING', 'SENDING', 'SENT', 'NEEDS_RECONCILIATION', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  receipt text,
  detail text,
  idempotency_key text NOT NULL,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (account_id, id),
  UNIQUE (account_id, idempotency_key),
  FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id),
  FOREIGN KEY (account_id, handoff_id) REFERENCES workforce.handoffs (account_id, id)
);

-- An INCUMBENT appointment (active or suspended) stays true to its employee and its slot, checked at commit whatever
-- changed: its employee is in the office (not archived or deleted), a manager is a member of its department, which is
-- not archived, and the CEO belongs to no department. A move, an archive or an appointment that would break it is
-- refused whole.
CREATE FUNCTION workforce.appointment_matches() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad uuid;
BEGIN
  SELECT a.id INTO bad
  FROM workforce.appointments a
  JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
  LEFT JOIN workforce.departments d ON d.account_id = a.account_id AND d.id = a.department_id
  WHERE a.account_id = NEW.account_id
    AND a.state IN ('active', 'suspended')
    AND (e.employment IN ('archived', 'deleted') OR (a.role = 'manager' AND (e.department_id IS DISTINCT FROM a.department_id OR d.archived_at IS NOT NULL))
         OR (a.role = 'ceo' AND e.department_id IS NOT NULL))
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'appointment % no longer matches its employee or its department', bad USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER appointment_holds AFTER INSERT OR UPDATE ON workforce.appointments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce.appointment_matches();
CREATE CONSTRAINT TRIGGER employee_appointment_holds AFTER UPDATE OF department_id, employment ON workforce.employees DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce.appointment_matches();
CREATE CONSTRAINT TRIGGER department_appointment_holds AFTER UPDATE OF archived_at ON workforce.departments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce.appointment_matches();

-- WHAT A LEAD SHARES WITH A PART OF ITS TEAM, on purpose: a source revision of the mission it holds itself, or the
-- ACCEPTED hand-in of a part this one waits for -- its summary, or in full. Recorded with what, to whom and from where;
-- revoked by its state. Nothing else of one part reaches another (each attempt's inputs are worked out from this).
CREATE TABLE workforce.data_shares (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  mission_id uuid NOT NULL,
  recipient_assignment_id uuid NOT NULL,
  lead_assignment_id uuid NOT NULL,
  kind text NOT NULL CONSTRAINT data_share_kind CHECK (kind IN ('source', 'handoff')),
  source_revision_id text,
  origin_assignment_id uuid,
  mode text NOT NULL CONSTRAINT data_share_mode CHECK (mode IN ('summary', 'full')),
  shared_by text NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_by text,
  revoked_at timestamptz,
  CONSTRAINT data_share_account_id UNIQUE (account_id, id),
  CONSTRAINT data_share_mission FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id),
  CONSTRAINT data_share_recipient FOREIGN KEY (account_id, recipient_assignment_id) REFERENCES workforce.assignments (account_id, id),
  CONSTRAINT data_share_lead FOREIGN KEY (account_id, lead_assignment_id) REFERENCES workforce.assignments (account_id, id),
  CONSTRAINT data_share_origin FOREIGN KEY (account_id, origin_assignment_id) REFERENCES workforce.assignments (account_id, id),
  CONSTRAINT data_share_ref CHECK ((kind = 'source') = (source_revision_id IS NOT NULL) AND (kind = 'handoff') = (origin_assignment_id IS NOT NULL))
);
CREATE INDEX data_shares_by_recipient ON workforce.data_shares (account_id, recipient_assignment_id) WHERE revoked_at IS NULL;

-- WHAT ONE ATTEMPT WAS GIVEN TO READ, and why each (its mission, a share, supervision of its parts, a repository): written
-- before the attempt starts; the input reader serves an attempt only what its own manifest names.
CREATE TABLE workforce.attempt_inputs (
  account_id uuid NOT NULL,
  run_id uuid NOT NULL,
  name text NOT NULL,
  store_path text NOT NULL,
  origin text NOT NULL CONSTRAINT attempt_input_origin CHECK (origin IN ('mission', 'share', 'supervision', 'repository')),
  ref text,
  staged_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, run_id, name),
  CONSTRAINT attempt_input_run FOREIGN KEY (account_id, run_id) REFERENCES workforce.runs (account_id, id)
);
CREATE INDEX attempt_inputs_by_path ON workforce.attempt_inputs (account_id, run_id, store_path);

-- A QUESTION one assignment asked (ADR 0061 §8): a part asks its LEAD (the assignment it is a part of); the root asks the
-- person who gave the work. A lead answers it, or moves it one level up saying why; the owner is asked only at the root,
-- or for what is a person's (human_decision, beyond_authority, deadline, unanswered). One open question per asker; it is
-- answered once (the asker resumes once), or withdrawn with its asker's end.
CREATE TABLE workforce.clarifications (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  mission_id uuid NOT NULL,
  asker_assignment_id uuid NOT NULL,
  asker_fence bigint NOT NULL,
  question text NOT NULL CONSTRAINT clarification_question CHECK (length(question) BETWEEN 1 AND 4000),
  addressee text NOT NULL CONSTRAINT clarification_addressee CHECK (addressee IN ('lead', 'owner')),
  addressee_assignment_id uuid,
  kind text NOT NULL CONSTRAINT clarification_kind CHECK (kind IN ('information', 'human_decision', 'beyond_authority', 'deadline', 'unanswered')),
  state text NOT NULL CONSTRAINT clarification_state CHECK (state IN ('open', 'answered', 'withdrawn')),
  answer text,
  answered_by text,
  answered_at timestamptz,
  -- How often its addressee now was woken for it without answering (WORKFORCE_LIMITS.answerWakes).
  wakes integer NOT NULL DEFAULT 0 CONSTRAINT clarification_wakes CHECK (wakes >= 0),
  due_at timestamptz,
  asked_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT clarification_account_id UNIQUE (account_id, id),
  CONSTRAINT clarification_to_lead CHECK ((addressee = 'lead') = (addressee_assignment_id IS NOT NULL)),
  CONSTRAINT clarification_answered CHECK ((state = 'answered') = (answer IS NOT NULL AND answered_at IS NOT NULL)),
  CONSTRAINT clarification_mission FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id),
  CONSTRAINT clarification_asker FOREIGN KEY (account_id, asker_assignment_id) REFERENCES workforce.assignments (account_id, id),
  CONSTRAINT clarification_lead FOREIGN KEY (account_id, addressee_assignment_id) REFERENCES workforce.assignments (account_id, id)
);
CREATE UNIQUE INDEX one_open_clarification ON workforce.clarifications (account_id, asker_assignment_id) WHERE state = 'open';
CREATE INDEX clarifications_to_lead ON workforce.clarifications (account_id, addressee_assignment_id) WHERE state = 'open';
CREATE TRIGGER clarifications_account_fixed BEFORE UPDATE ON workforce.clarifications FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- Every hop of a question, appended (never changed): to whom it went, why and when.
CREATE TABLE workforce.clarification_routes (
  account_id uuid NOT NULL,
  clarification_id uuid NOT NULL,
  seq integer NOT NULL CONSTRAINT clarification_route_seq CHECK (seq >= 1),
  addressee text NOT NULL CONSTRAINT clarification_route_addressee CHECK (addressee IN ('lead', 'owner')),
  addressee_assignment_id uuid,
  why text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (account_id, clarification_id, seq),
  CONSTRAINT clarification_route_of FOREIGN KEY (account_id, clarification_id) REFERENCES workforce.clarifications (account_id, id)
);
CREATE FUNCTION workforce.route_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a question''s route is appended, never changed' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER clarification_route_fixed BEFORE UPDATE OR DELETE ON workforce.clarification_routes FOR EACH ROW EXECUTE FUNCTION workforce.route_fixed();

-- A DEPARTMENT'S POLICY: what one department decides for its employees' work, inside what the company delegated to it
-- (governance-core department.ts). Its revisions mirror the company's -- DRAFT, VALIDATED, PUBLISHED, SUPERSEDED or
-- DISCARDED; one PUBLISHED per department; a published one never changes (the same trigger) -- numbered per department
-- from its head row, and each publication names the company revision it was confirmed against. A department with no
-- published policy inherits the company's.
CREATE TABLE governance.department_policy_heads (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  department_id uuid NOT NULL,
  last_revision integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, department_id),
  CONSTRAINT department_policy_head_department FOREIGN KEY (account_id, department_id) REFERENCES workforce.departments (account_id, id)
);

CREATE TABLE governance.department_policy_revisions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  department_id uuid NOT NULL,
  revision integer,
  state text NOT NULL CONSTRAINT department_policy_state CHECK (state IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'DISCARDED')),
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
  confirmed_company_base text,
  confirmed_risk text,
  confirmed_by text,
  confirmed_at timestamptz,
  published_at timestamptz,
  published_by text,
  superseded_at timestamptz,
  CONSTRAINT department_policy_account_id UNIQUE (account_id, id),
  CONSTRAINT department_policy_numbers UNIQUE (account_id, department_id, revision),
  CONSTRAINT department_policy_department FOREIGN KEY (account_id, department_id) REFERENCES workforce.departments (account_id, id)
);
CREATE UNIQUE INDEX one_department_policy_in_effect ON governance.department_policy_revisions (account_id, department_id) WHERE state = 'PUBLISHED';
CREATE TRIGGER department_policy_revisions_account_fixed BEFORE UPDATE ON governance.department_policy_revisions FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();
CREATE TRIGGER department_policy_revisions_published BEFORE UPDATE OR DELETE ON governance.department_policy_revisions FOR EACH ROW EXECUTE FUNCTION governance.published_never_changes();
CREATE FUNCTION governance.department_policy_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    RAISE EXCEPTION 'a department policy revision never moves to another department' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER department_policy_revisions_fixed BEFORE UPDATE ON governance.department_policy_revisions FOR EACH ROW EXECUTE FUNCTION governance.department_policy_fixed();
ALTER TABLE governance.run_bindings ADD CONSTRAINT run_binding_department_revision FOREIGN KEY (account_id, department_revision) REFERENCES governance.department_policy_revisions (account_id, id);
`;

const EXECUTIVE = String.raw`
-- ===================================================================================================================
-- CEO CHAT (executive, ADR 0062): the company owner's conversations with the AI CEO. A conversation is the company's,
-- never a CEO's; a CEO message keeps the employee, the appointment and the revision it answered under; a turn is one
-- answer, by the CEO in office when it was asked, run as a conversation run (workforce.conversation_runs); a mission given
-- from a conversation is linked to it and to the message it came from. A conversation's events are its own journal,
-- numbered by its last_seq and replayed to a client that reconnects.
-- ===================================================================================================================
CREATE SCHEMA executive;

CREATE TABLE executive.conversations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  office_id uuid NOT NULL,
  title text NOT NULL,
  created_by_user uuid NOT NULL REFERENCES app.users (id),
  last_seq bigint NOT NULL DEFAULT 0,
  next_position bigint NOT NULL DEFAULT 1,
  messages integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT conversation_account_id UNIQUE (account_id, id),
  FOREIGN KEY (account_id, office_id) REFERENCES workforce.offices (account_id, id)
);
CREATE INDEX conversations_recent ON executive.conversations (account_id, last_message_at DESC NULLS LAST, id);
CREATE TRIGGER conversations_account_fixed BEFORE UPDATE ON executive.conversations FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- A message: the owner's (its user), the CEO's (its employee, appointment and revision: kept when the CEO changes), or
-- Orbit's records (a report, a notice). Its words are written once; only a proposal's state and its mission move.
CREATE TABLE executive.messages (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  position bigint NOT NULL CHECK (position >= 1),
  role text NOT NULL CHECK (role IN ('owner', 'ceo', 'system')),
  author_name text NOT NULL,
  user_id uuid REFERENCES app.users (id),
  employee_id uuid,
  appointment_id uuid,
  appointment_revision integer,
  text text NOT NULL,
  partial boolean NOT NULL DEFAULT false,
  model text,
  effort text,
  report jsonb,
  proposal jsonb,
  proposal_state text CHECK (proposal_state IN ('open', 'given', 'dismissed')),
  proposal_note text,
  mission_id uuid,
  turn_id uuid,
  notice_key text,
  created_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT message_account_id UNIQUE (account_id, id),
  CONSTRAINT message_position UNIQUE (conversation_id, position),
  FOREIGN KEY (account_id, conversation_id) REFERENCES executive.conversations (account_id, id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id),
  FOREIGN KEY (account_id, appointment_id) REFERENCES workforce.appointments (account_id, id),
  FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id),
  CONSTRAINT message_owner CHECK ((role = 'owner') = (user_id IS NOT NULL)),
  CONSTRAINT message_ceo CHECK ((role = 'ceo') = (employee_id IS NOT NULL AND appointment_id IS NOT NULL AND appointment_revision IS NOT NULL)),
  CONSTRAINT message_report CHECK (report IS NULL OR role = 'system'),
  CONSTRAINT message_proposal CHECK ((proposal IS NULL) = (proposal_state IS NULL) AND (proposal IS NULL OR role = 'ceo'))
);
CREATE UNIQUE INDEX one_notice ON executive.messages (account_id, notice_key) WHERE notice_key IS NOT NULL;
CREATE TRIGGER messages_account_fixed BEFORE UPDATE ON executive.messages FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- A TURN: one answer of the CEO to the owner's messages since its last one -- by the CEO in office when they were sent
-- (its appointment and revision: a CEO replaced before it ran does not answer for the new one, nor the new one for it).
-- One waits (queued or waiting) and one runs at a time per conversation. context: the records it was given.
CREATE TABLE executive.turns (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  request_message_id uuid NOT NULL,
  response_message_id uuid,
  employee_id uuid NOT NULL,
  author_name text NOT NULL,
  appointment_id uuid NOT NULL,
  appointment_revision integer NOT NULL,
  run_id uuid,
  kind text NOT NULL DEFAULT 'answer' CHECK (kind IN ('answer', 'staffing', 'profile')),
  state text NOT NULL CHECK (state IN ('queued', 'waiting', 'running', 'completed', 'failed', 'interrupted', 'cancelled')),
  waiting_reason text,
  code text,
  detail text,
  context jsonb,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT turn_account_id UNIQUE (account_id, id),
  FOREIGN KEY (account_id, conversation_id) REFERENCES executive.conversations (account_id, id),
  FOREIGN KEY (account_id, request_message_id) REFERENCES executive.messages (account_id, id),
  FOREIGN KEY (account_id, response_message_id) REFERENCES executive.messages (account_id, id),
  FOREIGN KEY (account_id, employee_id) REFERENCES workforce.employees (account_id, id),
  FOREIGN KEY (account_id, appointment_id) REFERENCES workforce.appointments (account_id, id),
  FOREIGN KEY (account_id, run_id) REFERENCES workforce.conversation_runs (account_id, id)
);
CREATE UNIQUE INDEX one_pending_turn ON executive.turns (account_id, conversation_id) WHERE state IN ('queued', 'waiting');
CREATE UNIQUE INDEX one_running_turn ON executive.turns (account_id, conversation_id) WHERE state = 'running';
CREATE INDEX turns_of_conversation ON executive.turns (account_id, conversation_id, created_at);
CREATE TRIGGER turns_account_fixed BEFORE UPDATE ON executive.turns FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();
ALTER TABLE executive.messages ADD CONSTRAINT message_turn FOREIGN KEY (account_id, turn_id) REFERENCES executive.turns (account_id, id);

-- A mission given to the CEO from a conversation: the link lives on the conversation's side (a mission is the Work's).
CREATE TABLE executive.mission_links (
  account_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, mission_id),
  FOREIGN KEY (account_id, mission_id) REFERENCES workforce.missions (account_id, id),
  FOREIGN KEY (account_id, conversation_id) REFERENCES executive.conversations (account_id, id),
  FOREIGN KEY (account_id, message_id) REFERENCES executive.messages (account_id, id)
);
CREATE INDEX mission_links_of_conversation ON executive.mission_links (account_id, conversation_id, linked_at);

-- THE OWNER'S HIRING REQUESTS (ADR 0062, staffing): what the owner asked and within which bounds, the CEO's turn that
-- plans it, and what was carried out -- once, on the authority of the person who asked (their user, and the session they
-- asked from). A plan is read only from that turn; its state moves out of planning once, in one transaction.
CREATE TABLE executive.staffing_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  requested_by_user uuid NOT NULL REFERENCES app.users (id),
  requested_by_session uuid NOT NULL,
  requirement text NOT NULL,
  department_id uuid,
  execution jsonb NOT NULL,
  resources jsonb NOT NULL,
  max_hires integer NOT NULL CHECK (max_hires BETWEEN 1 AND 10),
  state text NOT NULL CHECK (state IN ('planning', 'hired', 'refused', 'failed')),
  plan jsonb,
  outcome jsonb,
  report_message_id uuid,
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT staffing_account_id UNIQUE (account_id, id),
  CONSTRAINT one_staffing_per_turn UNIQUE (account_id, turn_id),
  CONSTRAINT staffing_ends_once CHECK ((state = 'planning') = (ended_at IS NULL)),
  FOREIGN KEY (account_id, conversation_id) REFERENCES executive.conversations (account_id, id),
  FOREIGN KEY (account_id, turn_id) REFERENCES executive.turns (account_id, id),
  FOREIGN KEY (account_id, department_id) REFERENCES workforce.departments (account_id, id),
  FOREIGN KEY (account_id, report_message_id) REFERENCES executive.messages (account_id, id)
);
CREATE INDEX staffing_of_account ON executive.staffing_requests (account_id, created_at DESC);
CREATE TRIGGER staffing_account_fixed BEFORE UPDATE ON executive.staffing_requests FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- PROFILE DRAFTS (ADR 0062): one employee's profile, drafted by the CEO from the owner's description of the job, for a
-- form the owner fills (Hire, an employee's profile) -- it hires nobody. The draft as Orbit read it from the CEO's answer.
CREATE TABLE executive.profile_drafts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  requested_by_user uuid NOT NULL REFERENCES app.users (id),
  description text NOT NULL,
  title text NOT NULL,
  department_id uuid,
  state text NOT NULL CHECK (state IN ('drafting', 'ready', 'failed')),
  draft jsonb,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT draft_account_id UNIQUE (account_id, id),
  CONSTRAINT one_draft_per_turn UNIQUE (account_id, turn_id),
  CONSTRAINT draft_ends_once CHECK ((state = 'drafting') = (ended_at IS NULL)),
  CONSTRAINT draft_when_ready CHECK ((state = 'ready') = (draft IS NOT NULL)),
  FOREIGN KEY (account_id, conversation_id) REFERENCES executive.conversations (account_id, id),
  FOREIGN KEY (account_id, turn_id) REFERENCES executive.turns (account_id, id),
  FOREIGN KEY (account_id, department_id) REFERENCES workforce.departments (account_id, id)
);
CREATE TRIGGER drafts_account_fixed BEFORE UPDATE ON executive.profile_drafts FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

-- THE JOURNAL of a conversation's stream: what a client that reconnects is replayed after its Last-Event-ID.
CREATE TABLE executive.events (
  account_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  seq bigint NOT NULL,
  turn_id uuid,
  type text NOT NULL,
  data jsonb NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, seq),
  FOREIGN KEY (account_id, conversation_id) REFERENCES executive.conversations (account_id, id)
);
`;

const ARTIFACT_PROVENANCE = String.raw`
-- Tracks direct child artifact lineage when a lead attaches a reviewed subordinate artifact by reference (byte-for-byte).
ALTER TABLE workforce.artifacts
  ADD COLUMN source_artifact_id uuid,
  ADD CONSTRAINT artifacts_source_fk FOREIGN KEY (account_id, source_artifact_id) REFERENCES workforce.artifacts (account_id, id);
CREATE INDEX artifacts_by_source ON workforce.artifacts (account_id, source_artifact_id) WHERE source_artifact_id IS NOT NULL;
`;

// RUNTIME SECURITY (Orbit Web 0.8.1, ADR 0063). An attempt's protection -- a lifecycle of its own, never the
// assignment's state -- as the allocator reports it; what the sensor reported, attributed by the allocator to one account
// and kept bounded (per run, and by age); the incidents a person reviews, and what was done about each (history: never
// changed). Raw kernel events never reach the audit chain -- only the decisions about them do. The host's probe is kept
// beside its capacity.
const RUNTIME_SECURITY = String.raw`
CREATE SCHEMA security;

CREATE TABLE security.protections (
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  run_id uuid NOT NULL,
  dispatch_key text NOT NULL,
  fence bigint NOT NULL,
  employee_id uuid,
  assignment_id uuid,
  mode text NOT NULL CHECK (mode IN ('disabled', 'observe', 'enforce')),
  state text NOT NULL CHECK (state IN ('UNREGISTERED', 'REGISTERED', 'POLICY_APPLIED', 'VERIFIED', 'PROTECTED', 'OBSERVING', 'DEGRADED', 'CONTAINING', 'CONTAINED', 'UNKNOWN', 'CLEANED_UP')),
  evidence jsonb NOT NULL,
  -- When the allocator last said it: an older report never replaces a newer one.
  reported_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, run_id),
  FOREIGN KEY (account_id, run_id) REFERENCES workforce.runs (account_id, id)
);
CREATE INDEX protections_by_state ON security.protections (account_id, state, updated_at DESC);
CREATE TRIGGER protections_account_never_moves BEFORE UPDATE ON security.protections FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

CREATE TABLE security.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  event_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  run_kind text NOT NULL CHECK (run_kind IN ('assignment', 'chat', 'research', 'executive')),
  run_id text NOT NULL,
  employee_id uuid,
  kind text NOT NULL CHECK (kind IN ('process.exec', 'process.exit', 'control.match', 'exec.fileless', 'exec.model_plane', 'identity.mismatch', 'telemetry.gap', 'workload.contained')),
  outcome text NOT NULL CHECK (outcome IN ('OBSERVED', 'VIOLATION_DETECTED', 'OPERATION_PREVENTED', 'PROCESS_TERMINATED', 'WORKLOAD_CONTAINED')),
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  plane text CHECK (plane IN ('tool-plane', 'model-plane', 'session-plane')),
  binary_path text,
  parent_binary text,
  target_path text,
  control text,
  exec_id text,
  parent_exec_id text,
  exit_code integer,
  signal text,
  -- A gap marker's: how many events of this run were not kept (its cap) or were lost before Orbit Web read them.
  dropped integer,
  UNIQUE (account_id, event_key)
);
CREATE INDEX events_by_time ON security.events (account_id, occurred_at DESC);
CREATE INDEX events_by_run ON security.events (account_id, run_id, occurred_at);
CREATE INDEX events_by_outcome ON security.events (account_id, outcome, occurred_at DESC) WHERE outcome <> 'OBSERVED';

CREATE TABLE security.incidents (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES app.accounts (id),
  -- One incident per cause per attempt: a repeat raises its count, never a second incident.
  fingerprint text NOT NULL,
  category text NOT NULL CHECK (category IN ('unexpected_process', 'restricted_operation', 'policy_violation', 'identity_mismatch', 'policy_drift', 'protection_missing', 'sensor_failure', 'telemetry_loss', 'containment_failure')),
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  state text NOT NULL CHECK (state IN ('OPEN', 'INVESTIGATING', 'CONTAINING', 'CONTAINED', 'RESOLVED')),
  title text NOT NULL,
  run_id uuid,
  assignment_id uuid,
  mission_id uuid,
  employee_id uuid,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  -- While true, a person's Retry of the assignment is refused until a review authorizes it.
  blocks_retry boolean NOT NULL,
  evidence jsonb NOT NULL,
  review jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, fingerprint)
);
CREATE INDEX incidents_open ON security.incidents (account_id, state, last_seen DESC);
CREATE INDEX incidents_holding ON security.incidents (account_id, assignment_id) WHERE blocks_retry;
CREATE TRIGGER incidents_account_never_moves BEFORE UPDATE ON security.incidents FOR EACH ROW EXECUTE FUNCTION app.account_never_moves();

CREATE TABLE security.incident_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  incident_id text NOT NULL,
  at timestamptz NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  outcome text NOT NULL,
  detail text,
  FOREIGN KEY (account_id, incident_id) REFERENCES security.incidents (account_id, id)
);
CREATE INDEX incident_actions_by_incident ON security.incident_actions (account_id, incident_id, id);
CREATE FUNCTION security.actions_never_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'what was done about an incident is history: never changed, never removed' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER incident_actions_never_change BEFORE UPDATE OR DELETE ON security.incident_actions FOR EACH ROW EXECUTE FUNCTION security.actions_never_change();

-- Where Orbit Web stands in the allocator's stream (its epoch and cursor), and what the stream said of itself.
CREATE TABLE security.feed (
  id smallint PRIMARY KEY CHECK (id = 1),
  epoch text,
  seq bigint NOT NULL DEFAULT 0,
  sensor jsonb,
  lost bigint NOT NULL DEFAULT 0,
  unattributed bigint NOT NULL DEFAULT 0,
  gaps bigint NOT NULL DEFAULT 0,
  canary_proven_at timestamptz,
  last_event_at timestamptz,
  updated_at timestamptz NOT NULL
);

ALTER TABLE workforce.capacity ADD COLUMN runtime_security jsonb;
`;

// 0.8.0 is Orbit Web's first PostgreSQL release: ONE initial migration (the owner's decision -- no database of an earlier
// build is upgraded; `cli/db.js reset` empties one). Later releases add migrations after it.
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `${INITIAL}
${WORKFORCE}
${EXECUTIVE}`,
  },
  {
    version: 2,
    name: "artifact_provenance",
    sql: ARTIFACT_PROVENANCE,
  },
  {
    version: 3,
    name: "runtime_security",
    sql: RUNTIME_SECURITY,
  },
];
