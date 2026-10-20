// What a prompt is ABOUT, as data: a few broad intents, and the requirements
// each one implies. No model is asked -- this runs on every prompt, before the
// host has answered anything, so it is a table and a Set lookup.
//
// Broad on purpose. An intent is the question "which kind of help is this",
// and there are fifteen; which RESOURCE helps is decided downstream by what each
// resource says it provides (src/routing/select.mjs), never here. So a cue is a
// generic English word, and never a product, a vendor or a
// resource's name: those arrive as a resource's own `signals`, from the
// catalogs the plugin ships.
//
// A cue is at most three terms (src/routing/terms.mjs GRAM_LIMIT). The intent
// with the most cues in the prompt wins, the first row winning a tie; two cues
// or more is `high` confidence, one is `low`. None is `general`, which requires
// nothing -- and a prompt that requires nothing is routed nowhere.
//
// `autonomous-engineering` sits right before `investigation`: "fix the refund rule autonomously
// with autonomous engineering" carries the investigation cue "autonomous" inside its own words, and a
// change driven to verified is not an investigation -- while "autonomous qa on the orders screen"
// has no engineering cue at all and stays one. "autonomously" alone is one cue, so a prompt with more
// words of another intent ("explore the screen autonomously and find bugs") stays that intent.
//
// `investigation` sits right before `qa`: "find out why Save sends two
// requests" or "can tenant B read tenant A's data" is a question for an
// investigation, and on a tie with a test word it stays one -- while "write a
// test case" or "run the regression" has no investigation word at all, so an
// ordinary QA question never pays for an autonomous exploration.
//
// `requirements` sits after `qa` and `investigation` and BEFORE `development`: "implement PBI
// 4312" has one development word and one requirement word, and on that tie a work item is settled
// before it is built -- while "write a test plan for PBI 4312" has two QA words and stays a QA
// question. Its cues are the generic words for a work item. A bare "issue" is not one: "there is
// an issue with the handler" is about code, and "issue number" or "issue id" is about an item.
//
// `environment` sits after `qa`, `investigation` and `reporting` and BEFORE `database`,
// `browser`, `mcp-tooling`, `development` and `documentation`: "how do I run the app" has one
// documentation word and one environment phrase, and on that tie running it is the question --
// while "run the project tests" has a test word of its own and stays a QA question, and
// "implement the handler and run the app" keeps its change because `development` has more words.
// Its cues are the generic phrases for running a project and for the place it runs in. Not one
// names a language, a package manager or a vendor: which tool a project needs is what its own
// files say, discovered, never a cue here.
//
// `development` sits after `qa`, so "fix the failing test" stays a test
// question, and before `documentation`, so "how do I implement ..." is a change
// to make rather than a page to read. "fix" and "bugs" are its words too (1.8.6): "fix the two refund
// bugs so their tests pass" asks for a change to the code, and the tests it must pass do not make it a QA
// question -- while in "find bugs" or "identify bugs" the word is part of an investigation's own phrase, and a cue
// inside another intent's longer cue counts for that intent alone (src/routing/classify.mjs, 1.8.7). `reporting` sits right after `qa`, so a
// "test report" stays a test question on the tie, while "the PO report on PR
// review time" has more of its own words than code review has.

export const GENERAL = "general";

