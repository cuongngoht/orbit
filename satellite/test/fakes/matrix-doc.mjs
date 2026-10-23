// The host matrix as the Markdown table satellite/docs/hosts.md carries -- rendered from the one table in
// satellite/src/hosts/matrix.mjs, so the page and the code cannot say two things. Export-only.
import { CAPABILITIES, HOSTS } from "../../src/hosts/matrix.mjs";

export const DOC_HOSTS = Object.freeze([["claude", "Claude Code"], ["codex", "Codex"], ["antigravity", "Antigravity CLI"], ["grok", "Grok Build"]]);

const cellText = (c) => `${c.value === "verified" ? `verified once \`${c.by.acceptance}\` passes, else reported` : c.value}${c.max ? ` (at most ${c.max} at once)` : ""}`;

const rowOf = (cap) => `| ${cap} | ${DOC_HOSTS.map(([id]) => cellText(HOSTS[id][cap])).join(" | ")} |`;

export const matrixTable = () => [`| Capability | ${DOC_HOSTS.map(([, name]) => name).join(" | ")} |`, `| --- | ${DOC_HOSTS.map(() => "---").join(" | ")} |`, ...CAPABILITIES.map(rowOf)].join("\n");

export const matrixNotes = () => DOC_HOSTS.flatMap(([id, name]) => CAPABILITIES.filter((cap) => HOSTS[id][cap].note).map((cap) => `- **${name}, ${cap}.** ${HOSTS[id][cap].note.charAt(0).toUpperCase()}${HOSTS[id][cap].note.slice(1)}.`)).join("\n");
