// The Browser PORT: everything the runner may ask of a browser, as one object.
// createBrowser() binds it to playwright-cli; tests bind a fake with the same
// shape (see test/fakes/browser.mjs). Nothing above this file spawns a process.
import { bodyOf, consoleErrors, consoleTotals, parseDetail } from "./detail.mjs";
import { createEval } from "./eval.mjs";
import { parseRequests, summarize } from "./requests.mjs";
import { createSession } from "./session.mjs";

export { BROWSER_CLI, BROWSER_CLI_PACKAGE } from "./session.mjs";
import { createState } from "./state.mjs";

export { highestRequest, newerMatching, parseRequests, summarize } from "./requests.mjs";
export { bodyOf, consoleErrors, consoleTotals, parseDetail } from "./detail.mjs";

export function createBrowser(runDir, deps = {}) {
  const session = createSession(runDir, deps.exec, deps.timeoutMs, deps.invocation, deps);
  const evaluator = createEval(session);
  const state = createState(session, evaluator, deps.signInHosts ?? []);
  return { ...session, ...evaluator, ...state, ...actions(session) };
}

function actions(session) {
  const { cli } = session;
  return {
    goto: (url) => cli(["goto", url]),
    click: (selector) => cli(["click", selector]),
    fill: (selector, value) => cli(["fill", selector, value]),
    press: (key) => cli(["press", key]),
    screenshot: (file) => cli(["screenshot", `--filename=${file}`], true),
    console: () => cli(["console"], true),
    requests: () => cli(["requests"], true),
    requestList: () => parseRequests(cli(["requests"], true)),
    networkSummary: () => summarize(cli(["requests"], true)),
    // One request's detail and its body, by the number `requests` gave it.
    // Both return RAW values (headers verbatim) -- src/network/redact.mjs is
    // the only view of them anything keeps. null when the CLI has none.
    requestDetail: (n) => parseDetail(cli(["--raw", "request", String(n)], true)),
    requestBody: (n) => bodyOf(cli(["--raw", "request-body", String(n)], true)),
    consoleTotals: () => consoleTotals(cli(["console"], true)),
    consoleErrors: () => consoleErrors(cli(["--raw", "console", "error"], true)),
    close: () => cli(["close"], true),
  };
}
