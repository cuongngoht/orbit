// The frontmatter of a SKILL.md, a command or an agent file: the block between its first two `---` lines. Only `name`
// and `description` are read, as YAML scalars -- plain, quoted, or a folded (`>`) or literal (`|`) block of indented
// lines -- which is all the inventory shows. Nothing else of the file is kept.
export interface Frontmatter {
  name: string | null;
  description: string | null;
}

const MAX_VALUE = 1_000;

const unquote = (v: string): string => {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
  return v;
};

function scalar(block: string[], key: string): string | null {
  const at = block.findIndex((l) => l.startsWith(`${key}:`) || l.startsWith(`${key} :`));
  if (at === -1) return null;
  const line = block[at] as string;
  let value = line.slice(line.indexOf(":") + 1).trim();
  if (/^[>|][-+]?$/.test(value)) {
    const folded = value.startsWith(">");
    const rest: string[] = [];
    for (let i = at + 1; i < block.length && /^\s+\S/.test(block[i] as string); i += 1) rest.push((block[i] as string).trim());
    value = rest.join(folded ? " " : "\n");
  }
  value = unquote(value).trim();
  return value.length > 0 ? value.slice(0, MAX_VALUE) : null;
}

export function frontmatter(text: string): Frontmatter {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { name: null, description: null };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { name: null, description: null };
  const block = lines.slice(1, end);
  return { name: scalar(block, "name"), description: scalar(block, "description") };
}