export const INTENTS = [
  { id: "code-review", cues: ["review", "reviews", "pr", "pull request", "merge request", "diff", "code review", "review code"], requires: ["code.review", "repository.read"] },
  { id: "architecture", cues: ["architecture", "architectural", "boundary", "boundaries", "layering", "dependency direction", "module structure"], requires: ["architecture.context", "technology.context"] },
  { id: "engineering", cues: ["convention", "conventions", "coding style", "code style", "best practice", "best practices", "how we build"], requires: ["engineering.context"] },
  { id: "autonomous-engineering", cues: ["autonomous engineering", "autonomously", "until verified", "implement autonomously", "fix autonomously"], requires: ["engineering.execution"] },
  { id: "investigation", cues: ["investigate", "investigation", "find bugs", "find bug", "find a bug", "identify bugs", "hunt for bugs", "look for bugs", "bug hunt", "autonomous", "autonomous qa", "explore", "tenant", "tenants", "cross tenant", "tenant isolation", "duplicate request", "duplicate requests", "two requests", "two api requests", "requests twice", "ui to database", "database record"], requires: ["qa.investigation"] },
  { id: "qa", cues: ["test", "tests", "testing", "regression", "test case", "test cases", "test plan", "qa", "qc", "e2e", "end to end"], requires: ["qa.execution"] },
  { id: "reporting", cues: ["report", "reports", "reporting", "po", "po report", "product owner", "project report", "status report", "sprint report", "weekly report", "monthly report", "burndown", "velocity", "throughput", "cycle time", "lead time", "aging", "forecast"], requires: ["project.reporting"] },
  { id: "environment", cues: ["dev container", "devcontainer", "dev environment", "development environment", "local environment", "runtime environment", "run locally", "start locally", "run the app", "start the app", "run this app", "start this app", "run the application", "start the application", "run the project", "start the project", "run this project", "start this project", "port conflict", "port in use", "get it running", "get this running", "running locally", "run it locally", "on my machine", "on this machine", "needs to run", "need to run", "how to run", "run here", "operating systems"], requires: ["runtime.discovery"] },
  { id: "database", cues: ["sql", "database", "db", "query", "queries", "row", "rows", "stored procedure"], requires: ["database.query"] },
  { id: "browser", cues: ["browser", "screenshot", "web page", "headless"], requires: ["browser.automation", "browser.session"] },
  { id: "release", cues: ["release", "ship", "publish", "version bump", "bump the version", "changelog"], requires: ["release.gate"] },
  { id: "mcp-tooling", cues: ["mcp", "mcp server", "mcp servers", "cli tool", "install tool", "runtime", "control panel", "Orbit Control"], requires: ["mcp.management", "tool.management", "control.panel"] },
  { id: "requirements", cues: ["requirement", "requirements", "pbi", "work item", "user story", "backlog item", "ticket", "issue number", "issue id"], requires: ["requirement.snapshot"] },
  { id: "development", cues: ["implement", "implementation", "implementing", "feature", "new feature", "refactor", "refactoring", "rename", "method", "function", "class", "endpoint", "handler", "backend", "frontend", "bug", "bugs", "bug fix", "bugfix", "fix", "fixes", "fixing", "write code", "code change", "develop", "webhook"], requires: ["development.implementation"] },
  { id: "documentation", cues: ["how does", "how do", "how to", "what is", "what are", "difference between", "documentation", "docs", "explain", "api reference"], requires: ["documentation.search", "technology.context"] },
];

// Narrower requirements a cue adds, but only inside the intents it names
// (`*`: any intent, `general` included). "plan" means a test plan inside a QA
// prompt; inside a release prompt it means nothing this table knows.
export const REFINEMENTS = [
  { within: ["qa"], cues: ["plan", "test plan", "scenario", "scenarios", "coverage", "acceptance criteria"], requires: ["qa.planning"] },
  { within: ["qa"], cues: ["failed", "failing", "failure", "flaky", "why did"], requires: ["failure.classification"] },
  { within: ["qa"], cues: ["write", "author", "new case", "add a case"], requires: ["qa.authoring"] },
  { within: ["qa", "browser"], cues: ["map", "locator", "selector", "drift", "drifted"], requires: ["ui.mapping", "ui.map-repair"] },
  { within: ["qa", "browser", "investigation"], cues: ["explore", "exploratory"], requires: ["ui.exploration"] },
  { within: ["qa"], cues: ["lesson", "lessons", "learned"], requires: ["qa.lessons"] },
  { within: ["development", "qa", "investigation"], cues: ["pbi", "work item", "user story", "backlog item", "ticket", "issue number", "issue id"], requires: ["requirement.snapshot"] },
  { within: ["development"], cues: ["docs", "documentation", "api reference", "sample", "samples"], requires: ["documentation.search"] },
  { within: ["development", "requirements"], cues: ["autonomously", "autonomous engineering", "until verified"], requires: ["engineering.execution"] },
  { within: ["*"], cues: ["where to start", "where do i", "what next"], requires: ["workflow.navigation"] },
];
