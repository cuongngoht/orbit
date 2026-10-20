// A generated playbook, held to the contract BEFORE it is trusted -- an ordered table of rules, every finding
// at once after the two that make the rest meaningless. Generated text is untrusted input: whatever it says
// about tools, commands or a person's approval is checked, never obeyed.
//
//   1  SF_SKILL_MISSING · SF_INSTRUCTION    a SKILL.md, held to the SAME rules a shipped one is
//                                           (src/skill-factory/instruction.mjs, Orbit Control's editor's table)
//   2  SF_ID_*                              its own name, never `orbit-`, never a shipped skill's or agent's
//   3  SF_MANIFEST_*                        what it says it is; nothing the engine stamps
//   4  SF_ENGINE_RANGE                      drafted for this engine
//   5  SF_PROVIDES_SHIPPED                  never what a shipped component provides: it never replaces one
//   6  SF_NEED_UNPROVIDED                   every need it declares PROVIDED here -- else it is a capability
//                                           gap, a person's to decide, and nothing is registered
//   7  SF_TOOLS_*                           no wildcard, and no tool wider than the shipped workflow it was
//                                           drafted under (plus reading)
//   8  SF_FILE_* · SF_EXECUTABLE            regular files only (no link), bounded, and only .md and .json:
//                                           executable artifacts are refused in this release, whatever a
//                                           setting says
//   9  SF_SCRIPT_BLOCK · SF_COMMAND_*       a fenced block holds only Orbit commands, each one its own usage
//                                           header documents, and none that is a person's (--human, approve,
//                                           trust)
//   10 SF_HIDDEN_CHARS · SF_INJECTION · SF_SECRET   no hidden or reordering characters, no known instruction-
//                                           override patterns, no secret-shaped value
//
//   validateSkill(candidate, deps) -> { ok, findings: [{ id, says }] }
//   candidate: { id, files: [{ name, kind, bytes, text }] } · deps: { shipped, toolsOf, documented, resolve, engineVersion, satisfies }
import { printable } from "../printable.mjs";
import { scrub } from "../scrub.mjs";
import { frontmatter, frontmatterBlock } from "./frontmatter.mjs";
import { problemsOf } from "./instruction.mjs";
import { manifestFindings } from "./manifest.mjs";
import { DRAFTED_UNDER, ID, LIMITS, MANIFEST, READ_TOOLS, SKILL_FILE } from "./vocab.mjs";

const fileOf = (c, name) => c.files.find((f) => f.name === name) ?? null;

const manifestOf = (c) => {
  try { return JSON.parse(fileOf(c, MANIFEST)?.text ?? "null"); }
  catch { return undefined; }
};

const finding = (id, says) => ({ id, says });

const each = (id, list, say) => list.map((x) => finding(id, say(x)));

// ---- the playbook's text -------------------------------------------------------------------------

// A fenced block the way a CommonMark reader sees one: ``` or ~~~, three or more, indented at most three
// spaces, closed by the same character at least as long -- and an unclosed fence runs to the end. Reading
// fences any narrower than a host's markdown would let a ~~~ or an indented block carry a script past this rule.
const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)/;

