// VALIDATE: does this environment actually come up?
//
// Generated is not validated. A definition that parses, that a person reviewed
// and adopted, and whose files read back correctly is still only text: whether an
// image builds, a feature installs and a container starts is learned by doing it,
// and until it is done the environment is ADOPTED and nothing more.
//
// So this is its own step with its own slow, honest outcome. The instance moves to
// VALIDATING, the provider builds the environment, and the instance ends VALIDATED
// or VALIDATION_FAILED with a RECEIPT of what happened -- when, which tool, whether
// it came up, the exit status -- and never the output, which is where a
// credential from a build argument would be.
//
// A failed build is not a failed adoption and not a success: the files are as they
// were written, the instance is ADOPTED with a FAILED validation, and a runtime
// that depends on it is NOT READY -- the one honest thing to say about files that
// were written and an environment that was not built.
import { Blocked, Refused } from "../errors.mjs";
import { inspect, references } from "./environment/devcontainer.mjs";
import { created, moved } from "./instances.mjs";
import { fingerprintOf } from "./proposal.mjs";
import { canonicalJson } from "../hash.mjs";

// The environment's fingerprints as they are on the disk now: each definition, and the files it builds
// from -- a compose file or a Dockerfile edited since the environment came up is as much a change as an
// edited definition.
export function filesOn(ctx) {
  const inspected = inspect(ctx.tree);
  return Object.fromEntries(inspected.definitions.flatMap((d) => [[d.path, fingerprintOf(d.text)], ...references(d.path, d.summary).map((p) => [p, fingerprintOf(ctx.tree.read(p) ?? "")])]));
}

// The Dev Containers CLI keeps the features it resolved, by digest, in a lock file beside a definition,
// and writes one when there is none. That is a file in the person's repository Orbit did not write: it is
// noticed and said -- commit it to pin them, or delete it -- and never deleted here.
const lockOf = (definition) => definition.replace(/devcontainer\.json$/, "devcontainer-lock.json");

const locksOn = (ctx) => inspect(ctx.tree).definitions.map((d) => lockOf(d.path)).filter((p) => ctx.tree.exists(p));

// The instance to validate: the one that exists, or one made for a definition a
// person already had. Either way its files are the ones on the disk NOW.
// The instance a validation moves, and whether its environment must be built afresh: a definition
// adopted, or edited, since the environment was last brought up is not what its container was made
// from, and `devcontainer up` would otherwise start the old container as it was.
function target(ctx) {
  const files = filesOn(ctx);
  if (!Object.keys(files).length) throw new Refused("there is no dev container definition here to validate");
  const have = ctx.instances.list().find((i) => i.provider === "devcontainer");
  return { instance: { ...(have ?? created({ checkout: ctx.checkout, name: "devcontainer", provider: "devcontainer" }, ctx.now())), files }, rebuild: rebuilt(have, files) };
}

const rebuilt = (have, files) => !have || have.state === "ADOPTED" || canonicalJson(have.files ?? {}) !== canonicalJson(files);

// The road INTO validation from wherever an instance is: a proposed one is
// adopted by the person running this, and one that is already VALIDATING (a
// validation that died with the machine) is simply tried again.
const ENTERING = { PROPOSED: ["ADOPTED", "VALIDATING"], ADOPTED: ["VALIDATING"], VALIDATING: ["VALIDATING"], VALIDATED: ["VALIDATING"], VALIDATION_FAILED: ["VALIDATING"] };

const entering = (instance, now) => ENTERING[instance.state].reduce((doc, to) => moved(doc, to, now), instance);

function broughtUp(ctx, provider, world, deps) {
  const before = new Set(locksOn(ctx));
  const result = provider.validate(world, deps);
  return { ...result, wrote: locksOn(ctx).filter((p) => !before.has(p)) };
}

const outcomeOf = (result, ctx) => ({ validation: { state: result.ok ? "VALIDATED" : "VALIDATION_FAILED", at: ctx.now(), because: result.because, receipt: result.receipt, ...(result.wrote?.length ? { wrote: result.wrote } : {}) } });

// A machine that lacks a tool cannot bring the environment up, which says nothing about the
// environment: BLOCKED, and nothing is recorded -- it is not a failed validation, and the instance is
// exactly as it was.
export function blockedWithout(provider, world) {
  const lacks = provider.hostLacks?.(world) ?? [];
  if (lacks.length) throw new Blocked(`the environment cannot be brought up from here: ${lacks.join("; ")}`);
}

// -> the instance, validated or failed. `world` and `deps` are the provider's.
export function validate(ctx, provider, world, deps) {
  blockedWithout(provider, world);
  const { instance, rebuild } = target(ctx);
  const inside = rebuild ? sessionsInside(ctx) : [];
  const running = saved(ctx, entering(instance, ctx.now()));
  return endedWith(inside, finished(ctx, running, broughtUp(ctx, provider, { ...world, envId: running.id, rebuild }, deps)));
}

const finished = (ctx, running, result) => saved(ctx, moved(running, result.ok ? "VALIDATED" : "VALIDATION_FAILED", ctx.now(), outcomeOf(result, ctx)));

// What Orbit ran inside an environment that comes up AFRESH ends with the container it ran in. Said, by
// name, beside the result -- the start that launches it again is a person's.
const sessionsInside = (ctx) => ctx.sessions.list({ env: ctx.envId, owner: ctx.owner ?? { kind: "human" } }).filter((s) => s.provider === "devcontainer" && s.state === "RUNNING");

const endedWith = (inside, doc) => (inside.length && doc.state === "VALIDATED" ? { ...doc, ended: inside.map((s) => ({ component: s.component, session: s.id })) } : doc);

const saved = (ctx, doc) => (ctx.instances.write(doc), doc);
