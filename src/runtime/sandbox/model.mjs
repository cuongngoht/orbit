// What a sandbox IS right now, as one ordered table over what is kept and what the workspace says.
//
// The document keeps the state it was last WRITTEN in. Whether the sandbox is still good is a fact about
// the workspace -- its source tree, the definition files it was built from -- and the workspace moves
// without telling anyone (an editor, a `record-changes`, a rebuild). So STALE is derived on every read,
// by asking the workspace, and never written by whoever changed the files: nothing that edits a workspace
// has to know a sandbox exists, and a person reading a stale sandbox sees WHY it is stale.
//
// `now` is `{ tree, files }`: the workspace's tree id as it is now (null when it cannot be told) and the
// fingerprints of its dev container definition files (src/runtime/validate.mjs `filesOn`).
export const differs = (recorded, disk) => Object.keys({ ...recorded, ...disk }).some((p) => (recorded[p] ?? null) !== (disk[p] ?? null));

const asStale = (doc, because, extra = {}) => ({ ...doc, state: "STALE", because, ...extra });

// Ordered; the first row that matches decides, and the last always matches. `say` is the sentence a person reads.
export const SANDBOX_NOW = [
  { name: "RELEASED", when: (d) => d.state === "RELEASED", as: (d) => d, say: "released: nothing of it runs and nothing is leased" },
  { name: "UNPREPARED", when: (d) => ["ALLOCATED", "PREPARING", "AMBIGUOUS"].includes(d.state), as: (d) => d, say: "not prepared yet, or a preparation that never settled" },
  { name: "NO_TREE", when: (d, now) => !now.tree, as: (d) => asStale(d, "the workspace is not there, or git did not answer for it"), say: "the workspace cannot be read, so nothing built from it can be trusted" },
  { name: "MOVED", when: (d, now) => d.source?.tree !== now.tree, as: (d, now) => asStale(d, "the workspace moved after this sandbox was built from it", { stale: { prepared: d.source?.tree ?? null, current: now.tree } }), say: "the workspace's source tree is not the one the sandbox was built from" },
  { name: "DEFINITION", when: (d, now) => Boolean(d.backing?.devcontainer) && differs(d.backing.devcontainer.files ?? {}, now.files ?? {}), as: (d) => asStale(d, "a dev container definition changed since its environment came up"), say: "the container's definition is not the one it was built from" },
  { name: "CURRENT", when: () => true, as: (d) => d, say: "built from the workspace's current source tree" },
];

export const sandboxNow = (doc, now) => SANDBOX_NOW.find((r) => r.when(doc, now)).as(doc, now);

// The row's name, for a sentence or a test.
export const nowRow = (doc, now) => SANDBOX_NOW.find((r) => r.when(doc, now)).name;
