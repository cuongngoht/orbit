// Orbit Live for Grok Build (1.8.9): a plugin there carries skills, commands, agents, hooks and MCP or LSP servers, and
// nothing that draws in Grok's own screen, so what `live --host=grok` loads is the session's mark and the surfaces this
// host has (live-host.mjs, live-surfaces.mjs). The viewer itself runs beside Grok: `live open` -- a tmux, Windows
// Terminal or iTerm2 split, or the VS Code companion -- in the pane layout. A Orbit command Grok's agent runs is bound
// to the session by itself (settings.mjs: its shell carries GROK_SESSION_ID).
import { liveHost } from "./live-host.mjs";

export const { name, sessionOf, room, enabled, PANE_HINTS, doctor } = liveHost({ name: "grok", hint: "Grok Build has no pane API a plugin can draw in: `live open` shows this beside the session (tmux, Windows Terminal, iTerm2, or the VS Code companion)" });
