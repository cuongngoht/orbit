// Orbit Live for Codex CLI (1.8.6): no status line and no pane API, so what `live --host=codex` loads is the session's
// mark and the surfaces this host has (live-host.mjs, live-surfaces.mjs). The viewer itself runs beside Codex: `live
// open` -- a tmux, Windows Terminal or iTerm2 split, or the VS Code companion -- in the pane layout.
import { liveHost } from "./live-host.mjs";

export const { name, sessionOf, room, enabled, PANE_HINTS, doctor } = liveHost({ name: "codex", hint: "Codex has no pane API: `live open` shows this beside the session (tmux, Windows Terminal, iTerm2, or the VS Code companion)" });
