// Where each host can SHOW Orbit Live (1.8.6, ADR 0022): a matrix of what is true of the host -- never a guess about
// one -- read by `live doctor --host=<name>` and the docs. Five surfaces, best first:
//
//   NATIVE_PANE      the host draws a pane Orbit docks inside it (only where the host has a pane API)
//   COMPANION        an editor's own panel or terminal split, opened by the Orbit Live companion a person installed
//   TERMINAL_SPLIT   the viewer in a split beside the AI CLI: tmux, Windows Terminal, iTerm2 (`live open`)
//   WINDOW           the viewer in a separate terminal window (macOS Terminal)
//   CLI              `live status`, `watch`, `tui` in a terminal of the person's own, and a status line where one exists
//
// Host knowledge, so it lives with the host adapters and never in src/. Measured, not assumed: Claude Code docks a
// plugin's pane (hooks/live-pane.tsx); Codex CLI has hooks and plugins but no pane or sidebar API; the Antigravity CLI
// publishes no panel API either, and its IDE is VS Code-family -- where the companion works; a Grok Build plugin
// (1.8.9) carries nothing that draws in Grok's screen. Nothing here opens a viewer: `live open`, on a person's word, does.
export const SURFACE_WORDS = Object.freeze(["NATIVE_PANE", "COMPANION", "TERMINAL_SPLIT", "WINDOW", "CLI"]);

const COMPANION = { surface: "COMPANION", available: true, how: "in VS Code (or a VS Code-family editor) with the Orbit Live companion installed: `live open` asks it, and it splits the terminal beside this one" };
const SPLIT = { surface: "TERMINAL_SPLIT", available: true, how: "`live open`: a tmux, Windows Terminal or iTerm2 pane on the right, in the pane layout (the same picture a docked pane draws)" };
const WINDOW = { surface: "WINDOW", available: true, how: "`live open` on macOS outside those: a separate Terminal window" };

export const SURFACES = Object.freeze({
  claude: [
    { surface: "NATIVE_PANE", available: true, how: "the plugin's own pane (hooks/live-pane.tsx), docked on the right in Claude Code's fullscreen layout (CLAUDE_CODE_NO_FLICKER=1, from 110 columns), above the prompt otherwise; /orbit-live shows or hides it" },
    COMPANION, SPLIT, WINDOW,
    { surface: "CLI", available: true, how: "`live status`, `watch`, `tui`, and Claude Code's status line (cli/host.mjs --kind=statusline)" },
  ],
  codex: [
    { surface: "NATIVE_PANE", available: false, how: "Codex CLI has hooks and plugins but no pane or sidebar API a plugin can draw in" },
    COMPANION, SPLIT, WINDOW,
    { surface: "CLI", available: true, how: "`live status`, `watch`, `tui`; `live pane --host=codex --protocol=2` answers the same view model for any drawer" },
  ],
  antigravity: [
    { surface: "NATIVE_PANE", available: false, how: "the Antigravity CLI publishes no panel API Orbit can draw in; its IDE is VS Code-family, where the companion works" },
    COMPANION, SPLIT, WINDOW,
    { surface: "CLI", available: true, how: "`live status`, `watch`, `tui`; `live pane --host=antigravity --protocol=2` answers the same view model" },
  ],
  grok: [
    { surface: "NATIVE_PANE", available: false, how: "a Grok Build plugin carries skills, commands, agents, hooks and MCP or LSP servers, and nothing that draws in Grok's screen" },
    COMPANION, SPLIT, WINDOW,
    { surface: "CLI", available: true, how: "`live status`, `watch`, `tui`; `live pane --host=grok --protocol=2` answers the same view model" },
  ],
});

// Which surface an opener would use here (cli/live-open.mjs OPENERS ids): the one `live open` reaches now.
const BY_OPENER = { tmux: "TERMINAL_SPLIT", "windows-terminal": "TERMINAL_SPLIT", iterm2: "TERMINAL_SPLIT", vscode: "COMPANION", "macos-terminal": "WINDOW", "vscode-print": "CLI", print: "CLI" };

export const surfaceOfOpener = (openerId) => BY_OPENER[openerId] ?? "CLI";

export const surfacesOf = (host) => SURFACES[host] ?? [];

// What `doctor` says of a host's surfaces: one row per surface, and which one `live open` would reach from here.
export const surfaceRows = (host, openerId) => [...surfacesOf(host).map((s) => ({ name: "surface", says: `${s.surface} ${s.available ? "yes" : "no"} — ${s.how}` })), { name: "here", says: `${surfaceOfOpener(openerId)} — what \`live open\` reaches from this terminal` }];
