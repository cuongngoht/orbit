// `live open`: the full-screen viewer started beside the asking session, a person's choice each time. The opener
// is a table read in order; every launch is an argument list; the one shell line (the macOS file) is a fixed
// template whose values are checked and quoted, and a value that could break it falls back to printing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ITERM_SPLIT, OPENERS, PASSED, cmdScript, openPlan, openerOf, passedEnv, requestOf, shellLine, taskShaped, typed, viewerCommand } from "../cli/live-open.mjs";

const viewer = (over = {}) => ({ argv: viewerCommand({ node: "/usr/bin/node", cli: "/p/cli/live.mjs", task: "tsk-0123456789ab" }), cwd: "/work/refunds", env: { ORBIT_STORE_DIR: "/s" }, ...over });
const has = (...names) => (n) => (names.includes(n) ? `/usr/local/bin/${n}` : null);

test("the viewer it starts is Orbit's own, with --until-done, and nothing else", () => {
  assert.deepEqual(viewerCommand({ node: "n", cli: "c", task: null }), ["n", "c", "tui", "--until-done"]);
  assert.deepEqual(viewer().argv, ["/usr/bin/node", "/p/cli/live.mjs", "tui", "tsk-0123456789ab", "--until-done"]);
  assert.deepEqual(passedEnv({ ORBIT_STORE_DIR: "/s", ORBIT_SESSION: "claude:0123456789abcdef", ORBIT_HOST: "claude", HOME: "/h", GITHUB_TOKEN: "x", NO_COLOR: "" }), { ORBIT_STORE_DIR: "/s", ORBIT_SESSION: "claude:0123456789abcdef", ORBIT_HOST: "claude" });
  assert.ok(!PASSED.some((k) => /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/.test(k)), "host affinity and the store, never a credential");
  assert.equal(taskShaped("tsk-0123456789ab"), true);
  assert.equal(taskShaped("../x; rm -rf"), false);
});

test("a viewer /orbit-help opened carries its lease and stays; a lease of any other shape is never passed on", () => {
  const lease = `${"a".repeat(16)}.${"b".repeat(16)}`;
  assert.deepEqual(viewerCommand({ node: "n", cli: "c", task: "tsk-0123456789ab", lease }), ["n", "c", "tui", "tsk-0123456789ab", `--lease=${lease}`]);
  assert.deepEqual(viewerCommand({ node: "n", cli: "c", task: null, stay: true }), ["n", "c", "tui"], "the command printed in its place stays too");
  assert.deepEqual(viewerCommand({ node: "n", cli: "c", task: null, lease: "x;rm -rf ~" }), ["n", "c", "tui", "--until-done"]);
  assert.equal(shellLine({ argv: viewerCommand({ node: "/n", cli: "/c", task: null, lease }), cwd: "/w", env: {} }), `cd '/w' && exec '/n' '/c' 'tui' '--lease=${lease}'`);
});

test("the opener is the first row that can open on the RIGHT here: tmux, the VS Code companion, Windows Terminal, iTerm2, else a window or the command", () => {
  assert.equal(openerOf({ TMUX: "/tmp/t,1,0" }, "darwin", has("tmux")).id, "tmux");
  assert.equal(openerOf({ TMUX: "/tmp/t,1,0" }, "linux", has()).id, "print", "tmux named but not installed");
  assert.equal(openerOf({ WT_SESSION: "x" }, "win32", has("wt")).id, "windows-terminal");
  assert.equal(openerOf({ TERM_PROGRAM: "vscode" }, "darwin", has(), (kind) => kind === "vscode").id, "vscode", "VS Code with its companion alive: a split beside the asking terminal");
  assert.equal(openerOf({ TERM_PROGRAM: "vscode" }, "darwin", has()).id, "vscode-print", "VS Code without the companion: never a window of another application over it");
  assert.equal(openerOf({ TERM_PROGRAM: "vscode" }, "win32", has("wt")).id, "vscode-print", "VS Code's terminal on Windows is not Windows Terminal");
  assert.equal(openerOf({ TERM_PROGRAM: "iTerm.app" }, "darwin", has()).id, "iterm2");
  assert.equal(openerOf({ TERM_PROGRAM: "Apple_Terminal" }, "darwin", has()).id, "macos-terminal");
  assert.ok(OPENERS.filter((o) => o.prints).map((o) => o.id).join() === "vscode-print,print", "the rows that can only print say so");
  assert.equal(openerOf({ SSH_CONNECTION: "1 2 3 4" }, "darwin", has()).id, "print", "over SSH a window would open on the far machine's screen");
  assert.equal(openerOf({}, "linux", has()).id, "print");
  assert.equal(OPENERS.at(-1).when(), true);
});

