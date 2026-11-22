// WHAT AN AI CLI'S OWN SIGN-IN PRINTS, read as it prints it (common/login-flow.ts drives the process) -- pure. Each
// runtime whose subscription a card can sign in (ADR 0068) has a READER: what the output so far says, and when a person
// has everything they need to act on it.
//
//   Claude Code   `claude auth login --claudeai` prints "… visit: https://claude.com/cai/oauth/authorize?…" and then
//                 "Paste code here if prompted >": a person opens the URL, signs in, and pastes back the code that page
//                 shows -- written to that process's stdin and nowhere else.
//   OpenAI Codex  `codex login --device-auth` prints "Open this link … https://auth.openai.com/codex/device" and "Enter
//                 this one-time code (expires in 15 minutes) ABCD-EFGHI": a person enters the code on OpenAI's page, and
//                 the CLI finishes by itself. Nothing is pasted back.
//   Antigravity   none: `agy` has no sign-in command, and its terms do not permit its Google sign-in from another product
//                 (methods.ts).
import type { AuthMethod, RuntimeKind } from "@orbit-web/contracts";
import type { LoginFields } from "../../common/login-flow.js";
import { RUNTIME_SPECS } from "./runtimes.js";

// eslint-disable-next-line no-control-regex -- the escape character is what a colour code starts with
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const plain = (output: string): string => output.replace(ANSI, "");

export function readClaudeLogin(output: string): LoginFields {
  const text = plain(output);
  const visit = [...text.matchAll(/visit:\s*(https:\/\/\S+)/g)].at(-1)?.[1] ?? null;
  const url = visit ?? [...text.matchAll(/(https:\/\/\S*(?:oauth|authorize)\S*)/g)].at(-1)?.[1] ?? null;
  return { url, needsCode: /paste code here/i.test(text) };
}

export function readCodexLogin(output: string): LoginFields {
  const text = plain(output);
  const link = /open this link[^\n]*\n\s*(https:\/\/\S+)/i.exec(text)?.[1] ?? [...text.matchAll(/(https:\/\/auth\.openai\.com\/\S+)/g)].at(-1)?.[1] ?? null;
  const code = /one-time code[^\n]*\n\s*([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+)\s*$/im.exec(text)?.[1] ?? null;
  return { url: link, code };
}

export interface SignInReader {
  read(output: string): LoginFields;
  // Whether what a person needs has been printed.
  ready(fields: LoginFields): boolean;
}

export const SIGN_IN_READERS: Partial<Record<RuntimeKind, SignInReader>> = {
  claude: { read: readClaudeLogin, ready: (f) => typeof f.url === "string" && f.url.length > 0 },
  codex: { read: readCodexLogin, ready: (f) => typeof f.url === "string" && f.url.length > 0 && typeof f.code === "string" && f.code.length > 0 },
};

// Whether a connection of this runtime and method can be signed in from its card at all (the operator's switch aside).
export const signsInHere = (c: { runtime: RuntimeKind; method: AuthMethod }): boolean => c.method === "subscription" && RUNTIME_SPECS[c.runtime].login !== null && SIGN_IN_READERS[c.runtime] !== undefined;
