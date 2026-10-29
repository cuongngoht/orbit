// What the Authentication card SAYS about a session, in one place and in a person's words. The strategy's own label and
// documentation come from the provider's descriptor (data), so nothing here names a provider, a vendor or a program: a
// sentence says "the program that holds the sign-in", and the descriptor says which one it is.
//
// The engine reports a session by a STATE, and the page keeps it that way: an access token that ran out is never the news (one
// is asked for each time it is needed, and replaced by itself), so there is no "login expired" here -- only the session
// ending is said, as "needs a person again".
import { ApiError } from "../../shared/api/client";
import { formatRelative } from "../../shared/format";
import type { AuthState, AuthTool, ConnectionTest } from "./connections.types";

export type Tone = "success" | "danger" | "warning" | "informative";

export interface Words {
  label: string;
  tone: Tone;
  says: string;
}

export const NOT_CHECKED: Words = { label: "Not checked yet", tone: "informative", says: "Nothing has been started. Press Check to ask whether the program is here and a sign-in exists." };

// The sign-in is as unknown as the program is, and that is said once.
const NOT_CHECKED_SIGN_IN: Words = { ...NOT_CHECKED, says: "" };

// One row per state the engine reports for a strategy that signs in.
export const SESSION_WORDS: Record<string, Words> = {
  "sign-in-required": { label: "Sign-in required", tone: "warning", says: "No one has signed in for Orbit on this machine, or the session was ended. Press Sign in." },
  authenticated: { label: "Signed in", tone: "success", says: "A sign-in exists. Orbit asks the program for a short-lived access token each time it needs one, and keeps none." },
  "interaction-required": { label: "Needs a person again", tone: "warning", says: "The session ended, or a policy now asks for more than a saved session can give. Press Sign in and finish it in the browser." },
  failed: { label: "Failed", tone: "danger", says: "The program could not give a token. Check the network or a proxy, then press Check again." },
};

const MISSING: Words = { label: "Program missing", tone: "danger", says: "The program that holds the sign-in is not on this machine." };

// What was found of the program itself -- and, when it is the machine's own, that only the PROGRAM is used.
export function programWords(tool: AuthTool | undefined): Words {
  if (!tool) return NOT_CHECKED;
  if (!tool.found) return { ...MISSING, says: tool.acquirable ? "Orbit can install its own copy. It does so by itself the first time a sign-in needs it, or you can do it now." : "Orbit cannot install its own copy on this machine." };
  return { label: tool.version ? `Installed v${tool.version.replace(/^v/i, "")}` : "Installed", tone: "success", says: COPY[tool.source ?? ""] ?? "Found on this machine." };
}

const COPY: Record<string, string> = {
  "orbit-managed": "Orbit's own copy.",
  system: "This machine's own copy, used as a program only: the account it may be signed in with is NOT used.",
};

// The engine's own stop codes, as the state they mean. A code this page does not know is a failure, with the engine's words.
const STOPS: Record<string, string> = { AUTH_LOGIN_REQUIRED: "sign-in-required", AUTH_TOOL_MISSING: "tool-missing", AUTH_TOOL_UNSUPPORTED: "tool-missing", AUTH_TOOL_UNVERIFIED: "tool-missing" };

/** What a person is shown of the session: the program and the sign-in. What the engine said and what to do come with the error itself. */
export interface SessionView {
  /** null: the last move did not say (it stopped before looking at the program). */
  program: Words | null;
  /** null: there is nothing to say about the sign-in until the program is here. */
  signIn: Words | null;
  tool: AuthTool | undefined;
  /** The program is not here: what to do about that is the next thing to say. */
  missing: boolean;
}

const UNKNOWN: SessionView = { program: NOT_CHECKED, signIn: NOT_CHECKED_SIGN_IN, tool: undefined, missing: false };

const NO_TOOL: AuthTool = { found: false, version: null, source: null, acquirable: null, tried: [] };

export function sessionView(state: AuthState | undefined, error: unknown): SessionView {
  if (error) return stopView(error);
  if (!state) return UNKNOWN;
  if (state.state === "tool-missing") return { program: programWords(state.tool ?? NO_TOOL), signIn: null, tool: state.tool, missing: true };
  return { program: state.tool ? programWords(state.tool) : NOT_CHECKED, signIn: SESSION_WORDS[state.state] ?? SESSION_WORDS.failed, tool: state.tool, missing: false };
}

// A move that could not go on: the engine's code says which state it left the session in. The row is the state's label alone -- what
// went wrong, and what to do, are the engine's own words, shown with the error, and a stock sentence beside them could contradict them.
function stopView(error: unknown): SessionView {
  const state = STOPS[error instanceof ApiError ? error.code : ""] ?? "failed";
  if (state === "tool-missing") return { program: { ...MISSING, says: "" }, signIn: null, tool: undefined, missing: true };
  return { program: null, signIn: { ...(SESSION_WORDS[state] ?? SESSION_WORDS.failed), says: "" }, tool: undefined, missing: false };
}

/** What the last test says about the SOURCE: whether it accepted the sign-in. A sign-in, a sign-out or a change forgets the test. */
export function sourceWords(test: ConnectionTest | undefined): string {
  if (!test) return "Not tested since the last change. Test the connection to see whether the source accepts it.";
  const when = formatRelative(test.at);
  const access = test.checks.find((c) => c.id === "authentication" || c.id === "credential");
  if (access && access.status !== "ok") return `Did not accept it${access.message ? `: ${access.message}` : ""} · ${when}`;
  if (!access && !test.ok) return `The last test failed · ${when}`;
  return `Accepted it${test.ok ? "" : ", but something this report reads is not readable"} · ${when}${test.identity ? ` · as ${test.identity}` : ""}`;
}
