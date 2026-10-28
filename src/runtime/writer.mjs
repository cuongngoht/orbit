// The ENVIRONMENT WRITER: the one thing in this engine that writes an environment
// file into a checkout's working tree -- and only for a proposal a person adopted,
// that is still true, and in exactly the form it was approved in.
//
// The order of its checks is the order of the damage each prevents:
//
//   a person            adopting writes the developer's own checkout: the PRIMARY_CHECKOUT_WRITE protected
//                       boundary (src/protected/), crossed only by a person's own act through Orbit Control's door
//                       -- refused before anything is read otherwise. No terminal crosses it, `--human` or not
//   something to write  only CREATE and PATCH write; NO_CHANGE, UNRESOLVED and
//                       UNSAFE have nothing to adopt, and say why
//   still true          the understanding it was designed from, and every file it
//                       would touch, are compared to NOW. A file somebody edited
//                       while the proposal was being read is STALE_PROPOSAL, and is
//                       never overwritten
//   faithful            the text it is about to write is VERIFIED against what the
//                       edits describe -- parses, same comments, the intended value
//                       -- before a byte goes to disk
//
// And after it writes, it does not believe itself: the files are READ BACK from
// the disk, parsed again and verified again, and only then is the environment
// ADOPTED. A read-back that disagrees leaves the files exactly as written (a
// second write would compound whatever went wrong) and reports ADOPT_UNVERIFIED --
// the instance is not adopted, and nothing is called a success.
//
// No other module under src/runtime/ writes through the working-tree port. A test
// holds that line, because it is the property that makes "design never writes the
// repository" true.
import { Refused } from "../errors.mjs";
import { BOUNDARY_DOOR, authorize, crossing } from "../protected/authorize.mjs";
import { ACTION, HOMES } from "../protected/boundaries.mjs";
import { edit, parse, verify } from "./jsonc.mjs";
import { adoptable, fingerprintOf, freshness, stale } from "./proposal.mjs";
import { created, moved } from "./instances.mjs";

export const ADOPT_UNVERIFIED = "ADOPT_UNVERIFIED";

export const PROTECTED_DENIED = "PROTECTED_DENIED";

// `actor`: { door } -- who is acting, as the composition root established it.
// `now` is what is true at this moment: { understanding, environment: { path: fingerprint } }.
export function adopt(ctx, proposal, { actor, now }) {
  refusedUnless(proposal);
  crossed(ctx, proposal, actor);
  const fresh = freshness(proposal, now);
  if (!fresh.fresh) throw stale(fresh.why);
  return written(ctx, proposal, planned(ctx, proposal));
}

function refusedUnless(proposal) {
  if (!adoptable(proposal)) throw new Refused(`there is nothing to adopt: this proposal is ${proposal.state}, ${proposal.because}`);
  if (proposal.status === "adopted") throw new Refused("this proposal has already been adopted");
}

// What adopting IS, as the protected-boundary leaf reads it: a write of these files into the developer's own checkout.
const scopeOf = (proposal) => [...proposal.files.create, ...proposal.files.patch].map((f) => f.path).join(", ") || "environment files";

export const checkoutWriteOf = (ctx, proposal) => ({ kind: ACTION.WRITE, home: HOMES.PRIMARY_CHECKOUT, repository: ctx.name ?? null, checkout: ctx.checkout ?? null, scope: scopeOf(proposal), digest: proposal.id });

const WORDS = (id) => ({ lead: "Nothing was written.", where: `Orbit Control (Runtime → proposal ${id} → Adopt)` });

const denied = (says) => Object.assign(new Refused(`${PROTECTED_DENIED}: ${says}`), { code: PROTECTED_DENIED });

function crossed(ctx, proposal, actor) {
  const act = crossing(authorize(checkoutWriteOf(ctx, proposal)), actor, WORDS(proposal.id));
  if (!act.allowed) throw denied(act.says);
}

// Who is acting is known before anything is read: anything but Orbit Control's door is refused with nothing of the
// checkout read.
export const mayBeAPerson = (actor) => actor?.door === BOUNDARY_DOOR;

export function refusedEarly(actor, id) {
  if (mayBeAPerson(actor)) return;
  throw denied(crossing(authorize({ kind: ACTION.WRITE, home: HOMES.PRIMARY_CHECKOUT, scope: "environment files" }), actor, WORDS(id ?? "<proposal>")).says);
}

// Every file's final text, worked out and VERIFIED before any is written, so a
// proposal that would produce an unfaithful file writes none of them.
function planned(ctx, proposal) {
  return [...proposal.files.create.map((f) => creating(ctx, f)), ...proposal.files.patch.map((f) => patched(ctx, f))];
}

// A CREATE is for a path with nothing at it. Something that is there and reads as nothing -- a
// link, a file too large to be text, text in an encoding this does not read -- would otherwise look
// exactly like an absence, and be overwritten.
function creating(ctx, file) {
  if (ctx.tree.exists(file.path)) throw new Refused(`${file.path} is already there, so it is not created over: move it aside and design again; nothing was written`);
  return { path: file.path, before: null, after: file.text, edits: null };
}

function patched(ctx, file) {
  const before = ctx.tree.read(file.path);
  const done = edit(before ?? "", file.edits);
  if (!done.ok) throw new Refused(`${file.path} cannot be edited as proposed (${done.reason}); nothing was written`);
  faithful(file, before, done.text);
  return { path: file.path, before, after: done.text, edits: file.edits };
}

function faithful(file, before, after) {
  const checked = verify(before, after, file.edits);
  if (!checked.ok) throw new Refused(`${file.path}: the edited text is not faithful to the edits (${checked.why}); nothing was written`);
}

function written(ctx, proposal, plan) {
  for (const f of plan) ctx.tree.write(f.path, f.after);
  const readBack = plan.map((f) => ({ ...f, found: ctx.tree.read(f.path) }));
  const bad = readBack.map(unfaithful).filter(Boolean);
  if (bad.length) throw Object.assign(new Refused(`${ADOPT_UNVERIFIED}: ${bad.join("; ")} — the files were left as written, and the environment is not adopted`), { code: ADOPT_UNVERIFIED });
  return adopted(ctx, proposal, readBack);
}

// What the disk says must be what was written, parse, and -- for an edit -- verify.
function unfaithful(f) {
  if (f.found !== f.after) return `${f.path} reads back differently from what was written`;
  if (!parse(f.found).ok) return `${f.path} does not parse once written`;
  return f.edits && !verify(f.before, f.found, f.edits).ok ? `${f.path} does not hold what the edits describe` : null;
}

// The environment is ADOPTED: its instance records the files as they are now, and
// the proposal is spent. Adopted is not validated -- that is a build, and its own step.
function adopted(ctx, proposal, readBack) {
  const files = Object.fromEntries(readBack.map((f) => [f.path, fingerprintOf(f.found)]));
  const instance = moved(created({ checkout: ctx.checkout, name: "devcontainer", provider: "devcontainer", files, proposal: proposal.id }, ctx.now()), "ADOPTED", ctx.now());
  ctx.instances.write(instance);
  ctx.proposals.write({ ...proposal, status: "adopted", adoptedAt: ctx.now(), adoptedFiles: files });
  return { adopted: true, instance, files: readBack.map((f) => ({ path: f.path, created: f.before === null })) };
}
