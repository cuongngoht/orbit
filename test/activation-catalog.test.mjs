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
import { pluginComponents } from "../src/resources/plugin.mjs";
import { INTENTS, REFINEMENTS } from "../src/routing/intents.mjs";
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
  assert.equal(SKILLS.length, 25, "the budget was set for the 25 skills that ship");
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
  let asked = new Set([...INTENTS, ...REFINEMENTS].flatMap((r) => r.requires));
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