// A backtick fence's info string can never hold a backtick: ``` `rm -rf ~` ``` is inline code, not a fence.
const opener = (line) => ((m) => (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`")) ? m : null))(OPEN.exec(line));

const SHELLS = ["", "sh", "bash", "zsh", "shell", "console", "powershell", "pwsh", "ps1", "cmd", "bat"];

// A line a fence may hold: blank, a comment, or ONE Orbit command and its plain arguments -- nothing a shell would
// read as a second command (; & | ` $( > < or a line continuation), so what this rule sees is what a shell runs.
const ORBIT_LINE = /^\s*(#.*)?$|^\s*node\s+(<engine>|\$\{CLAUDE_PLUGIN_ROOT\}|"\$\{CLAUDE_PLUGIN_ROOT\}")\/cli\/[a-z][a-z-]*\.mjs(\s+[^;&|`$<>()\\\n]*)?$/;

const closes = (line, open) => new RegExp(`^ {0,3}${open.mark[0] === "`" ? "`" : "~"}{${open.mark.length},}\\s*$`).test(line);

const step = (acc, line) => (acc.open ? (closes(line, acc.open) ? { done: [...acc.done, acc.open], open: null } : { ...acc, open: { ...acc.open, lines: [...acc.open.lines, line] } }) : ((m) => (m ? { ...acc, open: { mark: m[1], lang: m[2].toLowerCase(), lines: [] } } : acc))(opener(line)));

export const fences = (text) => ((acc) => [...acc.done, ...(acc.open ? [acc.open] : [])])(String(text).split(/\r?\n/).reduce(step, { done: [], open: null }));

const allowedLine = (l) => ORBIT_LINE.test(l) && commandsOf(l).every(allowedCommand);

const badFences = (text) => fences(text).filter((f) => !SHELLS.includes(f.lang) || f.lines.some((l) => !allowedLine(l)));

// What a playbook may tell a host to run, as an ALLOW-list: Orbit commands that read, or that ask an owner
// through its own gated door, and nothing else. A deny-list of dangerous commands is always one command short
// (a `verify` that loads a candidate's code, a `run` that executes a case); an allow-list is not. Each entry is
// held by test/skill-factory-validate.test.mjs to a subcommand its CLI's own usage header documents.
export const PLAYBOOK_COMMANDS = {
  automation: ["context", "plan", "status", "doctor", "protocol", "where"],
  task: ["show", "events", "list"],
  live: ["status"],
  query: ["check", "doctor", "history", "storage", "capabilities", "extensions", "dsl", "verb", "field", "triage"],
  "plan-check": ["every"],
  knowledge: ["claims", "why", "verify", "opportunities", "where"],
  requirements: ["status", "show", "where"],
  runtime: ["status", "doctor"],
  architecture: ["facts", "why", "capabilities", "where"],
  engineering: ["facts", "why", "recall", "where"],
  "skill-factory": ["list", "show", "where"],
};

// Every script a text names, however it is written -- `node <engine>/cli/x.mjs y`, quoted, relative, with a
// backslash, any runner, any script extension -- and the word after it.
const SCRIPT = /([A-Za-z0-9_-]+)\.(mjs|cjs|js|ts|py|sh|bash|zsh|ps1|psm1|bat|cmd|rb|pl)["'`]?(?:\s+["'`]?([a-z][a-z-]*))?/gi;

const commandsOf = (text) => [...text.matchAll(SCRIPT)].map((m) => ({ tool: m[1], ext: m[2].toLowerCase(), sub: m[3] ?? "" }));

const allowedCommand = (x) => x.ext === "mjs" && (PLAYBOOK_COMMANDS[x.tool] ?? []).includes(x.sub);

// An inline code span with a space in it is something a host would RUN: it is held to the same allow-list as a
// fenced line. A one-word span (a name, a path, an identifier) is just text. Spans are found the way a markdown
// reader finds them -- a whole run of backticks opens one, and only a run of the SAME length closes it -- line
// by line over the WHOLE text, never with fences cut out first (a second idea of where a fence ends would be a
// second parser; a fenced line can hold no backtick anyway, so this only adds checks).
const runsOf = (line) => [...line.matchAll(/`+/g)].map((m) => ({ at: m.index, len: m[0].length }));

const spanStep = (line) => (acc, run, i, runs) => (acc.skip.has(i) ? acc : ((j) => (j < 0 ? acc : { spans: [...acc.spans, line.slice(run.at + run.len, runs[j].at)], skip: new Set([...acc.skip, ...range(i, j)]) }))(runs.findIndex((r, k) => k > i && r.len === run.len)));

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

const lineSpans = (line) => runsOf(line).reduce(spanStep(line), { spans: [], skip: new Set() }).spans;

const spansOf = (text) => String(text).split(/\r?\n/).flatMap(lineSpans).map((t) => t.trim()).filter((t) => /\s/.test(t));

// A runner handed code to execute, by its SHAPE (this engine names no tool): any program given inline code
// (-e, -c, --eval, --require, --import …), a module loaded by expression, or text piped into a bare word at the
// end of a line (`… | sh`). What a sentence of prose tells a host is past any pattern; Control approval puts a person in front of that.
const RUNNERS = /\b[a-z][\w.-]*[ \t]+(-e|-c|-E|-p|--eval|--exec|--command|-Command|--print|--require|-r|--import|--loader|--experimental-loader)\b|\b(import|require)\s*\(|^(?![ \t]*\|).*\|[ \t]*[a-z]{1,12}([ \t]+-[a-z]+)*[ \t]*$/im;

const PERSON_ONLY = /--human\b|\b(approve|trust)\b|task\.mjs\s+resume/;

const ZERO_WIDTH = new RegExp(`[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0x2060)}${String.fromCharCode(0xfeff)}]`);

// A CRLF line end is a line end; a lone carriage return (which a markdown reader also treats as one, and a
// line-by-line rule here would not) is a hidden character.
const hidden = (text) => ((t) => printable(t) !== t || ZERO_WIDTH.test(t))(String(text).replace(/\r\n/g, "\n"));

// Known ways generated or project text tries to take over the host reading it. A table of patterns cannot
// be complete -- the action policy is the guard -- but these never pass.
export const INJECTION = [
  /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?)\b/i,
  /\byou are now\b/i,
  /\bsystem prompt\b/i,
  /<!--/,
  /\bdo not (tell|inform|show)\b[^.\n]{0,30}\b(user|person|human)\b/i,
  /\b(curl|wget|invoke-webrequest|iwr)\b[^\n]{0,80}https?:/i,
  /[A-Za-z0-9+/]{80,}={0,2}/,
  /\b(bypass|disable|skip)\b[^.\n]{0,30}\b(approval|policy|gate|validation|validator)\b/i,
];

// One task's records, by the ids the engine gives them (src/task, src/work, src/requirements, src/investigation): a
// playbook registered for a project is reused by the next workflow, and an id in it would read the wrong task (1.8.6).
const RECORD_IDS = /\b(?:tsk|w|req|rs)-[0-9a-f]{12}\b|\binv-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}\b/g;

const texts = (c) => c.files.filter((f) => /\.(md|json)$/.test(f.name)).map((f) => f.text ?? "");

// What a host is SHOWN and follows: the .md files. The manifest's tool list is a declaration, held by SF_TOOLS.
const instructions = (c) => c.files.filter((f) => f.name.endsWith(".md")).map((f) => f.text ?? "");

// ---- tools -------------------------------------------------------------------------------------------

const wildcard = (t) => /\*/.test(t) && !/^Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/cli\/[a-z][a-z-]*\.mjs( [a-z][a-z-]*)?\*\)$/.test(t);

// Every frontmatter line must be one this reader accounts for: a `key:` at the start of a line, or text indented
// under one. A quoted key, a complex key, an anchor or a tag is something a YAML reader would see and this one
// would not -- two readers, two answers -- so a draft holding one is refused rather than half read.
const unread = (text) => frontmatterBlock(text).split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#") && !/^[A-Za-z][\w-]*:(\s|$)/.test(l) && !/^\s+\S/.test(l));

const yamlOnly = (text) => /^\s*[?&*!]|:\s*[&*!]/m.test(frontmatterBlock(text));

// The SKILL.md's own `allowed-tools`, as a host would read it, may name nothing the manifest does not: two
// lists that disagree are two answers to what the playbook may use, and validation reads both.
const frontTools = (c) => ((f) => (Array.isArray(f?.["allowed-tools"]) ? f["allowed-tools"] : String(f?.["allowed-tools"] ?? "").split(/,\s*/).filter(Boolean)))(frontmatter(fileOf(c, SKILL_FILE)?.text ?? ""));

const notDeclared = (c) => frontTools(c).filter((t) => !(manifestOf(c)?.allowedTools ?? []).includes(t));

const widerThan = (c, deps) => ((m) => (m ? (m.allowedTools ?? []).filter((t) => !READ_TOOLS.includes(t) && !(deps.toolsOf(m.workflow) ?? []).includes(t)) : []))(manifestOf(c));

// ---- the table ------------------------------------------------------------------------------------------

export const RULES = [
  { id: "SF_SKILL_MISSING", stops: true, check: (c) => (fileOf(c, SKILL_FILE) ? [] : [finding("SF_SKILL_MISSING", "the draft has no SKILL.md — write it, then put it into the draft")]) },
  { id: "SF_INSTRUCTION", stops: true, check: (c) => each("SF_INSTRUCTION", problemsOf(c.id, fileOf(c, SKILL_FILE).text), (s) => s) },
  { id: "SF_FRONTMATTER_UNREAD", stops: true, check: (c) => [...each("SF_FRONTMATTER_UNREAD", unread(fileOf(c, SKILL_FILE).text), (l) => `the frontmatter line "${l.trim().slice(0, 60)}" is not a plain key this reader reads — a quoted or complex key would mean something else to a YAML reader`), ...(yamlOnly(fileOf(c, SKILL_FILE).text) ? [finding("SF_FRONTMATTER_UNREAD", "the frontmatter uses a YAML anchor, alias, tag or complex key — write plain keys and values")] : [])] },
  { id: "SF_ID", check: (c, deps) => [...(ID.test(c.id) ? [] : [finding("SF_ID_INVALID", `${c.id} is not a playbook id: lower case letters, digits and dashes, 2 to 48`)]), ...(c.id.startsWith("orbit-") || c.id.startsWith("orbit-") ? [finding("SF_ID_RESERVED", "orbit- and orbit- name shipped skills; a generated playbook never takes them")] : []), ...(deps.shipped.names.has(c.id) ? [finding("SF_ID_SHIPPED", `${c.id} is a shipped skill or agent — a playbook never shares its identity`)] : [])] },
  { id: "SF_MANIFEST", check: (c) => (manifestOf(c) === undefined || !fileOf(c, MANIFEST) ? [finding("SF_MANIFEST_MISSING", "manifest.json is missing or not JSON")] : [...manifestFindings(manifestOf(c)), ...(manifestOf(c).id === c.id ? [] : [finding("SF_MANIFEST_SHAPE", `the manifest's id is not ${c.id}`)])]) },
  { id: "SF_ENGINE_RANGE", check: (c, deps) => ((m) => (m?.engine && deps.satisfies(deps.engineVersion, m.engine).ok !== true ? [finding("SF_ENGINE_RANGE", `drafted for ${m.engine}, and this engine is ${deps.engineVersion}`)] : []))(manifestOf(c)) },
  { id: "SF_PROVIDES_SHIPPED", check: (c, deps) => each("SF_PROVIDES_SHIPPED", (manifestOf(c)?.provides ?? []).filter((p) => deps.shipped.provides.has(p)), (p) => `${p} is what a shipped component provides — a playbook never replaces one`) },
  { id: "SF_NEED_UNPROVIDED", check: (c, deps) => each("SF_NEED_UNPROVIDED", (manifestOf(c)?.needs ?? []).map((n) => ({ n, r: deps.resolve(n) })).filter((x) => x.r?.outcome !== "provided"), (x) => `${x.n} is not provided here (${x.r?.why ?? "nothing answered"}) — that is a capability gap a person decides, and no playbook is registered on it`) },
  { id: "SF_WORKFLOW", check: (c) => (manifestOf(c)?.workflow && manifestOf(c).workflow !== DRAFTED_UNDER ? [finding("SF_WORKFLOW_FIXED", `a playbook is drafted under ${DRAFTED_UNDER}, the coordinator that drafts it — not ${manifestOf(c).workflow}: a draft never chooses whose tools it borrows`)] : []) },
  { id: "SF_TOOLS", check: (c, deps) => [...each("SF_TOOLS_UNDECLARED", notDeclared(c), (t) => `SKILL.md allows ${t}, which manifest.json does not declare — the two must say the same`), ...each("SF_TOOLS_WILDCARD", [...new Set([...(manifestOf(c)?.allowedTools ?? []), ...frontTools(c)])].filter(wildcard), (t) => `${t} is a wildcard — a playbook names exactly the Orbit commands it runs`), ...(manifestOf(c)?.workflow && deps.toolsOf(manifestOf(c).workflow) === null ? [finding("SF_WORKFLOW_UNKNOWN", `${manifestOf(c).workflow} is not a shipped skill`)] : each("SF_TOOLS_WIDER", widerThan(c, deps), (t) => `${t} is wider than ${manifestOf(c).workflow} allows itself — a playbook never gets more than the workflow it was drafted under`))] },
  { id: "SF_FILES", check: (c) => [...each("SF_FILE_LINK", c.files.filter((f) => f.kind !== "file"), (f) => `${f.name} is not a regular file (a link or a directory) — a playbook is flat files only`), ...each("SF_EXECUTABLE", c.files.filter((f) => f.kind === "file" && !/\.(md|json)$/.test(f.name)), (f) => `${f.name} is not a playbook file — executable artifacts are refused in this release`), ...(fileOf(c, SKILL_FILE).bytes > LIMITS.skillBytes || c.files.reduce((n, f) => n + f.bytes, 0) > LIMITS.totalBytes || c.files.filter((f) => f.name.endsWith(".md")).length > LIMITS.references + 1 ? [finding("SF_TOO_LARGE", `a playbook is at most ${LIMITS.skillBytes} bytes of SKILL.md, ${LIMITS.references} references and ${LIMITS.totalBytes} bytes in all`)] : [])] },
  { id: "SF_COMMANDS", check: (c) => instructions(c).flatMap((t) => [...each("SF_SCRIPT_BLOCK", badFences(t), (f) => `a ${f.lang || "plain"} block holds something other than Orbit commands a playbook may run — a playbook runs no script`), ...each("SF_COMMAND_NOT_ALLOWED", commandsOf(t).filter((x) => !allowedCommand(x)), (x) => `${x.tool}.${x.ext} ${x.sub || ""} is not a command a playbook may name — only the read-only Orbit commands in PLAYBOOK_COMMANDS`.replace(/ +—/, " —")), ...each("SF_COMMAND_NOT_ALLOWED", spansOf(t).filter((span) => !allowedLine(span)), (span) => `\`${span.slice(0, 60)}\` reads as a command, and it is not one a playbook may name`), ...(RUNNERS.test(t) ? [finding("SF_COMMAND_NOT_ALLOWED", "it hands code to a runner to execute (inline code, a module loaded by expression, or text piped into a program)")] : []), ...(PERSON_ONLY.test(t) ? [finding("SF_COMMAND_PERSON_ONLY", "it names a person's decision (--human, approve, trust, resume) — a playbook never takes one")] : [])]) },
  { id: "SF_BOUND_TO_RECORD", check: (c) => instructions(c).flatMap((t) => each("SF_BOUND_TO_RECORD", [...new Set(t.match(RECORD_IDS) ?? [])].slice(0, 3), (id) => `it names ${id} — a playbook serves every task that needs its capability, so it writes <task> or <work> and asks the step for the record, never one task's id`)) },
  { id: "SF_TEXT", check: (c) => texts(c).flatMap((t) => [...(hidden(t) ? [finding("SF_HIDDEN_CHARS", "it holds control, zero-width or reordering characters")] : []), ...each("SF_INJECTION", INJECTION.filter((p) => p.test(t)).slice(0, 1), () => "it holds text that tries to override a host's instructions or a gate"), ...(scrub(t) !== t ? [finding("SF_SECRET", "it holds a secret-shaped value — a playbook names a secret's variable, never its value")] : [])]) },
];

export function validateSkill(candidate, deps) {
  const findings = [];
  for (const rule of RULES) {
    findings.push(...rule.check(candidate, deps));
    if (rule.stops && findings.length) break;
  }
  return { ok: findings.length === 0, findings };
}
