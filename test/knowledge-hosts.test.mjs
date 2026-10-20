// HOST MEMORY is a pluggable evidence source that is never truth: a fake
// provider proves the contract in the core, and the Claude Code adapter is
// held to it against a directory laid out the way the host lays out its own.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createClaudeMemory } from "../skills/orbit-learn/hosts/claude-memory.mjs";
import { kept } from "../skills/orbit-learn/native.mjs";
import { gathered } from "../src/knowledge/gather.mjs";
import { recalled } from "../src/knowledge/host-memory.mjs";
import { ingest } from "../src/knowledge/ingest.mjs";
import { measured, query } from "../src/knowledge/query.mjs";
import { hostMemoryFile } from "../src/project/runtime.mjs";
import { realIo } from "../src/store/io.mjs";
import { tokens } from "../src/tokens.mjs";
import { candidate, knowledgeWorld, seenBy } from "./fakes/knowledge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMPL = { id: "is-realised-by", role: "implementation", cardinality: "one" };

function fakeProvider(hints, calls = []) {
  return { id: "fakehost", doc: "a host that remembers in memory", recall: (ask) => (calls.push(ask), { hints, unknowns: [] }) };
}

const HINT = { id: "note-7", title: "gamma handler password=hunter2", text: "the gamma handler: gateway.alpha is realised by mechanism.hinted, see src/app/group.ts", paths: ["src/app/group.ts", "/etc/passwd"], claims: [{ subject: "gateway.alpha", relation: "is-realised-by", object: "mechanism.hinted" }] };

function world(calls) {
  const ctx = knowledgeWorld({ relations: [IMPL], providers: [fakeProvider([HINT], calls)] });
  ingest(ctx, [candidate({ subject: "gateway.alpha", relation: "is-realised-by", object: "mechanism.real", evidence: ["src/app/group.ts"] })], { seenBy: seenBy() });
  return ctx;
}

const ask = (words) => ({ tokens: tokens(words), subjects: [], context: {}, near: [], changed: [] });

test("a hint steers TARGETED discovery: it points at a known concept the task never named, and at a tracked scope to confirm", () => {
  const g = gathered(world(), ask("look at the gamma handler"));
  assert.deepEqual(g.targets.subjects, ["gateway.alpha"]);
  assert.deepEqual(g.targets.scopes, ["src/app"]);
  assert.ok(g.ask.subjects.includes("gateway.alpha"), "the question now asks about it");
});

test("a hint is never confirmed truth and never stored, however often it is recalled", () => {
  const ctx = world();
  const before = [...ctx.io.files.entries()].map(([k, v]) => `${k}\u0000${v}`).sort();
  for (let i = 0; i < 3; i++) gathered(ctx, ask("the gamma handler"));
  assert.deepEqual([...ctx.io.files.entries()].map(([k, v]) => `${k}\u0000${v}`).sort(), before, "the store is byte for byte what it was");
  const session = gathered(ctx, ask("the gamma handler")).recall.claims[0];
  assert.deepEqual([session.source, session.layer, session.confidence, session.evidence[0].startsWith("host:fakehost#")], ["host-memory", "session", "possible", true]);
});

test("current source outranks the hint, and the conflict is kept and shown -- neither rewritten", () => {
  const ctx = world();
  const g = gathered(ctx, ask("the gamma handler"));
  const answer = query(g.claims, g.ask, ctx.parts, measured(ctx, g.stored)).answers.find((a) => a.relation.id === "is-realised-by");
  assert.deepEqual([answer.status, answer.prevails[0].claim.object, answer.prevails[0].tier], ["known", "mechanism.real", "source"]);
  assert.deepEqual([answer.rivals[0].claim.object, answer.rivals[0].tier], ["mechanism.hinted", "host-memory"]);
  assert.equal(ctx.know.all().length, 1, "the hint's claim is still nowhere in the store");
});

test("a provider is handed TOKENS, never the task's text; its titles are scrubbed; its untracked paths are dropped", () => {
  const calls = [];
  const g = gathered(world(calls), ask("look at the gamma handler, my secret is s3cr3t-value"));
  assert.deepEqual(Object.keys(calls[0]).sort(), ["context", "limit", "tokens"]);
  assert.equal(JSON.stringify(calls[0]).includes("look at the"), false);
  assert.doesNotMatch(g.recall.hints[0].title, /hunter2/);
  assert.deepEqual(g.recall.hints[0].paths, ["src/app/group.ts"]);
});

test("a provider that throws, or is not a provider at all, costs one unknown -- never the answer", () => {
  const out = recalled([{ id: "broken", recall: () => { throw new Error("disk on fire"); } }, { nope: true }, fakeProvider([HINT])], ask("gamma handler"), { tracked: new Set() });
  assert.equal(out.hints.length, 1);
  assert.equal(out.unknowns.length, 2);
});

