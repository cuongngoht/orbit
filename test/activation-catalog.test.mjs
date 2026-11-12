// What a HOST reads to pick Orbit by itself (0.5.0, B22 M1, ADR 0050): each skill's and agent's description, held to
// the listing's budget and to saying WHEN in its first sentence, and the catalog rows that say which agents only a
// parent's playbook dispatches. Claude Code drops the descriptions of the least-used skills once its listing overflows,
// so a description that is too long, or that says when to use it last, is a skill the model never picks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { pluginBuiltins, pluginComponents } from "../src/resources/plugin.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { FACTS, FACT_WORDS } from "../src/routing/facts.mjs";
import { INTENTS, REFINEMENTS } from "../src/routing/intents.mjs";
import { classify } from "../src/routing/classify.mjs";
import { decide, route } from "../src/routing/resolve.mjs";
import { gramsOf, keyOf } from "../src/routing/terms.mjs";
import { realIo } from "../src/store/io.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const CATALOG = readCatalog(io, catalogFile(REPO, "components"));
const COMPONENTS = pluginComponents(REPO, io);
const SKILLS = COMPONENTS.filter((c) => c.kind === "skill").map((c) => c.name);
const AGENTS = COMPONENTS.filter((c) => c.kind === "agent").map((c) => c.name);

const SKILL_LIMIT = 300;
const SKILLS_TOTAL = 7500;

const fileOf = (kind, name) => join(REPO, ...(kind === "skill" ? ["skills", name, "SKILL.md"] : ["agents", `${name}.md`]));
const text = (kind, name) => readFileSync(fileOf(kind, name), "utf8");
const bodyOf = (kind, name) => ((t) => t.slice(t.indexOf("\n---", 3) + 4))(text(kind, name));

// The description as the host reads it -- the release gate's own reading (skills/orbit-release/gates.mjs `folded`).
const descriptionOf = (kind, name) => /^description:([\s\S]*?)\n(?:[a-z-]+:|---)/m.exec(text(kind, name))[1].replace(/^\s*[>|][-+]?/, "").replace(/\s+/g, " ").trim();

const firstSentence = (d) => /^.*?[.!?](?=\s|$)/.exec(d)?.[0] ?? d;

const rowOf = (kind, name) => CATALOG[kind === "skill" ? "skills" : "agents"][name];

const viaOf = (name) => rowOf("agent", name).via ?? [];

// The words that bring a prompt to a component: a cue of an intent or a refinement that asks for what it provides, or
// one of its own signals. An agent only a parent dispatches is reached through that parent, so its parent's name is.
const reaching = (kind, name) => (kind === "agent" && viaOf(name).length ? viaOf(name) : [...(rowOf(kind, name).signals ?? []), ...[...INTENTS, ...REFINEMENTS].filter((r) => r.requires.some((q) => rowOf(kind, name).provides.includes(q))).flatMap((r) => r.cues)]);

const all = [...SKILLS.map((name) => ["skill", name]), ...AGENTS.map((name) => ["agent", name])];

test("every skill description fits the listing: at most 300 characters each and 7,500 together, and no description reads as markup", () => {
  for (const name of SKILLS) assert.ok(descriptionOf("skill", name).length <= SKILL_LIMIT, `${name}: ${descriptionOf("skill", name).length} characters`);
  const total = SKILLS.reduce((n, name) => n + descriptionOf("skill", name).length, 0);
  assert.ok(total <= SKILLS_TOTAL, `the skills' descriptions total ${total} characters`);
  assert.equal(SKILLS.length, 26, "the budget was set for the 26 skills that ship");
  for (const [kind, name] of all) assert.doesNotMatch(descriptionOf(kind, name), /[<>]/, `${name}: a host refuses a description that reads as XML`);
});

test("every description's first sentence carries a word that brings a prompt to that component", () => {
  for (const [kind, name] of all) {
    const grams = gramsOf(firstSentence(descriptionOf(kind, name)));
    assert.ok(reaching(kind, name).some((word) => grams.has(keyOf(word))), `${kind} ${name}: "${firstSentence(descriptionOf(kind, name))}" carries none of ${reaching(kind, name).join(", ")}`);
  }
});

