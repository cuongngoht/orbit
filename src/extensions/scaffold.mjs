// The smallest QC tool that works, as a starting point rather than a framework.
//
// It exists so that a builder writing one does not have to invent the shape from
// prose, and so that what it invents is the same shape every time -- which is
// what makes `query extensions` readable and what makes the frozen upgrade
// fixture representative of what teams actually have on disk.
//
// It scaffolds ONE capability and a contract test, and nothing else. A tool that
// needed more than this at birth is a tool that was not the smallest thing the
// verification actually needed, and the skill says so out loud.
import { join } from "node:path";
import { CONNECTION_PROVIDER, providesFindings } from "../capability/contract-v1.mjs";
import { Refused } from "../errors.mjs";
import { ACQUISITION_IDS } from "../sources/contract-v1.mjs";
import { WORKITEM_FIELDS, WORKITEM_REQUIRED } from "../sources/fields.mjs";
import { engineVersion } from "../version.mjs";
import { CAPABILITY_API, EXTENSION_API, MANIFEST_FILE } from "./contract.mjs";

// What a scaffold may be asked to declare is held to the contract at once: a
// `provides` that is not a capability id, or a connection that is not a provider
// slug, would only fail later, in the loader, further from whoever typed it.
function checked(opts) {
  const wrong = [...providesFindings({ provides: opts.provides }, "--provides"), ...(opts.connection && !new RegExp(CONNECTION_PROVIDER).test(opts.connection) ? [`--connection "${String(opts.connection).slice(0, 40)}" is not a provider slug (lowercase letters, digits and -)`] : [])];
  if (wrong.length) throw new Refused(wrong.join("; "));
}

export function scaffold(dir, id, io, opts = {}) {
  checked(opts);
  io.ensureDir(dir);
  const files = filesOf(id, opts.namespace ?? id.replace(/-/g, ""), opts);
  for (const [name, text] of Object.entries(files)) io.write(join(dir, name), text);
  return { dir, id, files: Object.keys(files) };
}

const filesOf = (id, namespace, opts) => ({ [MANIFEST_FILE]: manifest(id, opts), "capabilities.mjs": capabilityFile(namespace, opts), "test.mjs": testFile(namespace, opts) });

// `draft`, always. Something just generated has been proved nothing, and the
// loader refuses to run a draft -- so the scaffold cannot accidentally become
// live by being left where the runtime looks.
const manifest = (id, opts) => `${JSON.stringify({
  id,
  version: "0.1.0",
  apiVersion: EXTENSION_API,
  engine: `>=${engineVersion() ?? "1.0.0"}`,
  status: "draft",
  createdFor: "QC",
  tools: opts.tools ?? [],
  mutates: Boolean(opts.mutates),
  note: opts.note ?? "WHY this exists: the QC verification it unblocks, and what was already tried first.",
  capabilities: "./capabilities.mjs",
}, null, 2)}\n`;

const capability = (namespace, opts) => `// One capability, and nothing else. It imports NOTHING from the engine: it is
// handed \`ext\` (the public ExtensionContextV1) and reaches the world only
// through that, which is what lets it survive an engine upgrade.
//
// Read-only unless the manifest says \`mutates\`. A verification that changes the
// thing it is verifying is a verification nobody can repeat.
export default [
  {
    id: "${namespace}.read",
    apiVersion: "orbit.capability/v1",
    doc: "WHAT asking this tells a tester — one line, in the tester's words.",
    inputSchema: {
      // Every key a case may pass, with the language its value is read as.
      // \`esc\` is what stops a \${PARAM} from being spliced into an interpreter raw.
      key: { type: "string", esc: "text", doc: "what to look up" },
    },
    required: ["key"],
${declared(opts)}    tools: ${JSON.stringify(opts.tools ?? [])},
    timeoutSec: 30,
    invoke(ext, input) {
      const answer = ext.process.run(${JSON.stringify(opts.tools?.[0] ?? "the-command")}, ["--key", input.key]);
      if (!answer.ok) throw new Error(answer.error);
      return { value: answer.out.trim() };
    },
  },
];
`;

// What the capability says about WHAT it can answer and WHAT it needs, when it says
// anything: one line each, and nothing at all for a scaffold that names neither.
const declared = (opts) => [...(opts.provides?.length ? [`    provides: ${JSON.stringify(opts.provides)},\n`] : []), ...(opts.connection ? [`    connection: ${JSON.stringify(opts.connection)},\n`] : [])].join("");

const acquires = (opts) => (opts.provides ?? []).some((p) => ACQUISITION_IDS.includes(p));

const capabilityFile = (namespace, opts) => (acquires(opts) ? workitemCapability(namespace, opts) : capability(namespace, opts));