test("tmux opens a pane on the right at the share a person set, without moving focus, passing only the named variables", () => {
  const plan = openPlan(OPENERS.find((o) => o.id === "tmux"), viewer(), has("tmux"));
  assert.deepEqual(plan.argv, ["/usr/local/bin/tmux", "split-window", "-h", "-d", "-l", "36%", "-c", "/work/refunds", "-e", "ORBIT_STORE_DIR=/s", ...viewer().argv]);
  assert.equal(plan.script, undefined);
  assert.ok(openPlan(OPENERS.find((o) => o.id === "tmux"), viewer({ width: 40 }), has("tmux")).argv.includes("40%"));
  assert.ok(openPlan(OPENERS.find((o) => o.id === "tmux"), viewer({ width: 95 }), has("tmux")).argv.includes("60%"), "a share outside 20–60 is held to it");
});

test("in VS Code the companion is LEFT a request -- the viewer's own command, where, beside which terminal, how wide -- and nothing is started from here", () => {
  const plan = openPlan(OPENERS.find((o) => o.id === "vscode"), viewer({ width: 36, focusCli: true, ancestry: () => [4321, 4000, 1] }));
  assert.equal(plan.argv, undefined, "no process: the companion opens the split through VS Code's own Terminal API");
  assert.deepEqual(plan.request, { version: 1, kind: "open-viewer", argv: viewer().argv, cwd: "/work/refunds", env: { ORBIT_STORE_DIR: "/s" }, ancestry: [4321, 4000, 1], width: 36, focusCli: true });
  assert.deepEqual(requestOf(viewer()).ancestry, [], "no ancestry asked for, none sent");
});

test("Windows Terminal splits a pane on the right at the share, its variables set by a UTF-8 batch file, then gives the focus back", () => {
  const wt = OPENERS.find((o) => o.id === "windows-terminal");
  const v = viewer({ cwd: "C:\\Users\\Nguyễn Văn\\my repo", env: { ORBIT_STORE_DIR: "D:\\orbit store", ORBIT_SESSION: "claude:0123456789abcdef" }, argv: ["C:\\Program Files\\nodejs\\node.exe", "C:\\orbit\\cli\\live.mjs", "tui", "--lease=" + "a".repeat(16) + "." + "b".repeat(16)] });
  const plan = openPlan(wt, v, has("wt"));
  assert.deepEqual(plan.argv, ["/usr/local/bin/wt", "-w", "0", "split-pane", "-V", "--size", "0.36", "-d", "C:\\Users\\Nguyễn Văn\\my repo", "cmd", "/d", "/c"]);
  assert.equal(plan.scriptExt, ".cmd");
  assert.deepEqual(plan.then, ["/usr/local/bin/wt", "-w", "0", "move-focus", "left"]);
  assert.equal(plan.script, `@echo off\r\nchcp 65001 >nul\r\nset "ORBIT_STORE_DIR=D:\\orbit store"\r\nset "ORBIT_SESSION=claude:0123456789abcdef"\r\ncd /d "C:\\Users\\Nguyễn Văn\\my repo"\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\orbit\\cli\\live.mjs" "tui" "--lease=${"a".repeat(16)}.${"b".repeat(16)}"\r\n`);
  assert.equal(cmdScript(v), plan.script);
  assert.equal(openPlan(wt, viewer({ cwd: "C:\\work", focusCli: false }), has("wt")).then, null, "a person who keeps the keyboard in the new pane");
  for (const bad of ['C:\\a"b', "C:\\100%", "C:\\a\nb"]) assert.equal(openPlan(wt, viewer({ cwd: bad }), has("wt")).id, "print", JSON.stringify(bad));
  assert.equal(openPlan(wt, viewer({ cwd: "C:\\w", env: { ORBIT_STORE_DIR: "%USERPROFILE%" } }), has("wt")).id, "print", "a variable cmd would expand is never written");
});

