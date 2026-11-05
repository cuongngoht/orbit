// The ROUTING CORPUS (0.5.0, B22 M2 with B5 inside it): realistic prompts in English and Vietnamese, each with what a
// careful engineer wants the router to say -- its intent, how much Orbit it needs (the strategy) and what that names
// (`top`: the component the strategy activates, the open work it resumes, or null for NONE). Every prompt runs through
// the router subscriber itself, with a world bound the way cli/router-hook.mjs binds it: this plugin's own registry with
// nothing managed or observed, Claude Code's host row, the automation settings' defaults, and the open work a corpus row
// says this session has. The expectations are the corpus's; the code is held to them, never the other way round.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHost } from "../skills/orbit-learn/hosts/index.mjs";
import { defaultsOf } from "../src/automation/settings.mjs";
import { routedWorkflow } from "../src/automation/workflows.mjs";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { lifecycleEvent } from "../src/lifecycle/event.mjs";
import { router } from "../src/lifecycle/subscribers/router.mjs";
import { pluginBuiltins, pluginComponents } from "../src/resources/plugin.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { INTENTS, GENERAL } from "../src/routing/intents.mjs";
import { ACTIVATION_PATHS, STRATEGY_WORDS } from "../src/routing/strategy.mjs";
import { realIo } from "../src/store/io.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const CORPUS = readFileSync(join(REPO, "test", "fixtures", "routing", "corpus.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const REGISTRY = getEffectiveResources({ env: {}, plugin: "orbit", components: () => pluginComponents(REPO, io), builtins: () => pluginBuiltins(REPO, io), capabilities: () => [], mcp: () => [], tools: () => [] }, PROVIDERS);
const CLAUDE = readCatalog(io, catalogFile(REPO, "hosts")).hosts.find((h) => h.id === "claude");
const WORK = "w-0123456789ab";

// Kinds a router must say NOTHING about, whatever else it gets wrong.
const SILENT = ["greeting", "chit-chat", "status", "notification", "opt-out"];

// The open work a corpus row says this session has, as src/work/track/open.mjs would answer for it.
const workOf = (row) => (ask) => ({ named: row.open?.ref && ask.refs.some((r) => r.toLowerCase() === row.open.ref.toLowerCase()) ? [owned(row)] : [], current: row.open?.current && ask.continued ? owned(row) : null });
const owned = (row) => ({ id: WORK, open: true, owner: { what: row.open.owner ?? "workflow", id: "tsk-0123456789ab" } });

// One prompt, as Claude Code hands it to the hook, through the router -- the decision it made and the text it added.
function routed(row) {
  const event = lifecycleEvent(resolveHost({ hook_event_name: "UserPromptSubmit" }), { hook_event_name: "UserPromptSubmit", session_id: "corpus-session", cwd: REPO, prompt: row.prompt });
  const seen = {};
  const world = { routing: () => true, resources: () => REGISTRY, host: resolveHost({ hook_event_name: "UserPromptSubmit" }), input: {}, plugin: "orbit", engine: "/plugin", callVia: "node /plugin/cli/mcp.mjs call", automation: () => defaultsOf(), workflowOf: (c) => routedWorkflow(c).id, hostRow: () => CLAUDE, openWork: workOf(row), traced: (decision, _facts, injected) => Object.assign(seen, { decision, injected }) };
  const answer = router.run(event, world);
  return { decision: seen.decision, text: answer?.hookSpecificOutput?.additionalContext ?? null };
}

const RESULTS = CORPUS.map((row) => ({ row, ...routed(row) }));

const rate = (rows, hit) => rows.filter(hit).length / rows.length;
const intentHit = (r) => r.decision.intent.id === r.row.intent;
const strategyHit = (r) => r.decision.strategy.word === r.row.strategy;
const topHit = (r) => (r.decision.activation.id ?? null) === r.row.top;
const inLanguage = (lang) => RESULTS.filter((r) => r.row.lang === lang);
const missed = (hit) => RESULTS.filter((r) => !hit(r)).map((r) => `${r.row.lang} ${JSON.stringify(r.row.prompt.slice(0, 70))}`);

