import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PLUGIN_ID, PRODUCT, TAGLINE } from "../src/project/naming.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

test("plugin and package identity is orbit 0.0.2", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(REPO, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(PLUGIN_ID, "orbit");
  assert.equal(pkg.name, "orbit");
  assert.equal(pkg.version, "0.0.2");
  assert.equal(plugin.name, "orbit");
  assert.equal(plugin.version, "0.0.2");
  assert.match(pkg.description, new RegExp(PRODUCT.replace(/ /g, ".*")));
  assert.match(pkg.description, /Verified Outcome/);
  assert.equal(TAGLINE, "From Goal to Verified Outcome");
});
