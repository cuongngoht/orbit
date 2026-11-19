// Status words. Each list is the whole vocabulary of its field: the API never sends a word outside it and the web
// app never invents one.

// A chat session. `running` means a Claude Code process is alive for it right now; the three outcomes after it are
// what the LAST run came to, decided from the process's real exit and its own result line, never from the text the
// model wrote. `interrupted` is never `completed`.
export const SESSION_STATUSES = [
  "preparing",
  "ready",
  "running",
  "completed",
  "failed",
  "interrupted",
  "setup_failed",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

// The statuses a new message may be sent from.
export const ACCEPTS_MESSAGES: readonly SessionStatus[] = ["ready", "completed", "failed", "interrupted"];

// One sign-in flow of an official CLI (`claude auth login`, `gh auth login`), driven as a process.
export const LOGIN_STATES = [
  "idle",
  "starting",
  "awaiting_user",
  "verifying",
  "connected",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type LoginState = (typeof LOGIN_STATES)[number];

export const LOGIN_ACTIVE: readonly LoginState[] = ["starting", "awaiting_user", "verifying"];

// What the CLI's own status command said about an account.
export const CONNECTION_STATES = ["connected", "not_connected", "expired", "unavailable"] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const THEMES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEMES)[number];
