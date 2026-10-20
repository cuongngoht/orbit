// `identity` says what KIND of user the case needs, never which local profile.
// A case may name ONE identity (`identity`) or SEVERAL (`identities`) and
// switch between them with {"do":"as"} -- the shape of a real permission test.
import { constraintFindings } from "../../constraints.mjs";
import { IDENTITY_FIELDS } from "../fields.mjs";
import { CORE } from "../registry.mjs";
import { isObject, unknownFields } from "./common.mjs";

// `profile` is accepted here only so the rule below can say WHY it is wrong,
// instead of the useless "unknown field".
const KEYS = new Set([...Object.keys(IDENTITY_FIELDS), "profile"]);

// Both at once was ACCEPTED: the `not both` branch below could only be reached
// when `identity` was undefined, so it never fired -- and the whole `identities`
// family was skipped as well, leaving an {"do":"as"} step naming a key that does
// not exist entirely unchecked.
export function identityFindings(c, dsl = CORE) {
  if (c.identity !== undefined && c.identities !== undefined) return [`${c.id}: use identity OR identities, not both — one is a case that runs as one user, the other a case that switches between several`];
  return c.identities === undefined ? [...singleFindings(c), ...strayAs(c)] : identitiesFindings(c, dsl);
}

function singleFindings(c) {
  if (c.identity === undefined) return [];
  if (!isObject(c.identity)) return [`${c.id}: identity must be an object, e.g. {"as":"admin","roles":["App.Admin"]}`];
  return oneIdentity(c.identity, `${c.id} identity`);
}

// `as` switches between the identities a case DECLARES. With no `identities`
// block there is nothing to switch to, and the step used to no-op in silence:
// an empty want satisfies every check, so it verified nothing and still wrote an
// identity record saying the switch had happened.
const strayAs = (c) => (c.steps ?? []).flatMap((st, i) => (st.do === "as" ? [`${c.id} step ${i + 1} (as): the case declares no "identities" to switch between`] : []));

function identitiesFindings(c, dsl) {
  if (!isObject(c.identities)) return [`${c.id}: identities must be an object keyed by name, e.g. {"admin":{...},"scoped":{...}}`];
  return [...eachIdentity(c), ...distinctFindings(c), ...firstAsFindings(c, dsl), ...asTargets(c)];
}

// Two identities a case switches between must be distinguishable by what the
// case DECLARES about them. If they are not, a switch that silently did not
// happen reads exactly like one that did -- the claims check passes either way,
// and the case reports a permission result nobody observed.
function distinctFindings(c) {
  const byShape = new Map();
  for (const [n, v] of Object.entries(c.identities)) byShape.set(shapeOf(v), [...(byShape.get(shapeOf(v)) ?? []), n]);
  return [...byShape.values()].filter((names) => names.length > 1).map((names) => same(c, names));
}

const same = (c, names) => `${c.id}: identities ${names.join(" and ")} state the same thing — nothing could tell them apart, so switching between them proves nothing`;

const shapeOf = (v) => JSON.stringify([[...(v?.roles ?? [])].sort(), [...(v?.notRoles ?? [])].sort(), v?.upn ?? null]);

function eachIdentity(c) {
  const names = Object.keys(c.identities);
  return names.flatMap((n) => oneIdentity({ as: n, ...c.identities[n] }, `${c.id} identities.${n}`));
}

function oneIdentity(id, where) {
  const out = unknownFields(id, KEYS, where);
  if (!id.as) out.push(`${where}: needs an "as" (a logical identity such as "admin"), not a profile name`);
  if (id.profile) out.push(`${where}: must not name a profile (${id.profile}) — profile names are per-machine; map "as" in identities.json instead`);
  return [...out, ...constraintFindings(IDENTITY_FIELDS, id, where), ...verifiable(id, where)];
}

const verifiable = (id, where) => (!id.roles?.length && !id.notRoles?.length && !id.upn ? [`${where}: states nothing verifiable — add roles / notRoles / upn`] : []);

// The first `as` must come before anything that acts, or the opening steps run
// as whichever session happened to be current.
function firstAsFindings(c, dsl) {
  const steps = c.steps ?? [];
  const firstAct = steps.findIndex((st) => dsl.verbsWhere("kind", "act").has(st.do));
  const firstAs = steps.findIndex((st) => st.do === "as");
  const late = firstAct >= 0 && (firstAs < 0 || firstAs > firstAct);
  return late ? [`${c.id}: declares several identities but does not pick one with {"do":"as"} before step ${firstAct + 1}`] : [];
}

function asTargets(c) {
  const names = Object.keys(c.identities);
  return (c.steps ?? []).flatMap((st, i) => (st.do === "as" && !names.includes(st.identity) ? [`${c.id} step ${i + 1} (as): "${st.identity}" is not one of ${names.join(", ")}`] : []));
}
