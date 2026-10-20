import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validate } from "../src/dsl/validate.mjs";
import { loadCase } from "../src/dsl/load.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { selectClaims } from "../src/identity/select.mjs";
import { claimsScript } from "../src/identity/claims-script.mjs";
import { createSession } from "../src/browser/session.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { fakeBrowser } from "./fakes/browser.mjs";
import { fakeContext, UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));
const dir = mkdtempSync(join(tmpdir(), "orbit-identity-"));
const APP = { upn: "a@b.c", roles: ["App.Admin"], aud: ["api://my-app"], iss: "https://idp/x", exp: 9e9 };
const OTHER = { upn: "a@b.c", roles: [], aud: ["https://graph"], iss: "https://idp/x", exp: 9e9 };

// "Most roles wins" picks confidently every time, including when it is wrong,
// and what it decides is whose authority a permission case believes it saw.
test("a token is chosen by what the project declared, never by having the most roles", () => {
  const loud = { ...OTHER, aud: ["https://graph"], roles: ["A", "B", "C"] };
  const chosen = selectClaims([loud, APP], { audience: "api://my-app" });
  assert.deepEqual(chosen.claims.roles, ["App.Admin"], "the declared audience decides, not the role count");

  assert.deepEqual(selectClaims([APP], {}).claims.roles, ["App.Admin"], "one token needs no declaration");
  assert.match(selectClaims([APP, OTHER], {}).problem, /declare identity.audience in ui-tests\/project.json/);
  assert.match(selectClaims([APP, { ...APP, aud: ["api://my-app"] }], { audience: "api://my-app" }).problem, /narrow it with identity.issuer/);
  assert.match(selectClaims([OTHER], { audience: "api://my-app" }).problem, /none of the 1 id token/);
  assert.match(selectClaims([{ ...APP, exp: 5 }], {}, 1000).problem, /have expired/);
  assert.match(selectClaims(null, {}).problem, /no id token could be read/);
});

// The claim that carries the roles is the provider's word, so the project's
// names go into the page script as data. No provider is named in the engine.
test("the page script carries the project's own claim names, and returns no token", () => {
  const script = claimsScript({ rolesClaim: "app_roles", upnClaim: "email" });
  assert.match(script, /const R="app_roles",U="email"/);
  assert.doesNotMatch(script, /secret:[^=]*=>/, "only claims come back, never a token");
  assert.match(claimsScript(), /const R="roles",U="upn"/, "and a sensible default when nothing is declared");
});

// A playwright-cli session is keyed by NAME, not by working directory, so
// switching identity by changing the cwd switched nothing at all.
test("switching identity names the session on every command", () => {
  const seen = [];
  // The invocation is injected, so this asserts the SESSION NAME and not
  // whatever shim resolution this machine happens to need (see process/shim.mjs).
  const s = createSession("/run/a", (bin, args) => { seen.push(args); return ""; }, 30000, { file: "playwright-cli", prefix: [] });
  s.cli(["eval", "1"]);
  s.use("/run/b", "scoped");
  s.cli(["eval", "2"]);
  assert.deepEqual(seen[0], ["eval", "1"], "the default session carries no name");
  assert.deepEqual(seen[1], ["-s=scoped", "eval", "2"]);
  assert.equal(s.dir(), "/run/b");
});

test("identity and identities cannot both be declared, and an `as` needs something to switch to", () => {
  const of = (extra, steps) => validate({ id: "x", _file: "/x.json", name: "x", seen: "src", ...extra, steps: steps ?? [{ do: "report", js: "1", expect: "true" }] }, graph);
  const both = of({ identity: { as: "a", roles: ["r"] }, identities: { a: { roles: ["r"] }, b: { notRoles: ["r"] } } });
  assert.ok(both.some((f) => /use identity OR identities, not both/.test(f)), both.join(" | "));

  const stray = of({ identity: { as: "a", roles: ["r"] } }, [{ do: "as", identity: "a" }, { do: "report", js: "1", expect: "true" }]);
  assert.ok(stray.some((f) => /declares no "identities" to switch between/.test(f)), stray.join(" | "));

  // Two identities nothing could tell apart make a switch unobservable.
  const twins = of({ identities: { a: { roles: ["r"] }, b: { roles: ["r"] } } }, [{ do: "as", identity: "a" }, { do: "report", js: "1", expect: "true" }]);
  assert.ok(twins.some((f) => /identities a and b state the same thing/.test(f)), twins.join(" | "));

  const good = of({ identities: { a: { roles: ["r"] }, b: { notRoles: ["r"] } } }, [{ do: "as", identity: "a" }, { do: "report", js: "1", expect: "true" }]);
  assert.deepEqual(good, []);
});

// The same condition, one step earlier, exits 2 from a gate. It cannot mean two
// different things depending on where it was noticed -- it used to be filed as a
// product FAIL, with evidence and a FAIL line in the shared ledger.
test("a refusal raised by an `as` step stays REFUSED, and is never a product failure", () => {
  const file = join(dir, "two-users.json");
  writeFileSync(file, JSON.stringify({
    id: "two-users", name: "Two users", start: "home", seen: "src",
    identities: { admin: { roles: ["App.Admin"] }, scoped: { notRoles: ["App.Admin"] } },
    steps: [
      { do: "as", identity: "admin" },
      { do: "goto", screen: "home", wait: "document.body.innerText.length>0" },
      { do: "as", identity: "scoped" },
      { do: "report", js: "JSON.stringify({ok:true})", expect: "it.ok === true" },
    ],
  }));
  const recorded = [];
  const browser = fakeBrowser({ answers: [[/^!!/, true], ["location.pathname", "/home"], [/^JSON/, JSON.stringify({ ok: true })]] });
  const ctx = fakeContext({ browser, memory: { recordRun: (r) => recorded.push(r), runs: () => [], saveNote() {}, notes: () => [] } });
  const o = runCase(ctx, [file]);

  assert.equal(o.status, "REFUSED", "the session for `scoped` was never opened");
  assert.deepEqual(recorded.map((r) => r.status), ["REFUSED"], "and the ledger does not call it a product failure");
});
