// What ROUTING a prompt costs (0.5.0, B22 M2): router v3 on the hot path, measured, never assumed. Skipped in the
// suite; run it on purpose and read the numbers:
//
//   ORBIT_BENCH=1 node --test --test-reporter=spec test/perf/router.bench.mjs
//
// Shapes:
//   decide   the routing corpus in memory: classify, the resolver, the strategy table and the text, per prompt --
//            the work the hook adds beside reading its snapshots
//   hook     cli/router-hook.mjs as the host runs it, a process per prompt over a fresh store: a greeting (NONE), a
//            direct request, a coordinated one and a notification (synthetic), each the median of seven runs
// Nothing here is a budget, only what this machine did; the hook's own leash is its 5-second timeout (hooks/hooks.json).
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { defaultsOf } from "../../src/automation/settings.mjs";
import { routedWorkflow } from "../../src/automation/workflows.mjs";
import { pluginBuiltins, pluginComponents } from "../../src/resources/plugin.mjs";
import { PROVIDERS } from "../../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../../src/resources/registry.mjs";
import { classify } from "../../src/routing/classify.mjs";
import { formatDecision } from "../../src/routing/format.mjs";
import { decide } from "../../src/routing/resolve.mjs";
import { realIo } from "../../src/store/io.mjs";
import { EMPTY_TMP, sealed } from "../home.mjs";

const skip = !process.env.ORBIT_BENCH;
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const io = realIo();
const corpus = () => readFileSync(join(REPO, "test", "fixtures", "routing", "corpus.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).prompt);
const registry = () => getEffectiveResources({ env: {}, plugin: "orbit", components: () => pluginComponents(REPO, io), builtins: () => pluginBuiltins(REPO, io), capabilities: () => [], mcp: () => [], tools: () => [] }, PROVIDERS);

const median = (fn) => Array.from({ length: 7 }, () => ((t) => (fn(), performance.now() - t))(performance.now())).sort((a, b) => a - b)[3];

const routedText = (prompt, effective) => ((asked) => formatDecision(decide(asked, effective, { workflow: routedWorkflow({ intent: asked.intent.id, matched: asked.matched, requirements: asked.requirements }).id, host: { capabilities: { nativeAgents: true } }, settings: defaultsOf(), work: null })))(classify(prompt));

test("decide: the routing corpus, in memory, per prompt", { skip }, () => {
  const prompts = corpus();
  const effective = registry();
  const ms = median(() => prompts.forEach((p) => routedText(p, effective)));
  console.log(`decide   ${prompts.length} prompts  ${(ms / prompts.length).toFixed(2).padStart(8)} ms per prompt`);
});

const PROMPTS = [["greeting", "hello"], ["direct", "check architecture of this project"], ["coordinated", "Implement PBI 4312"], ["synthetic", "<task-notification>\n<status>completed</status>\n<summary>investigate and explore</summary>\n</task-notification>"]];

for (const [shape, prompt] of PROMPTS) {
  test(`hook: a ${shape} prompt, as the host runs it`, { skip }, (t) => {
    const store = mkdtempSync(join(tmpdir(), "orbit-router-bench-"));
    t.after(() => rmSync(store, { recursive: true, force: true }));
    const input = JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "bench", cwd: EMPTY_TMP, prompt });
    const ms = median(() => spawnSync(process.execPath, [join(REPO, "cli", "router-hook.mjs")], { input, env: sealed({ ORBIT_STORE_DIR: store }), cwd: EMPTY_TMP, encoding: "utf8" }));
    console.log(`hook     ${shape.padEnd(12)} ${ms.toFixed(1).padStart(8)} ms`);
  });
}
