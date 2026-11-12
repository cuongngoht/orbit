// The plugin's own path, said where a host reads it (0.6.0, Q3).
//
// A module builds a line that names an Orbit command as `node <engine>/cli/x.mjs …` (or `<plugin>`), because a module
// does not know where the plugin is installed. A CLI and a hook do -- from their own file -- so each reads the
// placeholder as that path ONCE, where it writes what a host reads: a CLI's output, a hook's payload. A module that
// measures a line against a budget reads it the same way before it measures, so the budget is the one the host sees.
// No line a host sees carries a placeholder (test/no-placeholder.test.mjs).
//
// A LEAF: it imports nothing, so every writer and every module that measures can ask it without a lateral edge.

// The words a line names the plugin's root by.
export const PLACEHOLDERS = ["<engine>", "<plugin>"];

// The root as a command names it: one separator, the `/` the rest of the command already uses (`C:/…/cli/x.mjs`, never
// `C:\…/cli/x.mjs`), which node reads on every platform -- and which leaves a JSON string valid when the line is one.
export const rootWord = (engine) => String(engine).replaceAll("\\", "/");

// One string, read with the root a writer knows; with no root it is left as it was (a module's own test).
export const engined = (text, engine) => (engine ? PLACEHOLDERS.reduce((t, p) => t.replaceAll(p, rootWord(engine)), String(text)) : String(text));

// Every string inside a value a writer serialises -- a hook's payload, a `--json` answer -- read the same way, so the
// path is substituted in the value and never in its serialised text (a path's backslash is not a JSON escape).
export const enginedDeep = (value, engine) => (engine && value != null ? JSON.parse(JSON.stringify(value), (_, v) => (typeof v === "string" ? engined(v, engine) : v)) : value);
