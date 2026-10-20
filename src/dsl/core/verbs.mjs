// The core set of verbs, as DATA.
//
// A verb row says what the verb NEEDS (fields that must be present; an inner
// array means "one of these"), which extra fields it OWNS, what KIND of step it
// is, whether it can pass a VERDICT on the product, and what it DOES to the run
// around it. Behaviour lives in run/verbs/<name>.mjs, one file per verb; the
// registry there checks that the two tables agree.
//
// kind:     act      drives the UI (goto, click, fill, press)
//           observe  reads the page and never fails on product behaviour
//           control  changes what the run does next (skip-if, as)
//           verdict  can fail because the PRODUCT is wrong
// verdict:  always   the step is a verdict by itself
//           expect   only when it carries an `expect`
//
// The columns below exist because the alternative was a second list of verb
// names somewhere else, and that is the drift this table was created to end --
// the runner once had one ACT table plus five other verb lists, and adding a
// verb meant finding all six. Anything that needs to ask "which verbs do X" asks
// the REGISTRY, through verbsWhere():
//
// changes:    can alter the product, so a `creates` case needs its skip-if guard
//             in front of it. `goto` is an act and changes nothing.
// navigates:  establishes where the browser is, so the start-screen gate has
//             nothing to check.
// switchesIdentity: selects the session before the first screen action.
// requests:   "mark"  re-base the request watermark before this step -- it may
//                     cause a call, or (as) switch to a different browser's log
//             "since" this step asks what the UI did since that mark
// pageless:   asks nothing of a browser page -- a case made only of these (and
//             no wait, identity or start screen) needs no browser at all
//             (src/dsl/page.mjs). Absent means the verb may read or drive the
//             page, which is the safe reading for a verb nobody described.
// proves:     WHICH of the three layers a verdict rules on: the screen (ui), the
//             call the screen made (api), or the data underneath (sql). A run
//             counted verdicts and nothing else, so `verdicts: 3` read the same
//             whether three asserts had looked at one page or the UI, the API and
//             the database had each answered -- and only the second is a feature
//             anybody tested. Read as a tally, not as a list of names.
//
// Add a verb by adding a row here AND a file in run/verbs/. Nothing else
// changes: the schema, the validator and the runner all derive from these.
//
// This file is DATA and nothing else. Everything that used to be derived from it
// -- verbsWhere, ownersOf, isVerdict, provedBy, LAYERS -- moved to
// dsl/registry.mjs, which answers the same questions over core PLUS whatever a
// project's own extensions registered. Two tables answering one question is the
// drift this table exists to end, and a second derivation would be exactly that.

export const CORE_VERBS = [
  { name: "goto", kind: "act", navigates: true, requests: "mark", doc: "navigate to a screen and assert the path landed", needs: [["screen", "url"]], fields: ["url"] },
  { name: "click", kind: "act", changes: true, requests: "mark", doc: "click the control named by `on` or `selector`", needs: [["on", "selector"]], fields: ["selector"] },
  { name: "fill", kind: "act", changes: true, requests: "mark", doc: "type `value` into the control", needs: [["on", "selector"], "value"], fields: ["selector", "value"] },
  { name: "press", kind: "act", changes: true, requests: "mark", doc: "press a key", needs: ["key"], fields: ["key"] },
  { name: "wait", kind: "observe", doc: "poll a predicate until true", needs: ["js"], fields: ["js"] },
  { name: "assert", kind: "verdict", verdict: "always", proves: "ui", doc: "a fact that must hold now", needs: ["js"], fields: ["js"] },
  { name: "skip-if", kind: "control", doc: "true means the whole case is already done — stop with SKIP", needs: ["js"], fields: ["js"] },
  { name: "screenshot", kind: "observe", doc: "capture the screen into the evidence directory", needs: ["file"], fields: ["file"] },
  { name: "report", kind: "verdict", verdict: "expect", proves: "ui", doc: "record a value; with `expect`, rule on it", needs: ["js"], fields: ["js", "expect", "into"] },
  { name: "api", kind: "verdict", verdict: "always", proves: "api", requests: "since", doc: "assert the call the UI just made and its status", needs: ["match"], fields: ["match", "method", "status"] },
  { name: "sql", kind: "verdict", verdict: "always", proves: "sql", pageless: true, doc: "read the database and rule on the rows", needs: ["query", "expect"], fields: ["query", "expect", "into"] },
  { name: "as", kind: "control", switchesIdentity: true, requests: "mark", doc: "switch which signed-in browser the remaining steps drive", needs: ["identity"], fields: ["identity"] },
  { name: "call", kind: "verdict", verdict: "always", provesStep: true, pageless: true, doc: "ask a registered capability and rule on the answer", needs: ["capability", "expect", "proves"], fields: ["capability", "input", "expect", "select", "into", "proves"] },
];

// The three layers, in the order the table declares them, computed HERE because
// a field row needs them (`proves`) and a field table must not import a registry
// that imports it back. A fourth is a word in a row above, never a list.
//
// `call` is the one verb that does not name its layer in its row: the same
// capability can be the call a screen made or the data underneath it, and only
// the CASE knows which it is asking about. So the row says provesStep and the
// step carries `proves` -- one declaration still, moved to whoever can make it.
export const CORE_LAYERS = [...new Set(CORE_VERBS.map((v) => v.proves).filter(Boolean))];
