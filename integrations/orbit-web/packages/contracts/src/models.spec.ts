import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogRefusals, effortFor, FALLBACK_CATALOG, isEffortChoice, isModelChoice, modelLabel, type ModelCatalog } from "./models.js";

const account: ModelCatalog = {
  source: "account",
  recommended: "sonnet",
  detail: null,
  models: [
    { id: "sonnet", label: "Sonnet 5.5", description: null, efforts: ["low", "medium", "high"], autoMode: true },
    { id: "claude-mythos-5", label: "Mythos 5", description: null, efforts: ["high", "max"], autoMode: false },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", description: null, efforts: [], autoMode: false },
  ],
};

test("a model and an effort are the CLI's words: never an option, never whitespace", () => {
  for (const ok of ["opus", "claude-haiku-4-5-20251001", "sonnet[1m]", "claude-opus-4.6"]) assert.equal(isModelChoice(ok), true, ok);
  for (const bad of ["-x", "--dangerously-skip-permissions", "a b", "", "x".repeat(81), 3]) assert.equal(isModelChoice(bad), false, String(bad));
  assert.equal(isEffortChoice("xhigh"), true);
  for (const bad of ["High", "-low", "a b", ""]) assert.equal(isEffortChoice(bad), false, bad);
});

test("the account's catalog refuses a model it does not list, an effort the model does not take, and Autonomous without auto mode", () => {
  assert.deepEqual(catalogRefusals(account, { model: "sonnet", effort: "medium", mode: "autonomous" }), []);
  assert.match(catalogRefusals(account, { model: "opus" })[0] ?? "", /not a model this Claude account can use/);
  assert.match(catalogRefusals(account, { model: "claude-mythos-5", effort: "low" })[0] ?? "", /takes the effort levels high, max/);
  assert.match(catalogRefusals(account, { model: "claude-mythos-5", effort: "high", mode: "autonomous" })[0] ?? "", /not available with Mythos 5/);
  assert.deepEqual(catalogRefusals(account, { model: "claude-haiku-4-5-20251001", effort: "max", mode: "plan" }), [], "a model that takes no effort level ignores one");
  assert.deepEqual(catalogRefusals(FALLBACK_CATALOG, { model: "claude-anything", effort: "max", mode: "autonomous" }), [], "the fallback leaves the choice to the CLI");
});

test("an effort a model does not take moves to medium when it has it, else its first; a model that takes none gets none", () => {
  const [sonnet, mythos, dated] = account.models;
  assert.equal(effortFor(sonnet ?? null, "high"), "high");
  assert.equal(effortFor(sonnet ?? null, "max"), "medium");
  assert.equal(effortFor(mythos ?? null, "medium"), "high");
  assert.equal(effortFor(dated ?? null, "medium"), null);
  assert.equal(effortFor(null, "xhigh"), "xhigh", "a model the catalog does not know keeps what was asked");
  assert.equal(modelLabel("claude-mythos-5", account), "Mythos 5");
  assert.equal(modelLabel("opus"), "Opus 5.5");
  assert.equal(modelLabel("claude-unknown"), "claude-unknown");
});
