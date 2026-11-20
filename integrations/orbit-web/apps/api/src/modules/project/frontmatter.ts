// The frontmatter of a SKILL.md, a command or an agent file: the block between its first two `---` lines, read as
// YAML scalars -- plain, quoted, or a folded (`>`) or literal (`|`) block of indented lines -- for the few keys
// Orbit Web uses. Nothing else of the block is interpreted.
export interface Frontmatter {
  name: string | null;
  description: string | null;
}

const MAX_VALUE = 1_000;
const BOM = String.fromCharCode(0xfeff);

const withoutBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text);

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

// The frontmatter block and the body after it. A text that does not open with `---` (after a BOM and blank lines) has
// none (`block` null); one that opens with `---` and never closes it is `unclosed`: a reader that closes blocks
// differently could still see one there.
function split(text: string): { block: string[] | null; body: string; unclosed: boolean } {
  const start = withoutBom(text).replace(/^\s*\n/, "");
  const lines = start.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { block: null, body: withoutBom(text), unclosed: false };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { block: null, body: start, unclosed: true };
  return { block: lines.slice(1, end), body: lines.slice(end + 1).join("\n"), unclosed: false };
}

export function frontmatter(text: string): Frontmatter {
  const { block } = split(text);
  return block === null ? { name: null, description: null } : { name: scalar(block, "name"), description: scalar(block, "description") };
}

// INSTRUCTIONS ONLY: how a repository's skill, command or agent file is carried into a session's plugin. Its
// frontmatter is REBUILT from an allowlist -- name, description, model, argument-hint, each written back as a quoted
// one-line string -- and the original block never passes through, so no `hooks`, no `allowed-tools`, nothing a YAML
// reader could see differently from this one; a file whose frontmatter never closes is not carried at all (null). In
// the body, every pre-run construct (`!`command``, a ```! or ~~~! block) is pulled apart and stays text. What Claude
// then does is held to the session's own permissions.
export const CARRIED_KEYS = ["name", "description", "model", "argument-hint"] as const;

const SAFE_MODEL = /^[A-Za-z0-9._[\]-]{1,64}$/;

function rebuilt(block: string[]): string {
  const lines = CARRIED_KEYS.flatMap((key) => {
    const value = scalar(block, key);
    if (value === null || (key === "model" && !SAFE_MODEL.test(value))) return [];
    return [`${key}: ${JSON.stringify(value.replace(/\s+/g, " "))}`];
  });
  return `---\n${lines.map((l) => `${l}\n`).join("")}---\n`;
}

// `!` right before a backtick (inline `!`command``), and any run of backticks -- or three or more tildes -- right
// before `!` (a fence opening a pre-run block, wherever it sits: mid-line, in a quote, four or more long) are pulled
// apart by a space: the same characters, never a command.
const neutralised = (body: string): string => body.replace(/!`/g, "! `").replace(/(`+|~{3,})!/g, "$1 !");

export function instructionsOnly(text: string): string | null {
  const { block, body, unclosed } = split(text);
  if (unclosed) return null;
  return `${block === null ? "" : rebuilt(block)}${neutralised(body)}`;
}