// ---- the Claude Code adapter ---------------------------------------------------------------

function hostTree() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-hostmem-")));
  const memory = join(base, "home", ".claude", "projects", "-repo-demo", "memory");
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, "MEMORY.md"), "- [Gamma](gamma.md) — the index, never read as a hint\n");
  writeFileSync(join(memory, "gamma.md"), "---\nname: gamma handler notes\ndescription: where the gamma handler lives\n---\nThe gamma handler is in src/app/group.ts. Docs: https://user:pw@internal.example/x and /Users/someone/private.\n<!-- a comment about legacy-module -->\n");
  writeFileSync(join(memory, "orbit-arch-overview.md"), "---\nname: Orbit page\n---\ngamma gamma gamma\n");
  return { base, memory, project: { layout: 3, root: join(base, "repo"), runtime: base, sessionDir: join(base, "session") } };
}

const record = (dir) => ({ v: 1, dir, how: "transcript", host: hostname(), at: new Date().toISOString(), scope: null, untrusted: false, off: null });

test("the Claude adapter reads topic notes only, strips what could carry a secret or Orbit's own echo, and hands back hints", () => {
  const t = hostTree();
  const file = hostMemoryFile(t.project);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record(t.memory)));
  const out = createClaudeMemory({ project: t.project, env: {}, io: realIo(), home: join(t.base, "home"), host: hostname() }).recall({ tokens: ["gamma", "handler"] });
  assert.deepEqual(out.hints.map((h) => h.id), ["gamma.md"], "not the index, not a Orbit page");
  assert.equal(out.hints[0].title, "gamma handler notes");
  assert.doesNotMatch(out.hints[0].text, /internal\.example|\/Users\/someone|legacy-module/);
  assert.deepEqual(out.hints[0].paths, ["src/app/group.ts"]);
});

test("without a recorded location it falls back to the USER's own settings, and otherwise says it does not know", () => {
  const t = hostTree();
  const config = join(t.base, "config");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "settings.json"), JSON.stringify({ autoMemoryDirectory: t.memory }));
  const viaSettings = createClaudeMemory({ project: { ...t.project, sessionDir: join(t.base, "other") }, env: { CLAUDE_CONFIG_DIR: config }, io: realIo(), home: join(t.base, "home"), host: hostname() }).recall({ tokens: ["gamma"] });
  assert.equal(viaSettings.hints.length, 1);
  const unknown = createClaudeMemory({ project: { ...t.project, sessionDir: join(t.base, "none") }, env: {}, io: realIo(), home: join(t.base, "empty"), host: hostname() }).recall({ tokens: ["gamma"] });
  assert.deepEqual([unknown.hints.length, /no Claude Code memory directory is known/.test(unknown.unknowns[0])], [0, true]);
});

test("a recorded location from another machine, or one whose shape is wrong, is ignored", () => {
  const t = hostTree();
  const file = hostMemoryFile(t.project);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...record(t.memory), host: "some-other-laptop" }));
  const deps = { project: t.project, env: {}, io: realIo(), home: join(t.base, "nothing"), host: hostname() };
  assert.equal(createClaudeMemory(deps).recall({ tokens: ["gamma"] }).hints.length, 0);
  writeFileSync(file, JSON.stringify(record(t.base)));
  assert.equal(createClaudeMemory(deps).recall({ tokens: ["gamma"] }).hints.length, 0, "a transcript-found directory is always <…>/projects/<p>/memory");
});

test("what a hook keeps of a discovery drops the transcript path (the raw session id) and the working directory, and never a repository's choice", () => {
  const found = { v: 1, dir: "/h/.claude/projects/p/memory", how: "transcript", from: "/h/.claude/projects/p/raw-session-id.jsonl", cwd: "/repo", host: "h", at: "t", scope: null, untrusted: false, off: null };
  assert.deepEqual(Object.keys(kept(found)).sort(), ["at", "dir", "host", "how", "off", "scope", "untrusted", "v"]);
  assert.equal(kept({ ...found, untrusted: true, how: "settings" }).dir, null);
});

test("no host-specific word or path lives in the knowledge core or the trail", () => {
  for (const dir of ["knowledge", "trace"]) {
    const files = readdirSync(join(ROOT, "src", dir), { recursive: true }).filter((f) => String(f).endsWith(".mjs"));
    for (const f of files) assert.doesNotMatch(readFileSync(join(ROOT, "src", dir, String(f)), "utf8"), /\bclaude\b|\.claude|transcript_path|MEMORY\.md|autoMemory/i, `src/${dir}/${f}`);
  }
});
