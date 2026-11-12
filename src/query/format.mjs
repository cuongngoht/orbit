// Shared bits of the query views. Printing is a view concern and stays here;
// a reading of the map is shared through graph/.
import { engined } from "../engined.mjs";
import { pluginRoot } from "../version.mjs";

// The one writer every view shares, so the command a view names carries the plugin's own path (src/engined.mjs).
export const out = (...a) => console.log(...a.map((x) => (typeof x === "string" ? engined(x, pluginRoot()) : x)));

export const flags = (s) => [s.dead && "DEAD", s.stub && "STUB", s.admin && "admin", s.seen && `seen:${s.seen}`].filter(Boolean).join(" ");

export const noScreen = (id) => out(`no screen "${id}" — try: query find ${id}`);
