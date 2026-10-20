// Orbit Live for the Antigravity CLI (1.8.6): no status line and no panel API Orbit can draw in, so what `live
// --host=antigravity` loads is the session's mark and the surfaces this host has (live-host.mjs, live-surfaces.mjs).
// The viewer runs beside it: `live open` -- a terminal split, or the Orbit Live companion in its VS Code-family IDE.
import { liveHost } from "./live-host.mjs";

export const { name, sessionOf, room, enabled, PANE_HINTS, doctor } = liveHost({ name: "antigravity", hint: "Antigravity has no panel API Orbit can draw in: `live open` shows this beside the session (a terminal split, or the VS Code companion in its IDE)" });