test("iTerm2 splits the asking session vertically -- the new one on its right -- and selects the asking one again", () => {
  const plan = openPlan(OPENERS.find((o) => o.id === "iterm2"), viewer());
  assert.equal(plan.argv[0], "/usr/bin/osascript", "by its absolute path");
  assert.deepEqual(plan.argv.slice(1), ITERM_SPLIT(undefined));
  assert.ok(plan.argv.join(" ").includes("split vertically with default profile command") && plan.argv.join(" ").includes("tell asking to select"));
  assert.ok(!ITERM_SPLIT(false).join(" ").includes("select"), "a person who keeps the keyboard in the new pane");
  assert.match(plan.script, /^#!\/bin\/sh\nexport ORBIT_STORE_DIR='\/s' && cd '\/work\/refunds' && exec /);
});

test("Apple's Terminal cannot split one beside this: it is said to be a separate window", () => {
  assert.match(openPlan(OPENERS.find((o) => o.id === "macos-terminal"), viewer()).say, /separate Terminal window: Terminal cannot split/);
});

test("the macOS file is a fixed line of quoted values; a value that could break the quoting prints instead", () => {
  const mac = OPENERS.find((o) => o.id === "macos-terminal");
  const plan = openPlan(mac, viewer());
  assert.equal(plan.script, "#!/bin/sh\nexport ORBIT_STORE_DIR='/s' && cd '/work/refunds' && exec '/usr/bin/node' '/p/cli/live.mjs' 'tui' 'tsk-0123456789ab' '--until-done'\n");
  assert.deepEqual(plan.argv, ["/usr/bin/open", "-a", "Terminal"], "by its absolute path, never PATH's");
  for (const bad of ["/work/it's", "/work/a\nb", "/work/\u0000"]) {
    assert.equal(shellLine(viewer({ cwd: bad })), null, JSON.stringify(bad));
    assert.equal(openPlan(mac, viewer({ cwd: bad })).id, "print");
  }
  assert.equal(openPlan(mac, viewer({ env: { ORBIT_STORE_DIR: "/s'; touch /tmp/x; '" } })).id, "print");
});

test("the printed command is what a person types: variables first, every value quoted", () => {
  assert.equal(typed(viewer()), "ORBIT_STORE_DIR='/s' '/usr/bin/node' '/p/cli/live.mjs' 'tui' 'tsk-0123456789ab' '--until-done'");
});

test("Windows Terminal never gets a value it would split into a command of its own", () => {
  const wt = OPENERS.find((o) => o.id === "windows-terminal");
  assert.equal(openPlan(wt, viewer({ cwd: "C:\\work\\refunds" }), has("wt")).argv[0], "/usr/local/bin/wt");
  for (const cwd of ["C:\\work;new-tab cmd", "C:\\a\nb"]) assert.equal(openPlan(wt, viewer({ cwd }), has("wt")).id, "print", JSON.stringify(cwd));
});

test("an opener with no trusted program to start is the printed fallback, never a bare name", () => {
  assert.equal(openPlan(OPENERS.find((o) => o.id === "tmux"), viewer(), () => null).id, "print");
});

import { attendedOf } from "../skills/orbit-learn/hosts/attended.mjs";
import * as liveOpen from "../cli/live-open.mjs";

// 1.8.5: whether a viewer opens by itself is src/live/ensure.mjs POLICY (test/live-ensure.test.mjs), for /orbit-help and
// a workflow's start alike; the 1.8.3 table that opened only for a workflow this command created is gone.
test("the opener table no longer decides whether anything opens by itself", () => {
  assert.equal(liveOpen.AUTO_OPEN, undefined);
  assert.equal(liveOpen.autoOpenRefusal, undefined);
});

test("a person is at the session only where a host says so; a host with no verified mark is unattended", () => {
  assert.equal(attendedOf({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ATTENDED: "1" }), true);
  assert.equal(attendedOf({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ATTENDED: "0" }), false, "claude -p");
  assert.equal(attendedOf({ CODEX_HOME: "/x" }), false);
  assert.equal(attendedOf({}), false);
});
