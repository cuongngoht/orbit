// A project's SEAT in the machine store (1.8.9): the least a store needs to be the home of a Git checkout's test
// data -- a project.json naming the project, the schema that file points at, and the generated schemas an editor
// validates a case and a plan against -- written on an EXPLICIT invocation (`/orbit-help`, `init`, a workflow's
// `start`), never on a read, and never more than once.
//
// Nothing is invented: no screen, no case, no graph, no sample, no origin nobody gave. What the application IS
// stays unknown until it is mapped (orbit-ui-map) or a person says (project.json); a seat only lets the rest of the
// engine write where it will later look. A checkout whose test data lives in the checkout is bound and nothing of
// its data is touched, and an explicitly selected test directory (ORBIT_UI_TESTS) gets nothing at all:
// that data is a team's own, and only a person moves it (cli/storage.mjs).
//
// The seat composes vocabulary schemas; the store primitives only write files safely.
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { caseSchema } from "./dsl/index.mjs";
import { planSchema } from "./qa/schema.mjs";
import { Refused } from "./errors.mjs";
import { requireUiTests } from "./project/locate.mjs";
import { repositoryPaths } from "./project/repository.mjs";
import { ensureBound, ensureSeat } from "./store/bootstrap.mjs";
import { CASE_SCHEMA, PLAN_SCHEMA, SCHEMA_DIR } from "./tests-tree.mjs";

const ENGINE = dirname(dirname(fileURLToPath(import.meta.url)));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// What a seat IS: a path inside the test data and how its bytes are made. The schemas are the bytes
// `cli/schema.mjs --write` writes, so `query check` finds them current.
export const SEAT = [
  { rel: "project.json", make: (p, o) => json({ $schema: "./project.schema.json", name: basename(p.root), ...(o.origin ? { origin: o.origin } : {}) }) },
  { rel: "project.schema.json", make: () => readFileSync(join(ENGINE, "schemas", "project.schema.json"), "utf8") },
  { rel: `${SCHEMA_DIR}/${CASE_SCHEMA}`, make: () => json(caseSchema()) },
  { rel: `${SCHEMA_DIR}/${PLAN_SCHEMA}`, make: () => json(planSchema()) },
];

// What an explicit invocation does, by where the test data lives. Ordered; the last row always matches.
export const SEATING = [
  { when: (p) => p.layout !== 3, run: () => ({ status: "loose", created: [] }) },
  { when: (p) => p.dataHome === "checkout", run: (p, env) => ({ status: "checkout", created: ensureBound(p, env) }) },
  { when: () => true, run: (p, env, o) => seatedAs(ensureSeat(p, SEAT.map((s) => ({ rel: s.rel, make: () => s.make(p, o) })), env)) },
];

const seatedAs = (created) => ({ status: created.includes("project.json") ? "created" : "present", created });

// -> { paths, status: "created" | "present" | "checkout" | "loose", created: [rel…] }. Outside a Git checkout, with
// no loose data either, it is Refused; a store that cannot be written is Blocked, never a write somewhere else.
// `opts.checkout` (init, which names its checkout) resolves the Git checkout at `cwd` itself, whatever
// ORBIT_UI_TESTS or a walk-up would have found; `opts.projectId` keys it as init --project-id does.
export function ensureProject(env = process.env, cwd = process.cwd(), opts = {}) {
  const paths = opts.checkout || opts.projectId ? checkoutWith(env, cwd, opts.projectId ?? null) : requireUiTests(env, cwd);
  const row = SEATING.find((r) => r.when(paths));
  return { paths, ...row.run(paths, env, opts) };
}

function checkoutWith(env, cwd, projectId) {
  const paths = repositoryPaths(cwd, env, projectId);
  if (!paths) throw new Refused(`${cwd} is not inside a Git checkout — Orbit keeps one project per repository`);
  return paths;
}
