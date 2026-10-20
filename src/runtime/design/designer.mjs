// The ENVIRONMENT DESIGNER: what would have to change so an environment provides
// what a checkout needs -- worked out, never done.
//
// Read-only by construction. It takes the normalised requirements
// (src/runtime/requirements.mjs) and the definitions that are on the disk NOW
// (src/runtime/environment/devcontainer.mjs `inspect`), and answers a body a
// proposal is built from. It writes nothing, in the repository or the store: the
// only thing that ever writes an environment file is the writer
// (src/runtime/writer.mjs), after a person adopted what this said.
//
// Five answers, and the order of the checks is the order of the danger:
//
//   UNSAFE       something is here that must not be touched: a definition that does
//                not parse, a Windows image, an edit nothing can make without losing
//                something. Nothing is proposed, and the sentence says what to fix
//   NO_CHANGE    the environment already provides everything it can
//   CREATE       there is no definition: one file, built from the requirements
//   PATCH        there is one, and these edits -- by splicing, nothing else touched --
//                bring it up to date
//   UNRESOLVED   there is something to do and no way to do it here: a requirement no
//                feature provides, a server a container cannot add. Said, per item
//
// A PATCH carries UNRESOLVED items too: what could be done is proposed, and what
// could not is listed beside it, because the first being possible does not make the
// second any less true.
import { HOST_HOOK, references, windowsImage } from "../environment/devcontainer.mjs";
import { create } from "./create.mjs";
import { analyse, portGaps } from "./gap.mjs";
import { patch } from "./patch.mjs";

export const STATES = ["NO_CHANGE", "CREATE", "PATCH", "UNRESOLVED", "UNSAFE"];

const body = (state, because, over = {}) => ({ state, because, definition: null, files: { create: [], patch: [] }, gaps: [], unresolved: [], risks: [], notes: [], ...over });

// `input`: { requirements, inspected, catalog, name }
export function design(input) {
  const { inspected } = input;
  if (inspected.problems.length) return body("UNSAFE", `${inspected.problems.map((p) => `${p.path} ${p.why}`).join("; ")} — nothing is proposed under a definition that cannot be read`);
  const primary = inspected.definitions[0] ?? null;
  return primary ? existing(input, primary) : creation(input);
}

function existing(input, primary) {
  const windows = primary.images.find(windowsImage);
  return windows ? body("UNSAFE", `${primary.path} builds from a Windows image (${windows}), and a Linux container's features do not apply to it`, { definition: primary.path }) : patching(input, primary);
}

// A server is not a feature. A definition that brings up the compose file a server is defined in
// PROVIDES it -- that is how a database comes up beside the application -- and one that brings up
// other compose files, or none, does not. A container definition cannot add a server without a
// compose file, and converting a definition to compose changes how it is built: not something to do
// on a person's behalf.
const serversOf = (input, primary) => input.requirements.services.filter((s) => !broughtUp(s, primary)).map((s) => ({ id: s.service, why: notUp(s, primary) }));

const broughtUp = (s, primary) => Boolean(primary) && references(primary.path, primary.summary).includes(s.file);

const notUp = (s, primary) => (primary?.summary.composeFiles.length ? `${serverName(s)} is defined in ${s.file}, which this definition does not bring up` : `${serverName(s)} is a server, and a dev container definition cannot add one without a compose file; none is proposed`);

const serverName = (s) => (s.name && s.name !== s.service ? `${s.name} (${s.service})` : s.service);

const upWith = (input, primary) => input.requirements.services.filter((s) => broughtUp(s, primary)).map((s) => `${serverName(s)} comes up with the environment: ${s.file} is one of the compose files it brings up`);

function creation(input) {
  const made = create(input);
  if (made.problem) return body("UNRESOLVED", made.problem, { unresolved: serversOf(input, null) });
  const gaps = analyse(input.requirements, null);
  return body("CREATE", `no dev container is defined, and ${input.requirements.environment.filter((r) => r.feature && r.container !== false).length} requirement(s) can be provided by a feature`, { files: { create: [made], patch: [] }, gaps, unresolved: [...gaps.filter((g) => ["impossible", "unplaced"].includes(g.state)).map((g) => ({ id: g.id, why: g.because })), ...serversOf(input, null)] });
}

function patching(input, primary) {
  const gaps = analyse(input.requirements, primary, input.catalog?.environment?.baseImage ?? null);
  const done = patch({ gaps, ports: portGaps(input.requirements, primary), definition: primary });
  const shared = { definition: primary.path, gaps, risks: risksOf(primary), notes: notesOf(input, gaps, primary) };
  return outcome(done, { ...shared, unresolved: [...done.unresolved, ...serversOf(input, primary)] }, primary);
}

// What the edits came to: some made, none made because the editor refused, or
// none needed.
function outcome(done, shared, primary) {
  const unresolved = [...done.refused, ...shared.unresolved];
  if (done.edits.length) return body("PATCH", `${done.edits.length} edit(s) to ${primary.path}; everything else in it is left exactly as it is`, { ...shared, files: { create: [], patch: [{ path: primary.path, edits: done.edits }] }, unresolved });
  if (done.refused.length) return body("UNSAFE", `the edits needed cannot be made without losing something: ${done.refused.map((r) => `${r.id} (${r.why})`).join("; ")}`, { ...shared, unresolved });
  return body(unresolved.length ? "UNRESOLVED" : "NO_CHANGE", unresolved.length ? "nothing can be changed, and some of what is needed has no way to be provided here" : `${primary.path} already provides everything it can`, shared);
}

const inspectedOthers = (input) => input.inspected.definitions.slice(1).map((d) => d.path);

function notesOf(input, gaps, primary) {
  const unknown = gaps.filter((g) => g.state === "unknown").map((g) => `${g.because}; it is left exactly as it is`);
  const others = inspectedOthers(input);
  return [...unknown, ...input.requirements.unknowns, ...upWith(input, primary), ...composedPorts(input, primary), ...(others.length ? [`more than one definition exists; only the first is proposed against (${others.join(", ")} are not)`] : [])];
}

// A definition built from compose files publishes ports through them, and they are never edited: which
// of the ports a component listens on reach this machine is theirs to say.
const composedPorts = (input, primary) => (primary.summary.composeFiles.length && input.requirements.ports.length ? [`the compose files ${primary.path} uses decide which ports reach this machine (${input.requirements.ports.join(", ")}); they are never edited`] : []);

// What is in the definition a person should know runs, or reaches, without Orbit's say. The host
// hook is said apart from the rest: it does not run in the container.
function risksOf(primary) {
  const { hooks, elevated = [] } = primary.summary;
  const inside = hooks.filter((h) => h !== HOST_HOOK);
  return [
    ...(hooks.includes(HOST_HOOK) ? [`it has an ${HOST_HOOK}, which runs ON THIS MACHINE (the host, not the container) whenever the environment is brought up, \`runtime validate\` included. Orbit never runs, reads or edits it: read it before validating`] : []),
    ...(inside.length ? [`it has lifecycle hooks (${inside.join(", ")}): they run inside the container whenever it is created. Orbit never runs, reads or edits them`] : []),
    ...(elevated.length ? [`it widens what the container may touch (${elevated.join(", ")}): read those before validating`] : []),
  ];
}
