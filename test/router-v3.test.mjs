// Router v3 (0.5.0, B22 M2 with B5 inside it, ADR 0050), piece by piece: the head of a prompt outranks a pasted tail,
// Vietnamese is read as itself, a prompt's marks and shape are table words and counts, a one-cue intent is said only
// when a provider's own word chose it, RouteDecision v3 is v2 and three more answers, and the open work a prompt could
// mean is read off the work journals alone. The whole path through the hook is test/router-hook.test.mjs's; the
// accuracy over realistic prompts is test/routing-corpus.test.mjs's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { routedWorkflow } from "../src/automation/workflows.mjs";
import { pluginBuiltins, pluginComponents } from "../src/resources/plugin.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { classify, declared } from "../src/routing/classify.mjs";
import { formatDecision } from "../src/routing/format.mjs";
import { MARKS } from "../src/routing/intents.mjs";
import { ROUTE_DECISION_V3, ROUTE_DECISION_VERSION, decide, route } from "../src/routing/resolve.mjs";
import { GRAM_LIMIT, HEAD_LIMIT, MAX_REFS, OPENING_LIMIT, refsOf, shapeOf, termsOf } from "../src/routing/terms.mjs";
import { realIo } from "../src/store/io.mjs";
import { COMMANDS } from "../src/work/track/index.mjs";
import { GOVERNORS, openWorkOf } from "../src/work/track/open.mjs";
import { CHECKOUT, OTHER_CHECKOUT, trackWorld } from "./work-track.harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const REGISTRY = getEffectiveResources({ env: {}, plugin: "orbit", components: () => pluginComponents(REPO, io), builtins: () => pluginBuiltins(REPO, io), capabilities: () => [], mcp: () => [], tools: () => [] }, PROVIDERS);
const CLAUDE = { id: "claude", capabilities: { nativeAgents: true } };
const SETTINGS = { trigger: { arbitraryPrompt: true } };

const filler = (n) => "lorem ipsum dolor sit amet ".repeat(Math.ceil(n / 27)).slice(0, n);

// The decision the hook makes, with the facts it binds -- no open work, Claude Code, the settings' defaults.
function decided(prompt, work = null) {
  const asked = classify(prompt);
  return decide(asked, REGISTRY, { synthetic: false, plugin: "orbit", workflow: routedWorkflow({ intent: asked.intent.id, matched: asked.matched, requirements: asked.requirements }).id, host: CLAUDE, settings: SETTINGS, work });
}

test("a cue in the head outranks any pasted tail: the person's words decide, and a paste decides nothing", () => {
  const pasted = `can you fix this endpoint?\n${filler(HEAD_LIMIT)}\n${"tests failed in the regression suite, qa and e2e testing broke\n".repeat(20)}`;
  assert.deepEqual(classify(pasted).intent, { id: "development", confidence: "high" }, "two words of the person's own against six of a log's");
  assert.deepEqual(classify(pasted).matched, ["development"], "what the paste names is not what the person asked");
  const silent = `here you go:\n${filler(HEAD_LIMIT)}\nthe regression tests failed, see the e2e testing output`;
  assert.deepEqual([classify(silent).intent.id, classify(silent).requirements], ["general", []], "a paste alone asks for nothing");
  const spec = `implement the export\n${filler(HEAD_LIMIT)}\nAcceptance criteria: the file opens`;
  assert.ok(classify(spec).requirements.includes("goal.orchestration"), "a paste's words still add a refinement");
  const short = "run the regression tests, the e2e ones";
  assert.deepEqual(classify(short).intent, { id: "qa", confidence: "high" }, "a prompt no longer than the head is read as it always was");
});

test("a prompt's marks are table words: opting out anywhere in the head, continuing and halting only where it opens", () => {
  const marks = (p) => classify(p).marks;
  assert.deepEqual(marks("Without Orbit, rename qty to quantity"), ["opt-out"]);
  assert.deepEqual(marks("please don't use Orbit for this one: fix the typo"), ["opt-out"]);
  assert.deepEqual(marks("Không dùng Orbit, đổi tên helper"), ["opt-out"]);
  assert.deepEqual(marks("Continue ORD-12."), ["continue"]);
  assert.deepEqual(marks("tiếp tục đi"), ["continue"]);
  assert.deepEqual(marks(`implement the export, ${filler(OPENING_LIMIT)} and continue with the import afterwards`), [], "continue inside a request is part of the request");
  assert.deepEqual(marks("stop, wait -- don't touch the tests"), ["halt"]);
  assert.deepEqual(marks("dừng lại đã"), ["halt"]);
  assert.deepEqual(marks("how far along are we?"), ["status"]);
  assert.deepEqual(marks("tới đâu rồi?"), ["status"]);
  assert.deepEqual(marks("rename the helper"), []);
  for (const m of MARKS) for (const cue of m.cues) assert.ok(termsOf(cue).length > 0 && termsOf(cue).length <= GRAM_LIMIT, cue);
  assert.deepEqual(MARKS.map((m) => m.id), ["opt-out", "continue", "halt", "status"]);
});

