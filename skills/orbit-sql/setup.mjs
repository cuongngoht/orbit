// The two ways to configure this tool, printed as COMMANDS for the user's own
// terminal. This file never writes anything and never asks for a password: a
// credential typed into an agent's chat is a credential in a transcript.
//
// Both ways are shown together on purpose, because they fix different sessions:
// the file works in the agent that is already running, the exported variable
// works in every session started afterwards. Somebody who is only told about
// one of them will pick the wrong one roughly half the time.
import { PREFIX } from "./args.mjs";
import { dirname } from "node:path";

const ASKED = ["SERVER", "DATABASE", "USER", "PASSWORD"];
export const PLACEHOLDER = "PASTE_PASSWORD_HERE";

export function setupLines(os, values = {}, fromEnv = false) {
  const pairs = ASKED.map((k) => `${PREFIX}${k}=${value(k, values, fromEnv, os)}`);
  return os === "win" ? windows(pairs, fromEnv) : posix(pairs, fromEnv);
}

// New projects keep the user-authored adapter file in runtime, never a shell profile.
export function setupAt(os, values, fromEnv, file) {
  const lines = setupLines(os, values, fromEnv);
  const quote = os === "win" ? (s) => `'${s.replaceAll("'", "''")}'` : (s) => `'${s.replaceAll("'", "'\\''")}'`;
  return lines.slice(0, lines.indexOf("")).map((line) => relocate(line, file, quote));
}

function relocate(line, file, quote) {
  return line.replaceAll('"$HOME\\.orbit\\sql.env"', quote(file)).replaceAll('"$HOME\\.orbit"', quote(dirname(file))).replaceAll("~/.orbit/sql.env", quote(file)).replaceAll("~/.orbit", quote(dirname(file)));
}

// --from-env copies what that shell ALREADY exported into the file, so the
// password is never retyped and never displayed. The shell expands it there, in
// the user's terminal; here these are literal strings.
function value(k, values, fromEnv, os) {
  if (values[k]) return values[k];
  if (fromEnv) return os === "win" ? `$($env:${PREFIX}${k})` : `$${PREFIX}${k}`;
  return k === "PASSWORD" ? PLACEHOLDER : `<${k.toLowerCase().replace("_", " ")}>`;
}

// Single quotes keep a literal password literal; double quotes are what let
// --from-env expand. umask 177 creates the file unreadable by anyone else --
// before it has a password in it, not after.
const posix = (pairs, fromEnv) => [
  "mkdir -p ~/.orbit && chmod 700 ~/.orbit",
  `umask 177 && printf '%s\\n' ${pairs.map((p) => (fromEnv ? `"${p}"` : `'${p}'`)).join(" ")} >> ~/.orbit/sql.env`,
  "chmod 600 ~/.orbit/sql.env",
  "",
  ...(fromEnv ? [] : profile(pairs)),
];

const profile = (pairs) => [
  "# Or as real environment variables. An export reaches an agent only when the",
  "# agent is started afterwards from a shell that has it, so it goes in the",
  "# profile and you open a new terminal:",
  ...pairs.map((p) => `echo 'export ${p.replace("=", '="')}"' >> ~/.zshrc`),
];

const windows = (pairs, fromEnv) => [
  'New-Item -ItemType Directory -Force -Path "$HOME\\.orbit" | Out-Null',
  ...pairs.map((p) => `Add-Content -Path "$HOME\\.orbit\\sql.env" -Value ${fromEnv ? `"${p}"` : `'${p}'`}`),
  'icacls "$HOME\\.orbit\\sql.env" /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null',
  "",
  ...(fromEnv ? [] : pairs.map((p) => `setx ${p.slice(0, p.indexOf("="))} "${p.slice(p.indexOf("=") + 1)}"`)),
];
