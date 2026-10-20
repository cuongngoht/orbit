import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { interpolateStep } from "../src/dsl/interpolate.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { planSteps } from "../src/run/plan.mjs";
import { verifyBlock } from "../src/plan/verify-block.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));
const meta = graph.meta;

// `url` was computed from the RAW attribute and spread in AFTER the interpolated
// copy, so it overwrote it: a goto to "/items/${ID}" with ID=42 reached the
// runner still carrying ${ID}, and then failed as an unresolved placeholder --
// for a value that had been supplied on the command line all along.
test("a parameterised goto url is really interpolated, whether it is literal or off the map", () => {
  const bound = (c, values) => planSteps(c, graph).map((s) => interpolateStep(s, values));

  const literal = bound({ start: "home", steps: [{ do: "goto", url: "/items/${ID}" }] }, { ID: "42" });
  assert.equal(literal[0].url, "/items/42");

  const viaScreen = bound({ start: "home", steps: [{ do: "goto", screen: "home" }] }, {});
  assert.equal(viaScreen[0].url, "/home", "a screen's own url still comes off the map");

  const unknown = bound({ start: "home", steps: [{ do: "goto", url: "/items/${ID}" }] }, {});
  assert.equal(unknown[0].url, "/items/${ID}", "an unbound placeholder stays visible for the runner to refuse");
});

// What a deferred timing means, and what an untraceable layer entry is called,
// are the project's sentences. The engine only places them.
test("the script carries the map's own words for a deferred effect", () => {
  const fx = { on: "home/Delete", api: "DELETE api/things/{id}", backend: "app", timing: "deferred", layers: { queue: [{ topic: "thing-removed", consumer: "cleanup", src: "y.cs:31" }] } };
  const text = verifyBlock(fx, meta).join("\n");
  assert.match(text, /Deferred: The 2xx is not success here/);
  assert.match(text, /NOT VERIFIABLE FROM THE BROWSER/);
  assert.match(text, /QUEUE: thing-removed -> cleanup — y.cs:31/);
});

test("a control that persists nothing gets no row to assert", () => {
  const text = verifyBlock({ on: "home/Add", backend: "none", timing: "sync", persistedBy: "dlg-thing/Save" }, meta).join("\n");
  assert.match(text, /the write happens at dlg-thing\/Save/);
  assert.doesNotMatch(text, /NOT VERIFIABLE/);
});
