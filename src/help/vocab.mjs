// What orbit-help may recommend next, as DATA — never an if-chain over state.
// The first row whose `when` matches the gathered state wins; the last row is
// unconditional, so a caller always gets exactly one answer.
//
// The state is what the project already knows, and — when a task was named
// (`--for`) — what that task is ABOUT, as the prompt router classifies it
// (`task.intent`, a table word; the task's text is never kept). So:
//
//   resources     a task about MCP servers, CLI tools or Orbit Control goes to
//                 orbit-control, whatever else is missing: managing what Orbit
//                 may use needs no architecture scan
//   requirements a task that names a work item, or a work whose requirement is not
//                 yet complete, goes to orbit-requirements: what the item asks for is
//                 settled and kept before anything is built or tested, and a work
//                 already in progress is picked up where it stopped
//   investigation finding what is wrong in a running app goes to
//                 orbit-qa, which composes its own project context
//                 (cli/context.mjs, memory first), so no scan has to come first
//   environment   running the project, or the place it runs in, goes to
//                 orbit-runtime: what a checkout needs is read from its own
//                 files, so no architecture scan has to come first
//   intelligence  what this project IS or how it builds code goes to orbit-architecture,
//                 which answers from what is kept and reads only where nothing kept speaks
//   architecture  nothing scanned, or a scope that moved, comes BEFORE any work
//                 that needs project context -- development and QA alike. A repository
//                 read once that held nothing a fact could stand on is not sent to be
//                 read again
//   development   a change to the code goes to orbit-develop
//   readiness     (1.8.9) a project that keeps no UI map and no test plan, asked about
//                 nothing a QA workflow is for: what Orbit knows and can do here, and to
//                 name a task -- never the UI-test path a project with no UI never needed
//   qa            otherwise the QA path: the map, then a plan, then a run -- for a QA task,
//                 or a project that already does QA
//
// Only workflows that exist are named here, and a test holds every `run` to a
// shipped skill or CLI: a route naming something nobody can run would be a
// recommendation this command cannot make good on.
//   automation    a named task whose objective a coordinated workflow fits goes to the coordinator BY
//                 DEFAULT -- nothing has to be turned on: `start` runs the workflow step by step. A read-only
//                 question, or anything no workflow fits, gets this navigator's one answer, exactly as before.
//                 Only a restriction a person KEPT from before autonomy was the default (enabled false, mode
//                 manual, trigger.explicitHelp false) sends a task back to the navigator; mode planning only
//                 shows the plan (`plan`)
//   autonomous    a task that asks for a change taken to a verified result, while a person keeps such a
//                 restriction, goes to orbit-engineer
// The intents a UI-testing workflow is for. A project that keeps no map and no plan is sent down the QA path only
// for one of these, never because it has nothing to test with (1.8.9).
export const QA_INTENTS = ["qa", "browser", "investigation"];

const uiWork = (s) => QA_INTENTS.includes(s.task?.intent) || (s.map?.screens ?? 0) > 0 || (s.qa?.plans ?? 0) > 0;

export const ROUTES = [
  {
    id: "automation",
    run: "node <engine>/cli/automation.mjs start",
    when: (s) => Boolean(s.automation?.coordinates),
    because: (s) => `Orbit coordinates a named task by default (mode autonomous, nothing to turn on) and a coordinated workflow fits this task (${s.automation.workflow}): start --for="<the task>" plans it and takes it one decided step at a time${s.task?.intent === "requirements" ? " — it names a work item, so pass it as --ref=<the item> and its requirement is settled and frozen first" : ""}`,
  },
  {
    id: "control",
    run: "orbit-control",
    when: (s) => s.task?.intent === "mcp-tooling",
    because: () => "the task is about what Orbit may use here — MCP servers, CLI tools, policies — and Orbit Control is where a person manages them",
  },
  {
    id: "project-report",
    run: "orbit-report",
    when: (s) => s.task?.intent === "reporting",
    because: () => "the task asks for a project report: orbit-report reads the project's source once, freezes it, and renders the product owner's report offline",
  },
  {
    id: "requirements",
    run: "orbit-requirements",
    when: (s) => s.task?.intent === "requirements" || (s.work?.open ?? 0) > 0,
    because: (s) => (s.task?.intent === "requirements" ? "the task names a work item, PBI, issue or ticket: what it should do is settled, and kept, before anything is built or tested" : `${s.work.open} piece(s) of work rest on a requirement that is not complete yet — continue there`),
  },
  {
    id: "autonomous",
    run: "orbit-engineer",
    when: (s) => s.task?.intent === "autonomous-engineering",
    because: () => "the task asks for a change taken to a verified result: orbit-engineer drives one task through its requirement, workspace, build, tests and review",
  },
  {
    id: "investigation",
    run: "orbit-qa",
    when: (s) => s.task?.intent === "investigation",
    because: () => "the task asks to find what is wrong in a running application: orbit-qa gathers the project context itself (memory first), then investigates inside the gates and reports only what it can prove",
  },
  {
    id: "runtime",
    run: "orbit-runtime",
    when: (s) => s.task?.intent === "environment",
    because: () => "the task is about running this project, or the place it runs in: orbit-runtime reads what the checkout needs from its own files, says what can run on this machine and why, and starts only what a file declared",
  },
  {
    id: "intelligence",
    run: "orbit-architecture",
    when: (s) => ["architecture", "engineering"].includes(s.task?.intent),
    because: () => "the task asks what this project is or how it builds code: orbit-architecture answers from what is already kept, memory first, and reads the repository only where nothing kept speaks to it",
  },
  {
    id: "architecture",
    run: "node <engine>/cli/architecture.mjs ensure",
    when: (s) => s.architecture.total === 0 && !s.architecture.scanned,
    because: (s) => `nothing has scanned this project's technical architecture yet${s.task?.intent === "development" ? " — a change needs that context first" : ""}`,
  },
  {
    id: "architecture",
    run: "node <engine>/cli/architecture.mjs ensure",
    when: (s) => s.architecture.stale > 0,
    because: (s) => `${s.architecture.stale} architecture fact(s) cite a scope that moved and were not re-read`,
  },
  {
    id: "developer",
    run: "orbit-develop",
    when: (s) => s.task?.intent === "development",
    because: () => "the task is a change to the code and architecture is current: orbit-develop reads the project context first, then makes the smallest verified change",
  },
  {
    id: "readiness",
    run: "orbit-help",
    when: (s) => !uiWork(s),
    because: () => "this project keeps no UI map and no test plan, and nothing asked needs one: CAPABILITIES lists what Orbit can do here — name a task (--for=\"…\") and Orbit takes it through",
  },
  {
    id: "map",
    run: "orbit-ui-map",
    when: (s) => s.map.screens === 0,
    because: () => "the UI map records no screens yet",
  },
  {
    id: "qa-plan",
    run: "orbit-test-plan",
    when: (s) => s.qa.plans === 0,
    because: () => "no test plan exists for this project yet",
  },
  {
    id: "qa-plan",
    run: "orbit-test-plan",
    when: (s) => s.qa.errors > 0,
    because: (s) => `${s.qa.errors} plan(s) have a validation error — \`plan-check\` names them`,
  },
  {
    id: "run-tests",
    run: "orbit-test-suite",
    when: () => true,
    because: () => "architecture, the map and the plan are current — nothing else here is known to be missing",
  },
];

export const recommend = (state) => ROUTES.find((r) => r.when(state));
