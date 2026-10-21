// What an ISOLATION PROVIDER is, version 1 (ADR 0038): one way to run a task's generated active tests -- and the
// sandbox topology they run against -- somewhere whose isolation can be PROVEN, never assumed from a name.
//
// A runtime provider (src/runtime/providers/contract-v1.mjs) answers "how does a component run"; an isolation
// provider answers the narrower question a generated test needs: "where can a container run that reaches only the
// task's own network, holds nothing of this machine it was not handed, and is limited". It declares what it can
// PROVE (`proves`), and every claim is checked against the facts it reports of what it actually created
// (`facts`, read back through `container.inspect`), at preparation and again at every dispatch
// (src/runtime/sandbox/isolation.mjs PROFILE). A host with no usable provider is a capability gap: discovery and
// validation go on, and an active generated test is BLOCKED.
//
//   doctor(deps)                       is it usable here at all -> { ok, version?, why? }. Changes nothing
//   imageDigest(ref, deps)             a content-addressed reference for an image ALREADY on this machine, or null:
//                                      nothing is pulled, so nothing is fetched behind a person's back
//   imageEnv(ref, deps)                the environment NAMES an image sets itself (never their values)
//   build(spec, deps)                  build an image from a definition a person trusted -> { ok, ref?, why? }
//   network.create(spec, deps)         an INTERNAL network, labelled -> { ok, id?, why? }
//   network.inspect(name, deps)        -> { exists, id, internal, labels, containers } | { exists: false }
//   network.remove(name, deps)         -> { ok, why? }
//   container.create(spec, deps)       -> { ok, id?, why? }   (spec: src/runtime/sandbox/topology.mjs specOf)
//   container.start(id, deps)          -> { ok, why? }
//   container.startAttached(id, deps, o)  start a CREATED container attached: its stdin handed in, its output observed
//                                      chunk by chunk -> runObserved()'s answer. What a dispatch uses, so the worker
//                                      is inspected and attested between being created and being started
//   container.inspect(idOrName, deps)  -> the provider's raw record, or null
//   container.stop(id, deps, opts)     -> { ok, why? }
//   container.remove(id, deps)         -> { ok, why? }
//   container.exec(id, argv, deps, o)  run a FIXED argument list inside -> run()'s answer
//   container.runOnce(spec, deps, o)   create, run attached and remove one container, its stdin handed in and its
//                                      output observed chunk by chunk -> runObserved()'s answer
//   facts(raw)                         the record as the generic facts the PROFILE rows read
//
// Everything goes through `deps.process`, the one door to a child (src/process/): argv, never a shell.
import { constraintFindings, missingFindings } from "../../constraints.mjs";

export const ISOLATION_API = "orbit.isolation-provider/v1";

export const PROVES = ["filesystem", "network", "credential", "limits"];

export const ISOLATION_FIELDS = {
  apiVersion: { type: "string", enum: [ISOLATION_API], doc: "The current isolation provider API." },
  id: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The provider's id, as a person's policy names it." },
  doc: { type: "string", doc: "One line: how this provider isolates." },
  proves: { type: "array", items: { type: "string" }, doc: `What it can prove, of ${PROVES.join(", ")}.` },
};

export const ISOLATION_METHODS = [
  { at: null, names: ["doctor", "imageDigest", "imageEnv", "build", "facts"] },
  { at: "network", names: ["create", "inspect", "remove"] },
  { at: "container", names: ["create", "start", "startAttached", "inspect", "stop", "remove", "exec", "runOnce"] },
];

const methodOf = (provider, at, name) => (at ? provider?.[at]?.[name] : provider?.[name]);

const missingMethods = (provider, label) => ISOLATION_METHODS.flatMap((g) => g.names.filter((n) => typeof methodOf(provider, g.at, n) !== "function").map((n) => `${label}: has no ${g.at ? `${g.at}.` : ""}${n}()`));

// -> [sentence]: why a provider is not one, or nothing.
export function isolationProblems(provider) {
  const label = `isolation provider "${provider?.id ?? "?"}"`;
  if (!provider || typeof provider !== "object") return ["an isolation provider is an object"];
  const shape = [...missingFindings(["apiVersion", "id", "doc", "proves"], provider, label), ...constraintFindings(ISOLATION_FIELDS, provider, label)];
  const proves = (Array.isArray(provider.proves) ? provider.proves : []).filter((p) => !PROVES.includes(p)).map((p) => `${label}: proves "${p}", which is not one of ${PROVES.join(", ")}`);
  return [...shape, ...proves, ...missingMethods(provider, label)];
}
