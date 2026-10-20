// What can be VERIFIED right now -- and nothing about whether anything is correct.
//
// Runtime answers one question for the layers that check a product: "what can
// currently be executed or reached here?" It projects four capabilities from what
// the plan, the live sessions and the tools already say:
//
//   browser      can a browser drive an application that is up?
//   http         can an API call reach something that answers?
//   database     can the project's data be read?
//   testRunner   is there a declared way to run its tests, and could it run?
//
// each AVAILABLE, BLOCKED or UNKNOWN, with the reason. That is where this stops. A
// verdict -- this case passed, this finding is a defect -- belongs to a run
// (src/run/status.mjs) and to an investigation (src/investigation/), and READY is
// not one: an application can be perfectly up and wrong. So nothing here ever says
// "healthy", "passing" or "verified", and a test holds that line.
//
// Pure. The database answer is not computed here: whether the project has a way to
// read its data is the QA layer's own question (src/qa/capability.mjs), handed in,
// so the one definition of it is not copied.
import { testCommands } from "./components.mjs";

const answer = (state, because, extra = {}) => ({ state, because, ...extra });

// `input`: { plan, sessions (status's), view, browser (a tool state or null), capabilities }
export function project(input) {
  const app = appAnswer(input);
  return { browser: browserAnswer(input, app), http: app, database: databaseAnswer(input), testRunner: testsAnswer(input) };
}

// Something that is up and can be asked: a running component of Orbit's own that
// declares a port, and what its readiness says.
function appAnswer({ plan, sessions }) {
  const up = sessions.filter((s) => s.state === "RUNNING" && s.ownership === "ORBIT_OWNED");
  if (!up.length) return answer("BLOCKED", plan.overall === "EMPTY" ? "there is nothing to start" : "nothing is running: start it first");
  const ready = up.find((s) => s.readiness.state === "READY");
  return ready ? answer("AVAILABLE", `${ready.component} answers (${ready.readiness.probe.kind} ${ready.readiness.probe.target})`) : answer("UNKNOWN", up.map(unsure).join("; "));
}

const unsure = (s) => `${s.component}: ${s.readiness.state === "NOT_READY" ? "not answering yet" : "nothing says how to tell it is ready"}`;

function browserAnswer({ browser }, app) {
  if (app.state === "BLOCKED") return answer("BLOCKED", app.because);
  if (!browser || browser.state === "UNKNOWN") return answer("UNKNOWN", "whether a browser tool is available here has not been asked");
  if (browser.state === "UNAVAILABLE") return answer("BLOCKED", `no browser tool is available (${browser.reason ?? "not installed"})`);
  return app.state === "AVAILABLE" ? answer("AVAILABLE", `a browser tool is here and ${app.because}`) : answer("UNKNOWN", app.because);
}

function databaseAnswer({ capabilities }) {
  const sql = capabilities?.sql;
  if (!sql) return answer("UNKNOWN", "whether the project can read its data was not asked");
  return sql.can ? answer("AVAILABLE", sql.because || "a way to read the data is configured") : answer("BLOCKED", sql.because || "no way to read the data is configured");
}

// A test command is EVIDENCE that a way to run tests exists. Which of them is the
// right one for a change is not decided here, so every one is named.
function testsAnswer({ view }) {
  const all = view.components.flatMap((c) => testCommands(c).map((t) => ({ component: c.key, declaredAs: t.declaredAs, text: t.text, safe: t.safe })));
  const safe = all.filter((t) => t.safe);
  if (safe.length) return answer("AVAILABLE", `${safe.length} declared test command(s) can be launched`, { commands: all });
  return answer("BLOCKED", all.length ? "the declared test commands need a shell, so they are shown and not launched" : "no file declares a way to run tests", { commands: all });
}
