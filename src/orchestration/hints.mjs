// What to SUGGEST next about the sandbox, as ordered rows -- a hint, never an instruction the engine
// follows. The first row that holds decides, and none holds while the loop has a stop of its own or
// the action it suggests is not one the stage allows now: a hint that names a step a host would be
// refused is worse than none.
//
// A library -- a checkout that declares nothing a sandbox could start -- gets no sandbox hint at all.
import { blockedBy, sandboxReceipt, startableNow } from "./journal.mjs";
import { planOf, testsDone } from "./obligations.mjs";
import { sandboxOf } from "./sandbox.mjs";
import { allowedNow } from "./stages.mjs";
import { SANDBOX_STATE, STAGE, STOP } from "./vocab.mjs";

// Where a diagnosis comes first: nothing is suggested until it is made.
const QUIET = [STAGE.DIAGNOSING];

const may = (lw, kind) => allowedNow(lw).includes(kind);

const personBlocked = (lw) => blockedBy(lw) === STOP.ENVIRONMENT_BLOCKED && lw.view.blocked?.needs === "person" && sandboxReceipt(lw)?.outcome === SANDBOX_STATE.BLOCKED;

const waiting = (sbx) => sbx?.running.length === 0;

// `h`: { lw, sandbox } -- the loop's world, and what the journal says of the sandbox (or null).
const hasPlan = (lw) => lw.view.actions.some((a) => a.type === "plan" && a.state === "succeeded");

const unbaselined = (lw) => planOf(lw).required.filter((c) => c.baseline === "none").map((c) => c.id);

export const HINTS = [
  { id: "PLAN_FIRST", when: (h) => h.lw.view.stage === STAGE.PLANNING && !hasPlan(h.lw) && may(h.lw, "plan"), say: () => "plan: its scope says which components the change reaches, and so which checks it is held to -- baseline those before implement" },
  { id: "BASELINE", when: (h) => h.lw.view.stage === STAGE.PLANNING && hasPlan(h.lw) && unbaselined(h.lw).length > 0 && may(h.lw, "check"), say: (h) => `baseline what the change is held to before implement, so a failure it already had is told from one it brings: check ${unbaselined(h.lw).slice(0, 4).join(", ")}${unbaselined(h.lw).length > 4 ? ", …" : ""}` },
  { id: "SANDBOX_PERSON", when: (h) => personBlocked(h.lw) && may(h.lw, "prepare-sandbox"), say: () => "the sandbox waits for a person: trust it in Orbit Control (Mission Control), then prepare-sandbox again" },
  { id: "SANDBOX_STALE", when: (h) => h.sandbox?.stale === true && may(h.lw, "start-sandbox"), say: (h) => `the workspace moved since ${h.sandbox.environment} was prepared: start-sandbox replaces what runs there with the changed code` },
  { id: "VERIFY_LIVE", when: (h) => h.sandbox?.running.some((r) => r.current) === true && may(h.lw, "link-investigation"), say: (h) => `the application runs from the changed code in ${h.sandbox.environment}: verify it live (orbit-qa-agent plan --sandbox=${h.sandbox.environment} …), then link-investigation` },
  { id: "SANDBOX_READY", when: (h) => h.sandbox?.state === SANDBOX_STATE.READY && waiting(h.sandbox) && may(h.lw, "start-sandbox"), say: (h) => `${h.sandbox.environment} is prepared and nothing runs in it: start-sandbox brings the application up from the changed code` },
  { id: "PREPARE_SANDBOX", when: (h) => h.sandbox === null && testsDone(h.lw) && startableNow(h.lw).length > 0 && (may(h.lw, "prepare-sandbox") || may(h.lw, "start-sandbox")), say: (h) => `the tests pass and this checkout declares an application to run (${startableNow(h.lw).slice(0, 3).join(", ")}): ${may(h.lw, "prepare-sandbox") ? "prepare-sandbox, then start-sandbox" : "start-sandbox"} runs the changed code, so it can be verified live` },
];

// -> a sentence, or null when nothing is worth saying.
export function hintOf(lw) {
  const h = { lw, sandbox: sandboxOf(lw) };
  const row = QUIET.includes(lw.view.stage) ? null : HINTS.find((r) => r.when(h));
  return row ? row.say(h) : null;
}