test("an agent says how it is dispatched in its first words: a direct one is used proactively, one with a parent only from it", () => {
  for (const name of AGENTS) {
    const d = descriptionOf("agent", name);
    if (viaOf(name).length) assert.match(d, /^Only from /, `${name} is dispatched via ${viaOf(name).join(", ")}`);
    if (!viaOf(name).length) assert.match(d, /^Use proactively /, `${name} has no parent, so the session dispatches it`);
  }
});

test("five agents are direct and the other fifteen have a parent (ADR 0050)", () => {
  const direct = AGENTS.filter((name) => !viaOf(name).length).sort();
  assert.deepEqual(direct, ["orbit-dsl-doctor", "orbit-engineering-agent", "orbit-engineering-observer", "orbit-failure-analyst", "orbit-qa-agent"]);
  assert.equal(AGENTS.length - direct.length, 15);
  for (const name of SKILLS) assert.equal(rowOf("skill", name).via, undefined, `${name}: a skill is never dispatched via another`);
});

test("every via names a shipped skill whose playbook names the agent", () => {
  for (const name of AGENTS) {
    for (const parent of viaOf(name)) {
      assert.ok(SKILLS.includes(parent), `${name} names ${parent}, which is not a shipped skill`);
      assert.match(bodyOf("skill", parent), named(name), `${parent}'s SKILL.md never names ${name}, so nothing dispatches it`);
    }
  }
});

const named = (agent) => new RegExp(`(^|[^a-z-])${agent}([^a-z-]|$)`);

test("every agent a playbook names is direct or lists that playbook as its parent", () => {
  for (const skill of SKILLS) {
    for (const agent of AGENTS.filter((a) => named(a).test(bodyOf("skill", skill)))) assert.ok(!viaOf(agent).length || viaOf(agent).includes(skill), `${skill} names ${agent}, whose parents are ${viaOf(agent).join(", ")}`);
  }
});

// Reachable: a requirement an intent or a refinement asks for, or one a reachable component (or a built-in) needs or
// can use -- grown until nothing more is reached.
function reachable() {
  const rows = [...Object.values(CATALOG.skills), ...Object.values(CATALOG.agents), ...Object.values(CATALOG.builtins)];
  let asked = new Set([...INTENTS, ...REFINEMENTS, ...FACTS].flatMap((r) => r.requires));
  for (let grown = true; grown; ) {
    const more = rows.filter((row) => row.provides.some((p) => asked.has(p))).flatMap((row) => [...(row.needs ?? []), ...(row.optional ?? [])]);
    grown = more.some((r) => !asked.has(r));
    asked = new Set([...asked, ...more]);
  }
  return asked;
}

test("every component meant to be used proactively -- every skill, every direct agent -- is reached from an intent, a refinement or a need", () => {
  const asked = reachable();
  for (const [kind, name] of all.filter(([kind, name]) => kind === "skill" || !viaOf(name).length)) assert.ok(rowOf(kind, name).provides.some((p) => asked.has(p)), `${kind} ${name} provides ${rowOf(kind, name).provides.join(", ")}, which nothing asks for`);
  for (const name of AGENTS.filter((a) => viaOf(a).length)) assert.ok(viaOf(name).some((parent) => rowOf("skill", parent).provides.some((p) => asked.has(p))), `${name} is reached through no parent`);
});

