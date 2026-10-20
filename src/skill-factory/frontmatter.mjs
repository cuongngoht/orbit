// The frontmatter of a SKILL.md, read the way the shipped skills write it -- by Orbit Control's skill editor
// and by the skill factory, which holds a generated playbook to the same parse (one reader, never two).
//
// Not YAML. A YAML package would be the engine's first dependency, bought to
// read four keys. What the skills in this repository actually use is small and
// regular -- `key: value`, a quoted value, a `>` or `|` block, a `- item` list --
// so that is what is read, and anything else is simply not a key it knows.
// A key is a line starting at column 0; everything indented under it is its value.
const FENCE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY = /^([A-Za-z][\w-]*):[ \t]*(.*)$/;
const BLOCK = /^([>|])[+-]?$/;
const ITEM = /^\s*-\s+(.*)$/;
const QUOTED = /^(["'])(.*)\1$/;

// null when there is no frontmatter block at all -- a different answer from an
// empty one, and validate.mjs says so differently.
export function frontmatter(text) {
  const found = FENCE.exec(String(text));
  return found ? fields(found[1].split(/\r?\n/)) : null;
}

// The raw block this reader reads keys from, by the SAME fence -- so a rule about what is in the frontmatter
// looks at exactly what the keys were read from (a byte-order mark or a CRLF included), never a second guess.
export const frontmatterBlock = (text) => FENCE.exec(String(text))?.[1] ?? "";

function fields(lines) {
  const keys = lines.map((line, at) => ({ found: KEY.exec(line), at })).filter((k) => k.found);
  return Object.fromEntries(keys.map((k, n) => [k.found[1], valueOf(k.found[2].trim(), lines.slice(k.at + 1, keys[n + 1]?.at ?? lines.length))]));
}

function valueOf(head, rest) {
  const block = BLOCK.exec(head);
  if (block) return blockOf(block[1], rest);
  return head ? scalar(head) : listOf(rest);
}

// `>` folds its lines into one sentence and `|` keeps them; a blank line in a
// folded block is dropped rather than kept as a paragraph break, which is all a
// one-line description in a list needs.
const blockOf = (style, rest) => rest.map((l) => l.trim()).filter(Boolean).join(style === ">" ? " " : "\n");

const scalar = (head) => QUOTED.exec(head)?.[2] ?? head.replace(/\s+#.*$/, "");

function listOf(rest) {
  const items = rest.map((l) => ITEM.exec(l)?.[1]).filter((v) => v !== undefined);
  return items.length ? items.map(scalar) : "";
}
