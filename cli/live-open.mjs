// `live open`: the full-screen viewer, started BESIDE the session that asked for it -- a pane or a window of its
// own -- and returned from at once, like a command sent to the background. `live open` is a person's choice each
// time and starts the viewer with `--until-done`, so it leaves when the work is done; the viewer Orbit opens by
// itself for `/orbit-help` goes through the SAME openers (cli/live-ensure.mjs, ADR 0020) with `--lease` instead, and
// stays until the person leaves it. Neither ever draws in the terminal it was asked from.
//
//   openerOf(env, platform, has) -> opener          the first row that can open here
//   openPlan(opener, viewer) -> { argv?, script?, say }
//   viewerCommand({ node, cli, task, lease }) -> argv   the one command it ever starts
//   PASSED: the few variables the viewer needs to find the same store, host and session, passed on by name (a new
//   pane or window does not inherit this shell's environment); nothing else of it
//
// OPENERS, in order (1.8.5: the RIGHT side of the AI CLI, at the share of the width a person set, the keyboard left
// with the CLI): a tmux pane split to the right of the asking one; in VS Code's integrated terminal, a terminal split
// beside the asking one by the Orbit Live companion extension (integrations/vscode-orbit-live) through VS Code's own
// Terminal API -- Orbit only leaves it a request in its own store, so nothing here drives VS Code -- and, without the
// companion, the command printed (never a window of another application over VS Code); a Windows Terminal pane split
// to the right, its variables set by a `.cmd` launcher Orbit writes in its own store, then the focus moved back; on
// macOS an iTerm2 pane split beside the asking session (its AppleScript, the asking session selected again), else a
// Terminal window -- said to be a window, because Terminal cannot split one beside this; and anywhere else the
// command, printed, to run in a second terminal. Every argv is a list; the one shell line (the macOS file) and the
// one batch file (Windows) are fixed templates whose values are checked for shape and quoted, and a value that does
// not pass is the printed fallback.
//
// Two programs are not trusted to be what PATH says: an opener is started by its ABSOLUTE path, found by the
// caller's `bin(name)` (absolute PATH directories outside the checkout only) or fixed (/usr/bin/open), so a checkout
// cannot plant a `tmux` of its own. And Windows Terminal parses its OWN command line, where `;` starts another of
// its commands, so a value holding one is the printed fallback, never an argument wt would split.
import { TASK_ID } from "../src/live/tui/model.mjs";

