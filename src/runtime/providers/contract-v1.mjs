// What a PROVIDER is: one way of running a checkout's components.
//
// The runtime subject asks three questions of the world and a provider answers
// them for one way of running things -- directly on the machine (`native`), in a
// dev container (`devcontainer`), and later on a remote or a CI runner or in a
// sandbox for an agent. A new way is a row in the bound list
// (src/runtime/providers/index.mjs), never a branch in the resolver, the
// lifecycle or Control: they ask `compatibility`, `start` and `stop` and never
// test which provider they are holding.
//
//   compatibility(component, world)       can this component run THIS way on THIS
//                                         machine? Pure. { state, because, ... }
//   doctor(world)                         what is true of this way here, as checks
//                                         a person can read. Changes nothing
//   prepare(world, deps, { apply })       what making it ready would take: a PLAN, and
//                                         with `apply` the doing -- which is the slow,
//                                         machine-spending part, so it is never the
//                                         default and never a side effect of asking
//   validate(world, deps)                 does it actually work here? Native has
//                                         nothing to build and says so; a container
//                                         is built and started, which is the one
//                                         thing here that is slow and spends the
//                                         machine's time -- so it is its own step
//   ready(world, deps, target?)           is the place a component would run IN already
//                                         there? Native is the machine, and always is;
//                                         a container must be up. Asked before a start,
//                                         so nothing is launched into nothing
//   start(component, command, world, deps)  launch one component's declared command.
//                                         Returns what the lifecycle records
//   composite · reuses · candidates · ports   (optional, a provider that DELEGATES -- src/runtime/providers/
//                                         sandbox.mjs places a component on another provider)
//                                         `composite: true` means it is asked only in a sandbox's world,
//                                         and through `candidates(component, world, providers)` -- one
//                                         answer per way it could place the component, each with `via`
//                                         naming it. `reuses: false` means a holder of the component's
//                                         port is never taken for it. `ports(component, command, world,
//                                         target)` answers the ports a start will open, when the
//                                         provider chose them
//   hostLacks(world)  (optional)          what THIS machine lacks to prepare or validate at all --
//                                         a tool that was asked about and is not there -- as
//                                         sentences. Asked before anything is recorded about an
//                                         environment: a machine that cannot is BLOCKED, and the
//                                         environment is neither failed nor changed by it
//   status(session, deps)                 is it still there, and since when
//   stop(session, deps)                   end it -- awaited, because a process takes
//                                         time to answer a signal. Only ever called
//                                         for a session the lifecycle has proven is Orbit's
//   reach(target, world, deps)  (optional)  can a server a PERSON configured be reached
//                                         from WHERE this provider runs things -- its own
//                                         network, never another's answer copied over?
//                                         -> { resolution, transport, because, blocked? }
//                                         (src/runtime/connectivity/states.mjs). `blocked`
//                                         means it cannot be asked from there right now. A
//                                         provider without it is asked nothing, and says so
//
// Everything a provider does to the machine goes through `deps.process`, the one
// door to a child (src/process/), so argv is never a shell and nothing here can
// start anything the Process port would not -- and the network only through
// `deps.reach` (src/probe/reach.mjs), with a target read from settings.
import { constraintFindings, missingFindings } from "../../constraints.mjs";

export const PROVIDER_API = "orbit.runtime-provider/v1";

export const PROVIDER_FIELDS = {
  apiVersion: { type: "string", enum: [PROVIDER_API], doc: "The current runtime provider API." },
  id: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The provider's id: what a session records as `provider`, and what a setting names." },
  doc: { type: "string", doc: "One line: how this provider runs things." },
};

export const PROVIDER_METHODS = ["compatibility", "doctor", "prepare", "validate", "ready", "start", "status", "stop"];

// -> [sentence]: why a provider is not one, or nothing.
export function providerProblems(provider) {
  const at = `runtime provider "${provider?.id ?? "?"}"`;
  if (!provider || typeof provider !== "object") return ["a provider is an object"];
  const shape = [...missingFindings(["id", "doc", "apiVersion"], provider, at), ...constraintFindings(PROVIDER_FIELDS, provider, at)];
  return [...shape, ...PROVIDER_METHODS.filter((m) => typeof provider[m] !== "function").map((m) => `${at}: has no ${m}()`)];
}
