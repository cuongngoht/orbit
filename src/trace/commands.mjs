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
//
// An OPERATION (0.5.0) is the word after a subcommand, kept by the same rule: only when the usage documents it after
// that very subcommand -- `orbit.mjs goal step` is `cli/orbit` · `goal` · `step`, because the header says `node
// orbit.mjs goal plan|status|resume|step|…`. A lookup's set holds such a pair as one entry, "<sub> <op>"
// (`operations`), so a lookup that knows none answers exactly what it answered before.
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

// The words after the script -- past the quote that closes a quoted path.
function named(found, subs) {
  if (!subs) return null;
  const [next, then] = found.after.replace(/^["']/, "").trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ""));
  const sub = subs.has(next) ? next : null;
  return { id: found.rel.replace(/\.mjs$/, ""), sub, ...opOf(subs, sub, then) };
}

// An operation is kept only when the usage documents it after this very subcommand; absent, it is no field at all.
const opOf = (subs, sub, then) => (sub && then && subs.has(`${sub} ${then}`) ? { op: then } : {});

// The subcommands a script's usage documents: every `…<name>.mjs <word>` in its
// leading comment block.
export function documented(header, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`node\\s+\\S*?${escaped}\\.mjs\\s+([a-z][a-z-]*)`, "g");
  return new Set([...String(header ?? "").matchAll(re)].map((m) => m[1]));
}

// The operations a script's usage documents after a subcommand, each as "<sub> <op>": every `…<name>.mjs <sub> <op>`,
// and every `<op>` of a `<sub> a|b|c` list, in its leading comment block. One space apart, as a usage line spells a
// command -- a description a column of spaces away is never an operation.
export function operations(header, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`node\\s+\\S*?${escaped}\\.mjs ([a-z][a-z-]*) ([a-z][a-z|-]*)`, "g");
  return new Set([...String(header ?? "").matchAll(re)].flatMap((m) => m[2].split("|").filter((op) => /^[a-z][a-z-]*$/.test(op)).map((op) => `${m[1]} ${op}`)));
}

// A script's leading comment block, the way every CLI here prints its help.
export function headerOf(source) {
  const all = String(source ?? "").split("\n");
  const lines = all[0]?.startsWith("#!") ? all.slice(1) : all;
  const end = lines.findIndex((l) => !l.startsWith("//"));
  return lines.slice(0, end < 0 ? lines.length : end).join("\n");
}
