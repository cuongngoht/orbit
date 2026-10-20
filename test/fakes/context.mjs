// A context over the fixture project with fake ports.
//
// ctx.now is the FAKE BROWSER'S clock, because after src/run/poll.mjs became the
// only wait loop it is the only clock anything waits on -- and every method that
// would be a playwright-cli round trip moves it. So a timeout test runs in
// microseconds, with a deterministic number of attempts, and nothing sleeps.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph } from "../../src/graph/index.mjs";
import { loadProject } from "../../src/project/index.mjs";
import { createContext } from "../../src/run/context.mjs";
import { fakeBrowser, happy, savePost } from "./browser.mjs";
import { fakeFrontend } from "./frontend.mjs";
import { fakeMemory } from "./memory.mjs";
import { seedStore, storeRootIn } from "./store.mjs";
import { fakeTools } from "./tools.mjs";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const UI_TESTS = join(FIXTURES, "ui-tests");

// Never the developer's own ~/.orbit. An in-process test that resolved
// the real store would record runs on the machine running the suite; test/home.mjs
// only protects the tests that SPAWN a command.
function throwaway(project) {
  let root;
  return () => (root ??= storeRootIn(seedStore(null, project), project));
}

export function fixtureProject(env = {}) {
  return loadProject({ ORBIT_UI_TESTS: UI_TESTS, ...env }, FIXTURES);
}

export function fakeContext({ browser = fakeBrowser({ answers: happy(), requests: savePost() }), claims = { upn: "a@b.c", tid: "t", oid: "o", roles: ["App.Admin"] }, db = null, memory = fakeMemory(), frontend = fakeFrontend({ root: null }), tools = fakeTools({ "playwright-cli": { ok: true, said: "0.1.20" } }), env = {}, out = "/tmp/orbit-ui-test-test", store = null } = {}) {
  const project = fixtureProject(env);
  const warnings = [];
  const ctx = createContext({ project, browser, store: store ?? throwaway(project), now: browser.clock?.now ?? Date.now, graph: loadGraph(project.graphDir), env: { ORBIT_UI_TESTS: UI_TESTS, ...env } }, { ORBIT_UI_TESTS: UI_TESTS, ...env }, FIXTURES);
  return { ...ctx, tools, identity: { ...ctx.identity, claims: () => (claims?.problem ? claims : { claims }) }, db: db ?? { query: () => ({ ok: true, rows: [{ n: "1" }] }) }, memory, frontend, warn: (m) => warnings.push(m), warnings, out };
}
