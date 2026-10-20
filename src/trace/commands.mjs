// Which Orbit COMMAND a command line ran -- the shipped script, and a subcommand
// only if that script's own usage documents it. Nothing else of the line.
//
// A command line is where an argument would carry a task, a path or a secret,
// so the line is read in memory and reduced to two words. `route "<a prompt>"`
// is `resources route`; `run-case <a case id>` is `run-case`, because no case id
// is a subcommand `run-case` documents. The documented words are parsed off the
// script's own header -- the usage its `help()` prints, which is already a
// contract (a CLI's names and flags are one) -- so there is no second list of
// subcommands anywhere to fall behind.
//
// `lookup(rel)` is the composition root's: the documented subcommands of a
// script this plugin SHIPS at that relative path and that this line reaches as
// the plugin's own (or null). This file never reads a disk.
export const MAX_COMMANDS = 4;

const SCRIPT = /((?:cli|skills\/[a-z0-9-]+)\/[a-z0-9._-]+\.mjs)\b/g;

// A Windows path is spelled with backslashes, and a script's relative path
// here never is -- so the line is read with one separator, and
// `C:\…\cli\knowledge.mjs verify` is the same command as `/…/cli/knowledge.mjs verify`.
export function orbitCommands(line, lookup) {
  const text = String(line ?? "").replace(/\\/g, "/");
  const found = [...text.matchAll(SCRIPT)].map((m) => ({ rel: m[1], after: text.slice(m.index + m[0].length) }));
  return found.map((f) => named(f, lookup(f.rel, text))).filter(Boolean).slice(0, MAX_COMMANDS);
}

// The word after the script -- past the quote that closes a quoted path.
function named(found, subs) {
  if (!subs) return null;
  const next = found.after.replace(/^["']/, "").trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, "") ?? "";
  return { id: found.rel.replace(/\.mjs$/, ""), sub: subs.has(next) ? next : null };
}

// The subcommands a script's usage documents: every `…<name>.mjs <word>` in its
// leading comment block.
export function documented(header, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`node\\s+\\S*?${escaped}\\.mjs\\s+([a-z][a-z-]*)`, "g");
  return new Set([...String(header ?? "").matchAll(re)].map((m) => m[1]));
}

// A script's leading comment block, the way every CLI here prints its help.
export function headerOf(source) {
  const all = String(source ?? "").split("\n");
  const lines = all[0]?.startsWith("#!") ? all.slice(1) : all;
  const end = lines.findIndex((l) => !l.startsWith("//"));
  return lines.slice(0, end < 0 ? lines.length : end).join("\n");
}