const SAFE = /^[^'\n\r\u0000]+$/;

const LEASE = /^[a-f0-9]{16}\.[a-f0-9]{16}$/;

// A viewer started for a lease -- or typed by a person in place of one (`stay`) -- keeps its final summary until a
// person leaves it; one `live open` started leaves by itself once the task has ended.
export const viewerCommand = ({ node, cli, task, lease = null, stay = false }) => [node, cli, "tui", ...(task ? [task] : []), ...(LEASE.test(String(lease ?? "")) ? [`--lease=${lease}`] : stay ? [] : ["--until-done"])];

export const PASSED = Object.freeze(["ORBIT_STORE_DIR", "ORBIT_SESSION", "ORBIT_HOST", "ORBIT_HOST_PROTOCOL", "NO_COLOR"]);

export const passedEnv = (env) => Object.fromEntries(PASSED.filter((k) => typeof env[k] === "string" && env[k] !== "").map((k) => [k, env[k]]));

const quoted = (v) => `'${v}'`;

// The macOS file: change to the checkout, then become the viewer. Null when a value could break the quoting.
export function shellLine(viewer) {
  const values = [viewer.cwd, ...viewer.argv, ...Object.values(viewer.env)];
  const exports = Object.entries(viewer.env).map(([k, v]) => `export ${k}=${quoted(v)} && `).join("");
  return values.every((v) => SAFE.test(String(v))) ? `${exports}cd ${quoted(viewer.cwd)} && exec ${viewer.argv.map(quoted).join(" ")}` : null;
}

// What Windows Terminal would split into commands of its own: a `;` anywhere, or a line break.
const wtSafe = (v) => [v.cwd, ...v.argv].every((x) => !/[;\r\n]/.test(String(x)));

const tmuxEnv = (env) => Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

// Windows' batch file: UTF-8, the variables a new pane does not inherit, the checkout, then the viewer. A value holding
// a quote, a percent sign or a line break could change the line, so it is the printed fallback instead.
const CMD_SAFE = /^[^"%\r\n\u0000]+$/;

const cmdSafe = (v) => [v.cwd, ...v.argv, ...Object.values(v.env)].every((x) => CMD_SAFE.test(String(x)));

export const cmdScript = (v) => `${["@echo off", "chcp 65001 >nul", ...Object.entries(v.env).map(([k, val]) => `set "${k}=${val}"`), `cd /d "${v.cwd}"`, v.argv.map((a) => `"${a}"`).join(" ")].join("\r\n")}\r\n`;

const shareOf = (v) => Math.min(60, Math.max(20, Number.isInteger(v.width) ? v.width : 36));

const wtPlan = (v, bin) => (wtSafe(v) && cmdSafe(v) ? { argv: [bin("wt"), "-w", "0", "split-pane", "-V", "--size", (shareOf(v) / 100).toFixed(2), "-d", v.cwd, "cmd", "/d", "/c"], script: cmdScript(v), scriptExt: ".cmd", then: v.focusCli === false ? null : [bin("wt"), "-w", "0", "move-focus", "left"], say: "opened in a Windows Terminal pane on the right of this one" } : null);

// iTerm2: the asking session split vertically (the new one on its right) running the file Orbit wrote, the asking
// session selected again. The file's path is the script's one argument.
export const ITERM_SPLIT = (focusCli) => ["-e", "on run argv", "-e", 'tell application "iTerm2"', "-e", "set asking to current session of current window", "-e", 'tell asking to split vertically with default profile command ("/bin/sh " & quoted form of (item 1 of argv))', ...(focusCli === false ? [] : ["-e", "tell asking to select"]), "-e", "end tell", "-e", "end run"];

// What the VS Code companion is asked to start: the viewer's own argument list, where, with which variables, beside
// which terminal (the asking process's ancestors: one of them is the shell that terminal runs), how wide, and whether
// the keyboard goes back. The companion starts nothing but Orbit's viewer (it refuses any other request).
export const requestOf = (v) => ({ version: 1, kind: "open-viewer", argv: v.argv, cwd: v.cwd, env: v.env, ancestry: typeof v.ancestry === "function" ? v.ancestry() : [], width: shareOf(v), focusCli: v.focusCli !== false });

export const OPENERS = Object.freeze([
  { id: "tmux", where: "a tmux pane split to the right of this one", when: (env, platform, has) => Boolean(env.TMUX) && has("tmux"), plan: (v, bin) => ({ argv: [bin("tmux"), "split-window", "-h", "-d", "-l", `${shareOf(v)}%`, "-c", v.cwd, ...tmuxEnv(v.env), ...v.argv], say: "opened on the right of this pane (tmux); the keyboard stays here" }) },
  { id: "vscode", where: "a VS Code terminal split beside this one, by the Orbit Live companion", when: (env, platform, has, seen) => env.TERM_PROGRAM === "vscode" && seen("vscode"), plan: (v) => ({ request: requestOf(v), say: "the Orbit Live companion opens it in a VS Code terminal split beside this one" }) },
  { id: "vscode-print", prints: true, where: "nothing in VS Code without the Orbit Live companion extension (README §4.16): the command, printed, for a split terminal", when: (env) => env.TERM_PROGRAM === "vscode", plan: () => ({ say: "split this terminal (or install the Orbit Live companion, README §4.16) and run:" }) },
  { id: "windows-terminal", where: "a Windows Terminal pane split to the right of this one", when: (env, platform, has) => Boolean(env.WT_SESSION) && has("wt"), plan: wtPlan },
  { id: "iterm2", where: "an iTerm2 pane split beside this session", when: (env, platform) => platform === "darwin" && env.TERM_PROGRAM === "iTerm.app" && !env.SSH_CONNECTION, plan: (v) => (shellLine(v) ? { script: `#!/bin/sh\n${shellLine(v)}\n`, argv: ["/usr/bin/osascript", ...ITERM_SPLIT(v.focusCli)], say: "opened in an iTerm2 pane beside this session" } : null) },
  { id: "macos-terminal", where: "a separate Terminal window (Terminal cannot split a pane beside this one)", when: (env, platform) => platform === "darwin" && !env.SSH_CONNECTION, plan: (v) => (shellLine(v) ? { script: `#!/bin/sh\n${shellLine(v)}\n`, argv: ["/usr/bin/open", "-a", "Terminal"], say: "opened in a separate Terminal window: Terminal cannot split a pane beside this one (tmux, iTerm2 or the VS Code companion can)" } : null) },
  { id: "print", prints: true, where: "nothing it can open here: the command, printed, for a second terminal", when: () => true, plan: () => ({ say: "run this in a second terminal (a split pane, a tab, or a tmux pane):" }) },
]);

// The first row that can open here. `seen(kind)`: whether a companion of that kind is alive on this machine now.
export const openerOf = (env, platform, bin, seen = () => false) => OPENERS.find((o) => o.when(env, platform, (name) => Boolean(bin(name)), seen));

// What will be done: the opener's plan, or -- when its values did not pass -- the printed fallback.
export const openPlan = (opener, viewer, bin = () => null) => ((plan) => (plan && (plan.request || plan.argv?.[0] !== null) ? { id: opener.id, ...plan } : { id: "print", ...OPENERS.at(-1).plan(viewer) }))(opener.plan(viewer, bin));

// The command as a person would type it in a second terminal: each value single-quoted, the variables first.
export const typed = (viewer) => [...Object.entries(viewer.env).map(([k, v]) => `${k}=${quoted(v)}`), ...viewer.argv.map(quoted)].join(" ");

// Whether a viewer opens BY ITSELF is no longer decided here: src/live/ensure.mjs POLICY says it for /orbit-help and a
// workflow's start alike (1.8.5), and cli/live-ensure.mjs is the one launcher that asks it.
export const taskShaped = (task) => task === null || TASK_ID.test(String(task));