test("the corpus holds at least 100 English and 60 Vietnamese prompts, each with an intent, a strategy and what it names", () => {
  assert.ok(inLanguage("en").length >= 100, `${inLanguage("en").length} English`);
  assert.ok(inLanguage("vi").length >= 60, `${inLanguage("vi").length} Vietnamese`);
  const intents = new Set([GENERAL, ...INTENTS.map((i) => i.id)]);
  for (const row of CORPUS) {
    assert.ok(["en", "vi"].includes(row.lang) && intents.has(row.intent) && STRATEGY_WORDS.includes(row.strategy), JSON.stringify(row).slice(0, 120));
    assert.equal(row.top === null, row.strategy === "NONE", `${row.prompt.slice(0, 60)}: NONE names nothing, and everything else names something`);
  }
  for (const word of STRATEGY_WORDS) assert.ok(CORPUS.some((row) => row.strategy === word), `the corpus asks for ${word} somewhere`);
});

test("the router reads at least 90% of the corpus's intents right, in each language", (t) => {
  for (const lang of ["en", "vi"]) t.diagnostic(`intent ${lang}: ${(100 * rate(inLanguage(lang), intentHit)).toFixed(1)}%`);
  t.diagnostic(`intent misses: ${missed(intentHit).join(" | ")}`);
  for (const lang of ["en", "vi"]) assert.ok(rate(inLanguage(lang), intentHit) >= 0.9, `${lang}: ${(100 * rate(inLanguage(lang), intentHit)).toFixed(1)}%`);
});

test("the router chooses at least 90% of the corpus's strategies right, in each language", (t) => {
  for (const lang of ["en", "vi"]) t.diagnostic(`strategy ${lang}: ${(100 * rate(inLanguage(lang), strategyHit)).toFixed(1)}%`);
  t.diagnostic(`strategy misses: ${missed(strategyHit).join(" | ")}`);
  for (const lang of ["en", "vi"]) assert.ok(rate(inLanguage(lang), strategyHit) >= 0.9, `${lang}: ${(100 * rate(inLanguage(lang), strategyHit)).toFixed(1)}%`);
});

test("what the strategy names is what the corpus expects for most prompts, and is always a path the table knows", (t) => {
  t.diagnostic(`top: ${(100 * rate(RESULTS, topHit)).toFixed(1)}% -- misses: ${missed(topHit).join(" | ")}`);
  assert.ok(rate(RESULTS, topHit) >= 0.85, `${(100 * rate(RESULTS, topHit)).toFixed(1)}%`);
  for (const r of RESULTS) assert.ok(ACTIVATION_PATHS.includes(r.decision.activation.path), r.row.prompt.slice(0, 60));
});

test("a greeting, chit-chat, a status question, a host's notification and an opt-out get no text at all", () => {
  for (const r of RESULTS.filter((x) => SILENT.includes(x.row.kind))) assert.equal(r.text, null, `${r.row.lang} ${r.row.prompt.slice(0, 80)}`);
  for (const r of RESULTS.filter((x) => x.row.kind === "notification")) assert.deepEqual([r.decision.synthetic, r.decision.strategy.row], [true, "envelope"], r.row.prompt.slice(0, 60));
});

test("whatever the router says stays inside its budget, opens with the strategy, and never repeats the prompt", () => {
  for (const r of RESULTS.filter((x) => x.text)) {
    assert.ok(Buffer.byteLength(r.text) <= 2048, r.row.prompt.slice(0, 60));
    assert.match(r.text, /^Orbit strategy: (DIRECT|COORDINATED|SATELLITE|RESUME) -- /);
    assert.equal(r.text.includes(r.row.prompt.trim().slice(0, 40)), false, `${r.row.prompt.slice(0, 40)} was echoed`);
  }
  assert.ok(RESULTS.filter((x) => x.text).length >= 40, "and it does say something for the requests it should");
});
