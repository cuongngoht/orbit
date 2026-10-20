// A permission scenario is about what the PRODUCT refuses -- not about who the
// runner signed in as.
//
// `identity.roles` and `identity.notRoles` verify the account driving the test.
// They are a precondition: they say the session is the one the case is about. An
// account that does not hold a role proves nothing on its own about whether the
// application would refuse it, and a run that stops because the identity is
// wrong is REFUSED -- a statement about the setup, never a permission result.
//
// So a scenario whose technique asks for a denial has to say what the refusal
// LOOKS like, and where it is observed. The obligation comes from the technique
// table's `asks` column, so a new technique that needs one says so in its row.
import { commitments } from "../commit.mjs";
import { advice, error } from "../finding.mjs";
import { MUTATION, RUN_STATE_NAMES, TECHNIQUE, techniquesWhere } from "../vocab.mjs";
import { at, filled, scenariosOf } from "./common.mjs";

const ASKS_DENIAL = techniquesWhere("asks", "denial");
const SCOPED = new Set(["scoping"]);
const STATUSES = new RegExp(`\\b(${RUN_STATE_NAMES.join("|")})\\b`);

export const permissionFindings = (p) => scenariosOf(p).flatMap((s) => oneScenario(p, s));

function oneScenario(p, s) {
  const owes = ASKS_DENIAL.has(s.technique);
  if (!owes) return strayNotRoles(p, s);
  return [...requiredBlock(p, s), ...denialFindings(p, s), ...scopeFindings(p, s), ...statusFindings(p, s)];
}

// notRoles with no denial anywhere is the exact confusion this family exists to
// stop: the case would run as somebody who lacks the role and pass by reaching
// the end, having asked the product nothing.
function strayNotRoles(p, s) {
  if (!Array.isArray(s.actor?.notRoles) || !s.actor.notRoles.length || s.denial) return [];
  return [advice(at(p, s), "names notRoles but no denial — notRoles verifies WHO is running; it is not evidence the product refused anything. Set technique to a permission one, or drop it")];
}

const requiredBlock = (p, s) => (s.denial ? [] : [error(at(p, s), `technique ${s.technique} needs a denial block — ${TECHNIQUE.get(s.technique)?.asks ? TECHNIQUE.get(s.technique).doc : ""}`)]);

function denialFindings(p, s) {
  const d = s.denial;
  if (!d) return [];
  return [...uiFindings(p, s, d), ...backendFindings(p, s, d), ...unchangedFindings(p, s, d)];
}

// The one thing every refusal has: something a person could see. Hidden,
// disabled, or an error on the attempt -- and WHICH of those it is matters,
// because a hidden button and a rejected request are different products.
// Whether the screen's side of a refusal is owed. A scenario that states its
// ui layer answers for itself (`n-a` says there is no screen to refuse on); one
// that states nothing about it owes it exactly when its plan is about a screen.
// A plan about NO screen -- a requirement behind an API -- has only the server
// to refuse, and `denial.backend` is where that is said.
const owesScreen = (p, s) => (s.expect?.ui ? s.expect.ui.need !== "n-a" : Boolean(p.screen));

const uiFindings = (p, s, d) => (filled(d.ui) || !owesScreen(p, s) ? [] : [error(at(p, s), "denial says nothing about the screen — is the control hidden, disabled, or does the attempt show an error?")]);

// A hidden button is not a backend test, and nobody should be forced to fake one.
// What is refused is SILENCE: say it is not applicable, or that there is no way
// to drive the attempt past the UI from here, and that becomes a capability gap.
const backendFindings = (p, s, d) => (d.backend ? [] : [advice(at(p, s), "denial says nothing about the server. A hidden control need not produce a rejected request — say `n-a` with the reason, or `unverifiable` if there is no way to attempt it from here")]);

// When the forbidden action would WRITE, "nothing changed" is the half that
// catches a product that hides the button and accepts the request anyway.
function unchangedFindings(p, s, d) {
  const writes = MUTATION.get(s.mutation?.kind)?.writes === true;
  if (!writes || d.unchanged) return [];
  return [error(at(p, s), "the refused action writes, but nothing states what must be UNCHANGED — a product can hide a control and still accept the request")];
}

// Scoping is about whose record it is. Without an owner or a tenant the scenario
// is a role test wearing the wrong name.
function scopeFindings(p, s) {
  if (!SCOPED.has(s.technique)) return [];
  const said = filled(s.actor?.owner) || filled(s.actor?.tenant);
  return said ? [] : [error(at(p, s), "is a scoping scenario but names no owner or tenant for the resource — say whose record the actor must not reach")];
}

// The runner's own vocabulary turning up as the expected RESULT: REFUSED is what
// the engine says when a precondition failed, and a plan that expects it has
// written down the harness's behaviour in place of the product's.
function statusFindings(p, s) {
  const said = [s.denial?.ui, s.denial?.backend?.says, ...commitments(s).map((c) => c.says)].filter(filled);
  const hit = said.find((t) => STATUSES.test(t));
  return hit ? [advice(at(p, s), `expects "${STATUSES.exec(hit)[1]}", which is a RUNNER outcome, not a product behaviour — say what the application does, and let the run decide its own status`)] : [];
}