// The rule above reads the catalog's lists and nothing else, so a row that says `requiresSignal` with no signal a
// prompt could carry -- or a provider another always outranks -- would still pass it. This one asks the REAL router:
// for every skill and direct agent there is a prompt, made only of the table's own words (two cues of what asks for
// what it provides, a refinement's cue, its parent's own witness for a need, and one of its own signals where it is
// gated), that the resolver SELECTS it for. A signal-gated component nothing can reach fails here by name.
const REGISTRY = getEffectiveResources({ env: {}, plugin: "orbit", components: () => COMPONENTS, builtins: () => pluginBuiltins(REPO, io), capabilities: () => [], mcp: () => [], tools: () => [] }, PROVIDERS);
const providesAny = (row, provided) => row.requires.some((q) => provided.includes(q));
const firstWithin = (r) => INTENTS.find((i) => r.within.includes(i.id))?.cues.slice(0, 2) ?? [];
const askingWords = (provided) => [...INTENTS.filter((r) => providesAny(r, provided)).map((r) => r.cues.slice(0, 2)), ...REFINEMENTS.filter((r) => providesAny(r, provided)).flatMap((r) => r.cues.map((c) => [...(r.within.includes("*") ? [] : firstWithin(r)), c]))];
const parentsOf = (provided) => Object.entries(CATALOG.skills).filter(([, row]) => [...(row.needs ?? []), ...(row.optional ?? [])].some((n) => provided.includes(n))).map(([name]) => name);
const selects = (prompt, kind, name) => [...route(prompt, REGISTRY).selected, ...route(prompt, REGISTRY).approval].some((e) => e.kind === kind && e.id === name);

function witnessOf(kind, name, depth = 0) {
  const row = rowOf(kind, name);
  const bases = [...askingWords(row.provides), ...(depth < 2 ? parentsOf(row.provides).map((p) => [witnessOf("skill", p, depth + 1)]).filter(([w]) => w) : [])];
  const signals = row.requiresSignal || parentsOf(row.provides).length ? [...(row.signals ?? []), ...(row.requiresSignal ? [] : [""])] : [""];
  return bases.flatMap((words) => signals.map((s) => [...words, s].filter(Boolean).join(". "))).find((prompt) => selects(prompt, kind, name)) ?? null;
}

// Two direct agents carry exactly the capability a skill provides, and the resolver's family order puts the skill first:
// a request asked directly is done in the session, where the person sees it, and the agent is the coordinator's and the
// host's to dispatch (design §3.6, "shadowed"). They are the only components the router may never select.
const SHADOWED = ["agent orbit-engineering-agent", "agent orbit-qa-agent"];

test("every skill and direct agent is SELECTED by the real router for some prompt made of the table's own words", () => {
  const unreached = all.filter(([kind, name]) => kind === "skill" || !viaOf(name).length).filter(([kind, name]) => !witnessOf(kind, name));
  assert.deepEqual(unreached.map(([kind, name]) => `${kind} ${name}`), SHADOWED, "nothing the catalog, the intents and the refinements say can bring a prompt to these");
  for (const shadowed of SHADOWED.map((s) => s.split(" ")[1])) assert.ok(SKILLS.some((skill) => rowOf("agent", shadowed).provides.every((p) => rowOf("skill", skill).provides.includes(p)) && witnessOf("skill", skill)), `${shadowed} is shadowed only by a skill the router does select`);
  for (const name of AGENTS.filter((a) => viaOf(a).length)) assert.equal(selects([...askingWords(rowOf("agent", name).provides).flat(), ...(rowOf("agent", name).signals ?? [])].join(". "), "agent", name), false, `${name} is never selected straight from a prompt's words, its own signals included`);
});

// A description is a promise the host reads before it reads the body. "Reads only" promises that the playbook writes
// nothing at all, which is false for one that records facts into Orbit's store or opens a task of its own: what such a
// playbook keeps from is the SOURCE, and its description says that instead.
const WRITES = /cli\/task\.mjs\s+create|cli\/(?:architecture|engineering|knowledge)\.mjs\s+record(?!\s+--dry)/;

test("a playbook that records into Orbit's store or opens a task never describes itself as reading only", () => {
  for (const name of SKILLS.filter((s) => WRITES.test(bodyOf("skill", s)))) assert.doesNotMatch(descriptionOf("skill", name), /\bReads only\b/i, `${name} records or opens a task, so it does not read only`);
});

