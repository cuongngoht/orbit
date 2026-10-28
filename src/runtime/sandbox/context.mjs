// A SANDBOX CONTEXT: the primary checkout's runtime context, seen from inside one task's workspace.
//
// It is DERIVED from a person's context rather than bound afresh, because the one thing it must not do is
// become a second project. A workspace is a clone of the checkout; asking the repository layer what
// `<workspace>` is would key a second project store under it, and the sandbox would be a stranger to the
// registry that port ownership is read from (src/runtime/ports.mjs reads only registered checkouts). So the
// project, the store, the checkout, the registry, the machine, the catalog, the providers and a person's
// settings are INHERITED, and exactly these are replaced:
//
//   root           the workspace: where a native component starts and a container's folder is
//   source / tree  what the workspace HOLDS (the index), not HEAD -- the task's edits are not committed
//   understanding  its own room: a task may change a manifest or a launch profile
//   instances      the sandbox's backing environment, read-only
//   proposals      none: a sandbox adopts nothing into anybody's repository
//   observations   the connectivity this sandbox's locations were asked
//   scratch        its own room for a file one container call reads and nobody else may (src/runtime/sandbox/scratch.mjs)
//   envId / envs   the sandbox: for every provider, the environment is this one
//   owner          the task
//   writeSettings  refused: settings are a person's
//
// `rooms.live` is NOT replaced. A sandbox's sessions sit in the checkout's live room with their owner
// stamped, because the host-wide question "whose is this port" reads that room; what a context sees of it
// is ENV_SCOPE's to say (src/runtime/sessions.mjs).
import { join } from "node:path";
import { Refused } from "../../errors.mjs";
import { createObservations } from "../connectivity/observations.mjs";
import { createdSandbox, createInstances, sandboxId } from "../instances.mjs";
import { sandboxLiveRoom, sandboxUnderstandingRoom, sandboxesRoom } from "../rooms.mjs";
import { ISOLATION_PROVIDERS } from "../isolation/index.mjs";
import { isolated } from "../providers/isolated.mjs";
import { sandbox } from "../providers/sandbox.mjs";
import { createRuntimeStore } from "../store.mjs";
import { filesOn } from "../validate.mjs";
import { sandboxNow } from "./model.mjs";
import { createScratch } from "./scratch.mjs";

const NO_WORKSPACES = "this machine has no workspace owner bound to the runtime, so there is nowhere to run a task's change";

// The backing environment a sandbox places a container component in, as the one instance the dev container
// provider asks of `ctx.instances` -- so its compatibility, its doctor and its "has the definition changed"
// all work on the sandbox's own definition files.
const backed = (doc) => (doc.backing?.devcontainer ? [{ id: doc.id, kind: "sandbox", name: "devcontainer", provider: "devcontainer", checkout: doc.checkout, state: doc.backing.devcontainer.state, files: doc.backing.devcontainer.files ?? {}, validation: doc.backing.devcontainer.validation ?? null }] : []);

const readOnlyInstances = (doc) => ({ list: () => backed(doc()), read: (id) => backed(doc()).find((i) => i.id === id) ?? null, write: () => { throw new Refused("a sandbox's backing environment is written by its own preparation, under its own receipt"); } });

const noProposals = { list: () => [], read: () => null, write: () => { throw new Refused("a sandbox adopts nothing: a proposal for the repository is a person's"); } };

const settingsRefused = () => { throw new Refused("a sandbox inherits a person's settings and never writes them"); };

function roomsOf(primary, id) {
  const { storeRoot, checkout } = primary;
  return { ...primary.rooms, understanding: sandboxUnderstandingRoom(storeRoot, checkout, id), sandboxes: sandboxesRoom(storeRoot, checkout), liveSandbox: sandboxLiveRoom(primary.rooms.live, id) };
}

const scopedTo = (id, task, providers, primary) => ({ envId: id, envs: { native: id, devcontainer: id, isolated: id, sandbox: id }, owner: { kind: "task", id: task }, writeSettings: settingsRefused, providers: [...providers.filter((p) => !p.composite && p.id !== "isolated"), isolated, sandbox], isolation: primary.isolation ?? ISOLATION_PROVIDERS });

// -> the context of the sandbox `task` owns here. Refused when the task has no workspace of its own on this
// machine: preparing one is the workspace owner's, never this subject's.
export function runtimeSandboxContext(primary, { task }) {
  if (!primary.workspaces) throw new Refused(NO_WORKSPACES);
  const workspace = primary.workspaces.found(task);
  if (!workspace) throw new Refused(`${task} has no workspace of its own here — prepare-workspace comes first`);
  return derived(primary, task, workspace);
}

function derived(primary, task, workspace) {
  const id = sandboxId({ checkout: primary.checkout, task });
  const rooms = roomsOf(primary, id);
  const sandboxes = createInstances(rooms.sandboxes, primary.io);
  const doc = () => sandboxes.read(id) ?? createdSandbox({ checkout: primary.checkout, task, workspace: workspace.id, baseRevision: workspace.baseRevision }, primary.now());
  return withViews({ ...primary, ...scopedTo(id, task, primary.providers, primary), rooms, sandboxes, sandboxId: id, task, workspace, primaryRoot: primary.root, primaryTree: primary.tree, root: workspace.path, ...held(primary, workspace, rooms, doc) }, doc);
}

const held = (primary, workspace, rooms, doc) => ({ source: primary.workspaces.sourceOf(workspace.path), tree: primary.workspaces.treeOf(workspace.path), store: createRuntimeStore(rooms.understanding, primary.io), instances: readOnlyInstances(doc), proposals: noProposals, observations: createObservations(rooms.liveSandbox, primary.io), scratch: createScratch(join(rooms.liveSandbox, "scratch"), primary.io) });

// The sandbox as it is NOW: the document, and what the workspace says about it (src/runtime/sandbox/model.mjs).
const withViews = (ctx, doc) => ({ ...ctx, sandboxDoc: doc, sandboxNow: () => sandboxNow(doc(), { tree: ctx.workspaces.tree(ctx.task), files: filesOn(ctx) }) });
