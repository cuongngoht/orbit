// What each operation is, what it touches, and who must ask for it.
//
// Not a policy engine (src/policy.mjs is that) -- a table that SAYS what every
// runtime command does, so a person, a host's permission prompt, a test and the
// documentation all read one answer. The classes the release owns, and the ones it
// names and does not implement:
//
//   DISCOVERY                      reads a checkout's evidence, writes facts to the store
//   ENVIRONMENT_DESIGN             works out a proposal from facts. Writes the PROPOSAL, to the store
//   REPOSITORY_ENVIRONMENT_WRITE   writes environment files into the working tree: the PRIMARY_CHECKOUT_WRITE
//                                  protected boundary (src/protected/), crossed only by a person's own act
//   MACHINE_PROBE                  asks the machine's tools their versions
//   PREPARE_ENVIRONMENT            builds or brings up an environment: slow, spends the machine, autonomous
//   START_RUNTIME                  launches what a file declared, and records a receipt
//   STOP_OWNED_RUNTIME             ends a process Orbit proved is its own. Never anything else
//   CONFIGURE_RUNTIME              a person's settings for this machine
//   CONNECTIVITY_PROBE             asks the NETWORK: a name lookup and one TCP connection to a host
//                                  a person configured as a target, from this machine or from inside
//                                  the environment's container. Outbound traffic, so its own class --
//                                  never hidden under READ. Keeps only what it observed
//   READ                           looks at what is already kept
//
//   RUN_TEST · API_WRITE · SEED_DATA · DESTRUCTIVE_RESET
//                                  belong to QA, to a verification, to a person. NO runtime
//                                  command is any of them, and a test says so. Nothing here
//                                  drops a database, truncates a table, removes a volume,
//                                  deletes developer data or ends a process it did not start.
//
// `mutates` says where: nothing, the machine store, the repository's working tree, or the
// machine itself (a process, a container, an image). `approval` (0.2.0, autonomous by default): `none` for
// everything a task may do on its own -- a task's sandbox included; `human` where the command keeps a person's
// own setting or word (relayed with --human); `control` where only Orbit Control may write it; `protected` where it
// crosses a protected boundary and only a person's own act, through Orbit Control's door, may do it -- a terminal
// cannot prove a person.
export const OPERATIONS = [
  { class: "READ", commands: ["status", "proposal", "projects", "settings", "connectivity", "sandboxes", "sandbox", "sandbox-logs", "sandbox-topology", "sandbox-dispatched"], mutates: "none", approval: "none", says: "looks at what is already kept and the machine as it is" },
  { class: "DISCOVERY", commands: ["discover", "record"], mutates: "store", approval: "none", says: "reads a checkout's evidence files and keeps what they say; never runs anything and never touches the repository" },
  { class: "ENVIRONMENT_DESIGN", commands: ["design"], mutates: "store", approval: "none", says: "works out what an environment would need to change, and keeps it as a proposal; writes no file in the repository" },
  { class: "REPOSITORY_ENVIRONMENT_WRITE", commands: ["adopt"], mutates: "repository", approval: "protected", says: "writes the environment files of an unchanged proposal into the developer's own checkout, and reads them back -- the PRIMARY_CHECKOUT_WRITE protected boundary: only a person's own act, in Orbit Control" },
  { class: "MACHINE_PROBE", commands: ["doctor"], mutates: "store", approval: "none", says: "asks the tools a checkout needs for their versions, and keeps the answers" },
  { class: "PREPARE_ENVIRONMENT", commands: ["validate", "prepare"], mutates: "machine", approval: "none", says: "builds and brings up an environment, which can pull images, take minutes and run commands its own definition names on this machine -- autonomous, like any local environment. `prepare` only PLANS until it is told --apply" },
  { class: "SANDBOX_PREPARE", commands: ["sandbox-prepare"], mutates: "machine", approval: "none", says: "brings a task's sandbox up from its workspace, autonomously: understands it, restores its dependencies and builds its containers there, each fingerprinted as evidence of exactly what ran; the checkout itself is never restored" },
  { class: "START_RUNTIME", commands: ["start", "sandbox-start"], mutates: "machine", approval: "none", says: "launches the commands a file declared, one session receipt each; never installs and never edits the repository" },
  { class: "STOP_OWNED_RUNTIME", commands: ["stop", "sandbox-stop"], mutates: "machine", approval: "none", says: "ends a process Orbit proved is its own; refuses anything else" },
  { class: "TEST_WORKER_DISPATCH", commands: ["sandbox-dispatch"], mutates: "machine", approval: "none", says: "runs ONE generated test in an isolated sandbox's worker: a container of the pinned, trusted worker image on the task's internal network, held to the isolation profile before it starts, its request on stdin and its deadline enforced by its receipt; it decides no verdict -- the host validates what the worker wrote" },
  { class: "SIGNAL_SANDBOX", commands: ["sandbox-signal"], mutates: "store", approval: "none", says: "writes a pause, resume or cancel for an isolated sandbox's supervisor to read; interrupts nothing by itself" },
  { class: "RELEASE_SANDBOX", commands: ["sandbox-release"], mutates: "machine", approval: "none", says: "ends the sessions a task's sandbox owns, lets go of its port leases and stops the containers that carry its labels; never a person's, another task's, or anything external or unproven" },
  { class: "REVIEW_MARK", commands: ["trust"], mutates: "store", approval: "control", says: "a person's review mark on a fingerprint of exactly what a sandbox would run, kept in the settings and named by the receipts of what ran -- evidence, never a gate: nothing waits on it; only Orbit Control, after its mutation token, can set one" },
  { class: "FORGET_CHECKOUT", commands: ["forget"], mutates: "store", approval: "none", says: "takes a checkout whose directory is gone off this machine's list of projects; what Orbit kept about it stays in the store" },
  { class: "CONFIGURE_RUNTIME", commands: ["configure"], mutates: "store", approval: "human", says: "keeps a person's settings for this machine" },
  { class: "CONNECTIVITY_PROBE", commands: ["check", "retry"], mutates: "store", approval: "none", says: "makes outbound network traffic: a name lookup and one TCP connection per attempt to a host and port a PERSON configured as a target -- never one a request named -- from this machine or from inside the environment's container, bounded by the saved retry policy; sends nothing, reads nothing a server answers, installs and changes nothing, and keeps only what it observed" },
];

// What no runtime command is, named so a test can hold the line.
export const NOT_RUNTIME = ["RUN_TEST", "API_WRITE", "SEED_DATA", "DESTRUCTIVE_RESET"];

export const classOf = (command) => OPERATIONS.find((o) => o.commands.includes(command)) ?? null;

export const needsHuman = (command) => classOf(command)?.approval === "human";

// What only Orbit Control can write, and what only a person's own act may do because it crosses a protected boundary.
export const needsControl = (command) => classOf(command)?.approval === "control";

export const isProtected = (command) => classOf(command)?.approval === "protected";