test("the catalog's own doc says each thing once: no sentence of it is said again inside another", () => {
  const sentences = CATALOG.doc.split(/(?<=\.)\s+/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean);
  assert.deepEqual(sentences.filter((s, i) => sentences.some((other, j) => j !== i && other.includes(s))), []);
});

test("engineering.context has a provider: the engine's own engineering recall, never a skill's guess", () => {
  const row = CATALOG.builtins["engineering-memory"];
  assert.deepEqual(row.provides, ["engineering.context"]);
  assert.match(row.run, /^node <engine>\/cli\/engineering\.mjs recall --for=/);
  assert.match(readFileSync(join(REPO, "cli", "engineering.mjs"), "utf8"), /node engineering\.mjs recall \[--for=/, "the command it runs is one the CLI documents");
});

test("orbit-release is recommended only for Orbit itself: signals that name it, none repeated, no bare word", () => {
  const signals = rowOf("skill", "orbit-release").signals;
  assert.equal(new Set(signals).size, signals.length, "a signal listed twice");
  for (const s of signals) assert.ok(keyOf(s).split(" ").length > 1 && /\borbit\b/.test(keyOf(s)), `${s} is a bare word or does not name Orbit`);
  assert.equal(rowOf("skill", "orbit-release").requiresSignal, true);
});

// Conditions of use (0.6.0, P1): a row's `reactsTo` names facts about a session's work, never words. Words, derivers and
// rows are held to each other both ways: a word no row reacts to, or a row reacting to a word nobody derives, is a
// condition that can never bring anything in -- and a row reacts only to what its OWN playbook says it handles.
const ROWS = [...Object.entries(CATALOG.skills).map(([name, row]) => ["skill", name, row]), ...Object.entries(CATALOG.agents).map(([name, row]) => ["agent", name, row])];

test("every reactsTo word is a FACTS word, and every FACTS word has a deriver and a row that reacts to it and provides what it requires", () => {
  for (const [kind, name, row] of ROWS) for (const word of row.reactsTo ?? []) assert.ok(FACT_WORDS.includes(word), `${kind} ${name} reacts to ${word}, which src/routing/facts.mjs does not declare`);
  for (const f of FACTS) {
    assert.equal(typeof f.derive, "function", `${f.fact} has no deriver`);
    assert.ok(f.requires.length > 0 && f.say.length > 0, `${f.fact} requires nothing or says nothing`);
    const reacting = ROWS.filter(([, , row]) => (row.reactsTo ?? []).includes(f.fact));
    assert.ok(reacting.length > 0, `no row reacts to ${f.fact}`);
    assert.ok(f.requires.every((q) => reacting.some(([, , row]) => row.provides.includes(q))), `${f.fact} requires ${f.requires.join(", ")}, which no row reacting to it provides`);
  }
  assert.equal(new Set(FACT_WORDS).size, FACT_WORDS.length, "a fact declared twice");
});

test("a row reacts only to a fact its own playbook says what it does about", () => {
  for (const [kind, name, row] of ROWS) for (const word of row.reactsTo ?? []) assert.ok(bodyOf(kind, name).includes(`\`${word}\``), `${kind} ${name} reacts to ${word}, and its playbook never says what it does when brought in by it`);
});

test("a fact that holds brings its component in through the real resolver, with no word of the prompt naming it", () => {
  for (const f of FACTS) {
    const decision = decide(classify(""), REGISTRY, { observed: [{ fact: f.fact, subject: "x" }] });
    const reacting = ROWS.filter(([, , row]) => (row.reactsTo ?? []).includes(f.fact)).map(([kind, name]) => `${kind} ${name}`);
    assert.ok([...decision.selected, ...decision.approval].some((e) => reacting.includes(`${e.kind} ${e.id}`)), `${f.fact} selected none of ${reacting.join(", ")}`);
    assert.equal(decision.strategy.shown, true, `${f.fact}: a component chosen on a fact is said`);
    assert.deepEqual(decide(classify(""), REGISTRY, {}).selected.filter((e) => e.kind === "skill" || e.kind === "agent"), [], "and without it, an empty prompt chooses nothing");
  }
});