test("a prompt's shape is counts, never a word of it, and its references are the head's work items -- never a standard's name", () => {
  const prompt = "PBI-512: export\n\n1. the list shows an action\n2. the PDF has the total\n- only the owner may download\n* a missing one is 404\nUTF-8 and SHA-256 throughout, see ORD-12";
  assert.deepEqual(shapeOf(prompt), { chars: prompt.length, items: 4, refs: 2 });
  assert.deepEqual(refsOf(prompt), ["PBI-512", "ORD-12"]);
  assert.deepEqual(refsOf(`${filler(HEAD_LIMIT)} ORD-99`), [], "a reference only a pasted tail names is not one the person named");
  assert.equal(refsOf(Array.from({ length: 9 }, (_, i) => `AB-${i}`).join(" ")).length, MAX_REFS);
  assert.deepEqual(Object.keys(classify(prompt).shape).sort(), ["chars", "items", "refs"]);
  assert.deepEqual(declared("development").marks, [], "a declared intent carries no marks of its own");
});

test("Vietnamese is read as itself: each request lands on the intent its English twin does", () => {
  const twins = [
    ["rename qty to quantity in orders.mjs", "đổi tên qty thành quantity trong orders.mjs", "development"],
    ["fix the null reference in the checkout handler", "sửa lỗi null reference trong checkout handler", "development"],
    ["write a test plan for the refund screen", "lập kế hoạch kiểm thử cho màn hình hoàn tiền", "qa"],
    ["investigate why the frontend sends two requests", "điều tra vì sao frontend gửi hai request", "investigation"],
    ["how do I run the app locally", "làm sao chạy app ở local", "environment"],
    ["assess the API against OWASP", "đánh giá bảo mật API theo OWASP", "security"],
    ["make the PO report for the last two months", "làm báo cáo PO cho hai tháng vừa rồi", "reporting"],
    ["check the architecture of this project", "kiểm tra kiến trúc của dự án", "architecture"],
    ["what are our coding conventions?", "dự án này dùng quy ước đặt tên nào?", "engineering"],
    ["explain what applyDiscount does", "giải thích applyDiscount làm gì", "documentation"],
  ];
  for (const [en, vi, intent] of twins) assert.deepEqual([classify(en).intent.id, classify(vi).intent.id], [intent, intent], vi);
});

test("RouteDecision v3 is v2 and three more answers; route() is still the planner's v2", () => {
  const v3 = decided("check architecture of this project");
  const v2 = route("check architecture of this project", REGISTRY);
  assert.deepEqual([v2.version, ROUTE_DECISION_VERSION, v3.version, ROUTE_DECISION_V3], [2, 2, 3, 3]);
  assert.deepEqual(Object.keys(v3).sort(), [...Object.keys(v2), "activation", "strategy", "synthetic"].sort());
  assert.deepEqual(Object.keys(v3.strategy).sort(), ["because", "row", "shown", "word"]);
  assert.deepEqual(Object.keys(v3.activation).sort(), ["how", "id", "invoke", "path"]);
  const { version: _a, strategy: _b, activation: _c, synthetic: _d, ...rest } = v3;
  const { version: _e, ...same } = v2;
  assert.deepEqual(rest, same, "everything v2 said, v3 says the same");
});

test("a one-cue intent is said only when a provider recommended on its own words alone was chosen by one of them", () => {
  const quiet = decided("rename qty to quantity in orders.mjs");
  assert.deepEqual([quiet.strategy.word, quiet.activation.id, quiet.strategy.shown], ["DIRECT", "orbit-develop", false], "the table still says DIRECT, and nothing is said");
  assert.equal(formatDecision(quiet), null);
  const named = decided("check architecture of this project");
  assert.deepEqual([named.intent.confidence, named.strategy.shown], ["low", true], "architecture is orbit-architecture's own word");
  assert.match(formatDecision(named), /^Orbit strategy: DIRECT -- /);
  const noise = decided("ok, report lại giúp mình nhé");
  assert.deepEqual([noise.intent.id, noise.strategy.shown, formatDecision(noise)], ["reporting", false, null], "one generic word in a chat is not a request for the PO report");
  const twoCues = decided("fix the null reference in the checkout handler");
  assert.deepEqual([twoCues.intent.confidence, twoCues.strategy.shown], ["high", true]);
});

