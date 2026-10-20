// Where the session's page is, as a caller needs it before step 1:
//   NONE     no browser is open in the run directory -- run the launcher
//   BUSY     a browser IS there but could not answer just now -- retry
//   SIGNIN   parked on a sign-in page -- a human has to finish it
//   <host>   signed in and painted; compare against the origin's host
//
// NONE and BUSY must not be conflated: an eval issued while the SPA bounces
// through the auth redirect throws "Execution context was destroyed", and a
// version that called that "no session" made a healthy browser look absent,
// intermittently. Only the CLI's own "is not open" means nothing is there.
//
// WHICH hosts mean "a sign-in page" is the PROJECT's fact: they belong to its
// identity provider and no two products share one. project.json lists them
// under `signIn.hosts`; with none listed, no host is ever SIGNIN.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export function createState(session, evaluator, signInHosts = []) {
  const state = () => classify(evaluator.ev("location.hostname"), signInHosts);
  const settle = (predicate, tries = 40) => {
    for (let i = 1; i <= tries; i++) {
      if (evaluator.truthy(predicate)) return i;
    }
    return null;
  };
  return { state, settled: (tries = 20) => settled(state, tries), settle, profile: () => profileOf(session.dir()) };
}

// What the CLI says when nothing is open, and what the engine says when the run
// directory itself is absent. Both mean NONE -- "run the launcher" -- and
// neither must be confused with BUSY, which means "retry".
const NO_SESSION = /is not open|playwright-cli open|does not exist/;

function classify(host, signInHosts) {
  if (typeof host !== "string") return "BUSY";
  if (host.startsWith("ERROR")) return NO_SESSION.test(host) ? "NONE" : "BUSY";
  return signInHosts.some((h) => host.includes(h)) ? "SIGNIN" : host;
}

// Polls through BUSY; returns NONE only if the browser is still absent after a
// few attempts, so a launcher that has just started one gets a fair chance.
function settled(state, tries) {
  let s = "NONE";
  for (let i = 0; i < tries; i++) {
    s = state();
    if (s !== "BUSY" && !(s === "NONE" && i < 3)) return s;
  }
  return s;
}

// Which signed-in profile this session drives, read from the browser's own
// config -- the launcher's real choice, not what a caller believes it passed.
function profileOf(dir) {
  try {
    const cfg = JSON.parse(readFileSync(join(dir, ".playwright", "cli.config.json"), "utf8"));
    return cfg?.browser?.userDataDir ? basename(cfg.browser.userDataDir) : null;
  } catch { return null; }
}