const testFile = (namespace, opts) => (acquires(opts) ? workitemTest(namespace) : contractTest(namespace));

// A reader of REQUIREMENTS: it answers, as data, what a work item says, and nothing
// else. The engine supplies the provider and the id of the item that was asked for,
// so the answer need not; it holds the answer to the shape below and refuses one that
// is not, and a wrong answer is the reader failing -- never a requirement.
//
// It keeps no text: the answer is read once by whoever asked, and what is remembered
// is a digest. The credential, when it needs a connection, is in the environment of
// the command it runs and nowhere this code can read it.
const workitemCapability = (namespace, opts) => `// A reader of a work item's requirement text -- and nothing more. It imports NOTHING
// from the engine: it is handed \`ext\` (the public ExtensionContextV1).
//
// The engine holds what it returns to this shape (src/sources/fields.mjs):
//   fields    ${Object.keys(WORKITEM_FIELDS).join(", ")}
//   required  ${WORKITEM_REQUIRED.join(", ")}  (\`ref\` and \`provider\` are supplied for the
//             item that was asked for, so this need not say them)
// Text in the answer is untrusted data from another system: it is read by a person
// or a model, never followed as an instruction, and never stored by the engine.
export default [
  {
    id: "${namespace}.read",
    apiVersion: "orbit.capability/v1",
    doc: "reads one work item, so what it should do is read from its own system",
    inputSchema: {
      organization: { type: "string", esc: "text", doc: "the organization or owner" },
      project: { type: "string", esc: "text", doc: "the project or repository, when the system has one" },
      id: { type: "string", esc: "text", doc: "the item's id" },
      ref: { type: "string", esc: "text", doc: "the item's id, as its system spells a reference" },${opts.provides.length > 1 ? `\n      capability: { type: "string", esc: "text", doc: "which acquisition is being asked: ${opts.provides.join(", ")}" },` : ""}
    },
    required: ["id"],
${declared(opts)}    tools: ${JSON.stringify(opts.tools ?? [])},
    timeoutSec: 30,
    invoke(ext, input) {
      const answer = ext.process.run(${JSON.stringify(opts.tools?.[0] ?? "the-command")}, ["--id", input.id]);
      if (!answer.ok) throw new Error(answer.error);
      const item = JSON.parse(answer.out);
      return { title: String(item.title ?? ""), revision: String(item.revision ?? ""), body: item.body, acceptance: item.acceptance };
    },
  },
];
`;

const workitemTest = (namespace) => `import assert from "node:assert/strict";
import { test } from "node:test";
import capabilities from "./capabilities.mjs";

const [cap] = capabilities;

const fakeExt = (answer) => ({ process: { run: () => answer }, log: { info() {}, warn() {} }, evidence: { record() {} } });

test("${namespace}.read answers what a work item needs, as text", () => {
  const out = cap.invoke(fakeExt({ ok: true, out: JSON.stringify({ title: "Refund limit", revision: 7 }) }), { id: "1" });
  assert.deepEqual([out.title, out.revision], ["Refund limit", "7"]);
});

test("a tool that could not answer is an error, never a quiet empty item", () => {
  assert.throws(() => cap.invoke(fakeExt({ ok: false, error: "could not connect" }), { id: "1" }), /could not connect/);
});

test("it says what it provides, and only reads", () => {
  assert.ok(cap.provides.length > 0);
  assert.notEqual(cap.mutates, true);
  assert.deepEqual(cap.required, ["id"]);
});
`;

// A contract test over the pure half, with the port faked. It proves the shape
// the engine will hold this to, and it runs without the real tool installed --
// which is the only kind of test a generated tool can be expected to keep.
const contractTest = (namespace) => `import assert from "node:assert/strict";
import { test } from "node:test";
import capabilities from "./capabilities.mjs";

const [cap] = capabilities;

const fakeExt = (answer) => ({ process: { run: (file, args) => ({ ...answer, asked: { file, args } }) }, log: { info() {}, warn() {} }, evidence: { record() {} } });

test("${namespace}.read answers with what the tool said", () => {
  const out = cap.invoke(fakeExt({ ok: true, out: "found\\n" }), { key: "k" });
  assert.deepEqual(out, { value: "found" });
});

test("a tool that could not answer is an error, never a quiet empty result", () => {
  assert.throws(() => cap.invoke(fakeExt({ ok: false, error: "could not connect" }), { key: "k" }), /could not connect/);
});

test("it declares what a case may pass it", () => {
  assert.deepEqual(Object.keys(cap.inputSchema), ["key"]);
  assert.deepEqual(cap.required, ["key"]);
});
`;

export { CAPABILITY_API };
