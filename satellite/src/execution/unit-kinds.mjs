// What a WORK UNIT is, by its kind: the mode its agent run works in, the operation kind its action carries, who
// provides it, the profile it needs at least, and the evidence a unit of that kind is done on by default. The mode and
// the operation are DERIVED from the kind the plan accepted -- a host never sends either.
//
//   provider `host-agent`   the host runs an agent from the dispatch envelope and reports back
//   provider `engineering`  the engine starts one of Orbit's autonomous-engineering tasks (implement) or names the
//                           task a dependency handed off (build, test); an agent run drives it in its own workspace
export const UNIT_KINDS = Object.freeze({
  explore: { mode: "EXPLORING", operation: "repository.read", provider: "host-agent", profile: "READ_ONLY", min: "CONTRACT_MET", task: null, say: "investigate the project to find what matters" },
  diagnose: { mode: "DIAGNOSING", operation: "logs.analyze", provider: "host-agent", profile: "READ_ONLY", min: "CONTRACT_MET", task: null, say: "work out why something fails" },
  design: { mode: "DESIGNING", operation: "artifact.publish", provider: "host-agent", profile: "DESIGN", min: "CONTRACT_MET", task: null, say: "design the change, as an artifact a later unit consumes" },
  review: { mode: "REVIEWING", operation: "repository.read", provider: "host-agent", profile: "READ_ONLY", min: "CONTRACT_MET", task: null, say: "review a change against its design and scope" },
  verify: { mode: "VERIFYING", operation: "evidence.read", provider: "host-agent", profile: "VERIFY", min: "VERIFIED", task: null, say: "read independent evidence back against the acceptance criteria" },
  implement: { mode: "IMPLEMENTING", operation: "source.patch", provider: "engineering", profile: "IMPLEMENT", min: "BEHAVIOR_OBSERVED", task: "new", say: "make the smallest suitable change, in an engineering task's own workspace" },
  build: { mode: "BUILDING", operation: "check.run", provider: "engineering", profile: "IMPLEMENT", min: "BEHAVIOR_OBSERVED", task: "inherited", say: "build what changed, through the engineering task that changed it" },
  test: { mode: "TESTING", operation: "check.run", provider: "engineering", profile: "VERIFY", min: "VERIFIED", task: "inherited", say: "run the tests the change is held to, through the engineering task that changed it" },
});

export const UNIT_KIND_NAMES = Object.freeze(Object.keys(UNIT_KINDS));

export const unitKindOf = (kind) => UNIT_KINDS[kind] ?? null;
