// One `allowed-tools` entry, read the way Claude Code's permission rules are
// written: a tool name, optionally scoped -- `Bash(node x/cli/*)` allows Bash
// for THAT command only, which is the part a reader most needs to see.

export interface AllowedTool {
  /** As written in SKILL.md, so the tooltip never paraphrases a rule. */
  rule: string;
  tool: string;
  /** What the parentheses narrow it to, or null when the whole tool is allowed. */
  scope: string | null;
}

export function parseTool(rule: string): AllowedTool {
  const m = /^([^(]+)\((.*)\)$/s.exec(rule.trim());
  if (!m) return { rule, tool: rule.trim(), scope: null };
  return { rule, tool: m[1].trim(), scope: m[2].trim() || null };
}

// A plain-language line under the tool name, or null to show the rule alone.
export function describeTool(tool: AllowedTool): string | null {
  // TODO(you): say what allowing this tool lets the skill do.
  void tool;
  return null;
}