test("NONE adds nothing at all, and a said strategy opens the text with one line before what v2 listed", () => {
  for (const p of ["hello", "how far along are we?", "explain what applyDiscount does", "without orbit, fix the typo in the handler"]) {
    const d = decided(p);
    assert.deepEqual([d.strategy.word, formatDecision(d, { engine: "/plugin" })], ["NONE", null], p);
  }
  const d = decided("Implement PBI 4312");
  const text = formatDecision(d, { engine: "/plugin" });
  assert.match(text.split("\n")[0], /^Orbit strategy: COORDINATED -- .*: node \/plugin\/cli\/automation\.mjs start --for="<the task>"\.$/);
  assert.equal(text.split("\n")[1], "Orbit routing context", "then the lines a v2 decision had, unchanged");
  assert.ok(Buffer.byteLength(text) <= 2048);
});

test("SATELLITE is never inferred, through the real classifier and resolver: only Satellite's own words make a mission", () => {
  for (const p of ["refactor the billing module, update every caller, rewrite the docs and the tests, then check for regression and security", "Implement PBI 4312 end to end: the requirement, the change, the tests, the review", "this is a big one: migrate the whole orders platform to the new API across five services"]) assert.notEqual(decided(p).strategy.word, "SATELLITE", p);
  assert.deepEqual([decided("run this as a multi-agent mission: migrate the reporting module").strategy.word, decided("chạy như một mission nhiều agent: chuyển module báo cáo").strategy.word], ["SATELLITE", "SATELLITE"]);
  assert.notEqual(decided("our team's mission is to make checkout faster").strategy.word, "SATELLITE", "the word mission is not a request for one");
});

// ---- the open work a prompt could mean (src/work/track/open.mjs) -------------------------------------------

test("the work a reference names is found by that reference's own id, in this checkout alone, with the owner that governs it", (t) => {
  const w = trackWorld(t);
  const ctx = w.ctx("sess-a");
  const work = COMMANDS.track.run(ctx, ["the refund approval rule", "--ref=ORD-12"]).work;
  assert.deepEqual(openWorkOf(w.works, { refs: ["ORD-12"], continued: false, checkout: CHECKOUT, session: ctx.session }), { named: [{ id: work, open: true, owner: null }], current: null }, "tracked, and nobody governs it yet");
  COMMANDS.link.run(ctx, [work, "--task=tsk-aaaaaaaaaaaa"]);
  COMMANDS.link.run(ctx, [work, "--workflow=tsk-bbbbbbbbbbbb"]);
  assert.deepEqual(openWorkOf(w.works, { refs: ["ord-12", "ORD-12"], checkout: CHECKOUT }).named, [{ id: work, open: true, owner: { what: "workflow", id: "tsk-bbbbbbbbbbbb" } }], "a workflow governs the task it started; one reference, however it is spelled, is one work");
  assert.deepEqual(GOVERNORS, ["workflow", "task", "investigation"]);
  assert.deepEqual(openWorkOf(w.works, { refs: ["ORD-12"], checkout: OTHER_CHECKOUT }).named, [], "another checkout's work is not this one's");
  assert.deepEqual(openWorkOf(w.works, { refs: ["ORD-13"], checkout: CHECKOUT }).named, [], "a reference nobody tracked names nothing");
  COMMANDS.state.run(ctx, [work, "--state=cancelled"]);
  assert.equal(openWorkOf(w.works, { refs: ["ORD-12"], checkout: CHECKOUT }).named[0].open, false);
});

test("this session's current work is looked for only when the prompt says to continue, and never another session's", (t) => {
  const w = trackWorld(t);
  const work = COMMANDS.track.run(w.ctx("sess-a"), ["the refund approval rule"]).work;
  const ask = (session, continued) => openWorkOf(w.works, { refs: [], continued, session: w.ctx(session).session, checkout: CHECKOUT }).current;
  assert.equal(ask("sess-a", false), null, "no continue cue: no journal is scanned");
  assert.deepEqual(ask("sess-a", true), { id: work, open: true, owner: null });
  assert.equal(ask("sess-b", true), null);
});
