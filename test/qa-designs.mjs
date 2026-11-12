// THE CORPUS of QA designs the contradiction rules are held over (0.6.0 Q2), and the context they are read in -- shared
// by the golden snapshot (test/qa-contradictions-golden.test.mjs), the rules' own edges (test/qa-contradictions.test.mjs)
// and their properties (test/qa-causes.test.mjs):
//
//   reference  acceptance's own designs (acceptance/designs/), one per shape, on each stack and each clock it allows
//   worked     the playbook's worked designs (skills/orbit-qa/references/designs.md), on the slots each assumes
//   sent       every design the 0.5.0 benchmark's scripted QA and sessions hosts sent (test/fixtures/qa-designs/sent.json,
//              captured from benchmark/lib/qa/hosts.mjs before the benchmark's removal), each read with what the designs
//              its host sent before it would have left had they run SATISFIED
//   fixtures   the real hosts' designs kept as regression fixtures (test/fixtures/qa-false-alarms/, qa-refusals/,
//              qa-contradictions/), alone and, where a fixture names one, after the earlier test it ran after
//
// Each is read with the shipped adapters' declarations: the adapter each family is answered by on a stack -- its broker's
// for the channels, the hooks' for the rest, a database's for state -- and the request table that adapter declares.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { operationFor } from "../src/adapters/families.mjs";
import { opKeyOf } from "../src/adapters/select.mjs";
import { contradictionAdvice, contradictionFindings } from "../src/qa/backend/contradictions.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), "utf8"));

export const ADAPTERS = json("skills", "orbit-backend-test", "adapters.json").adapters;
export const PLAN = json("acceptance", "projects", "_shared", "ui-tests", "screens", "_no-screen", "invoice.plan.json");
export const ACCEPTED = new Map(PLAN.criteria.flatMap((c) => (c.expects ?? []).map((e) => [`${c.id}/${e.id}`, e])));
const TRUTH = json("acceptance", "truth.json");

export const BY_STACK = { "invoice-a": "amqp.reference", "invoice-b": "jetstream.reference" };
export const STACKS = Object.keys(BY_STACK);
const answering = (stack, family) => ({ messaging: BY_STACK[stack], observe: BY_STACK[stack], worker: "worker.hooks", scheduler: "scheduler.hooks", clock: "clock.hooks", workload: "workload.hooks", identity: "identity.hooks", state: "postgres.reference" })[family];
export const adapterOn = (stack, row) => (row ? ADAPTERS.find((x) => x.id === answering(stack, row.family)) ?? null : null);
export const operationOn = (stack, capability) => ((row) => ((a) => (a ? a.operations[opKeyOf(a, row)] ?? null : null))(adapterOn(stack, row)))(operationFor(capability));
const stepOf = (design, i) => design.skeleton?.steps?.[i - 1];
export const contextOn = (stack, design, shape, expectations = ACCEPTED) => ({ expectations, shape: shapeOf(shape), requestTableOf: (i) => operationOn(stack, stepOf(design, i)?.capability)?.request ?? null, semanticsOf: (i) => adapterOn(stack, operationFor(stepOf(design, i)?.capability))?.semantics ?? null, semanticsFor: (capability) => adapterOn(stack, operationFor(capability))?.semantics ?? null });

// An investigation's record as src/investigation/generate.mjs hands it to the contradiction stage: the shapes its accepted
// obligations hold the system to, and each earlier version that ran, read in its own obligation's context.
export const ONCE_HELD = ["completes-by-deadline", "effect-once-per-key", "occurrence-one-execution"];
export const proven = (stack, earlier, shapes = ONCE_HELD) => ({ shapes, earlier: earlier.map((e, n) => ({ version: `gen-${n + 1}@v`, shape: e.shape, design: e.design, cx: contextOn(stack, e.design, e.shape), ...(e.outcome ? { outcome: e.outcome } : {}) })) });

// ── the corpus ─────────────────────────────────────────────────────────────

const concrete = (design, over, stack) => JSON.parse(JSON.stringify({ ...design, ...over }).replaceAll("{{component}}", stack));

// acceptance's own designs, in their order, each on each stack with the clock that stack allows and every other it names.
export const REFERENCE = readdirSync(join(ROOT, "acceptance", "designs")).filter((f) => f.endsWith(".json")).map((f) => ({ shape: f.slice(0, -5), ...json("acceptance", "designs", f) })).sort((a, b) => a.order - b.order);
export const clockOf = (stack) => TRUTH.stacks[stack]?.clock ?? "none";
export const referenceOn = (stack, d, clock = clockOf(stack)) => concrete(d.design, d["by-clock"]?.[clock] ?? {}, stack);
export const references = () => REFERENCE.flatMap((d) => Object.keys(d["by-clock"] ?? { none: {} }).flatMap((clock) => STACKS.map((stack) => ({ label: `reference ${d.shape} ${stack} (${clock})`, stack, shape: d.shape, design: concrete(d.design, d["by-clock"]?.[clock] ?? {}, stack) }))));

const DOC = readFileSync(join(ROOT, "skills", "orbit-qa", "references", "designs.md"), "utf8");
export const WORKED = [...DOC.matchAll(/^### ([a-z-]+)\n[\s\S]*?```json\n([\s\S]*?)```/gm)].map(([, , text]) => JSON.parse(text));
export const worked = () => WORKED.flatMap((w) => STACKS.map((stack) => ({ label: `worked ${w.shape} ${stack}`, stack, shape: w.shape, design: w.design, expectations: new Map(Object.entries(w.accepted)) })));

export const SENT = json("test", "fixtures", "qa-designs", "sent.json");
export const sentOf = (control) => control.sent.map((s) => ({ shape: s.shape, design: SENT.designs[s.design] }));
export const sent = () => SENT.cases.flatMap((c) => c.controls.flatMap((k) => sentOf(k).map((s, n, all) => ({ label: `sent ${c.id} ${k.host} ${n + 1} ${s.shape}`, stack: c.stack, shape: s.shape, design: s.design, investigation: proven(c.stack, all.slice(0, n)) }))));

// A fixture's shape by the word its name starts with; what ran before it, by the fixture the pair names.
const FIXTURE_SHAPES = { deadline: "completes-by-deadline", occurrence: "occurrence-one-execution", once: "effect-once-per-key", persisted: "persisted-after-write" };
export const FIXTURE_DIRS = ["qa-false-alarms", "qa-refusals", "qa-contradictions"];
const AFTER = { "deadline-after-occurrence": "occurrence-decided-first", "deadline-self-published": "occurrence-advanced" };
const shapeOfFixture = (name) => FIXTURE_SHAPES[name.split("-")[0]];
const fixtureIn = (dir, name) => json("test", "fixtures", dir, `${name}.json`);
const fixtureNames = (dir) => (existsSync(join(ROOT, "test", "fixtures", dir)) ? readdirSync(join(ROOT, "test", "fixtures", dir)).filter((f) => f.endsWith(".json") && !["golden.json", "captured.json"].includes(f)).map((f) => f.slice(0, -5)).sort() : []);
const pairOf = (dir, name, stack) => (AFTER[name] ? { investigation: proven(stack, [{ shape: shapeOfFixture(AFTER[name]), design: fixtureIn(dir, AFTER[name]) }]) } : {});
const fixtureCase = (dir, name, stack, d) => ({ stack, shape: d.shape ?? shapeOfFixture(name), design: d.design ?? d, ...(d.accepted ? { expectations: new Map([...ACCEPTED, ...Object.entries(d.accepted)]) } : {}), ...(d.earlier ? { investigation: proven(stack, d.earlier, d.shapes ?? ONCE_HELD) } : pairOf(dir, name, stack)) });
export const fixtureOf = (dir, name) => fixtureIn(dir, name);
export const fixtureCaseOf = (dir, name, stack) => ({ label: `fixture ${dir}/${name} ${stack}`, ...fixtureCase(dir, name, stack, fixtureIn(dir, name)) });
export const fixtureNamesIn = (dir) => fixtureNames(dir);
export const fixtures = () => FIXTURE_DIRS.flatMap((dir) => fixtureNames(dir).flatMap((name) => STACKS.map((stack) => ({ label: `fixture ${dir}/${name} ${stack}`, ...fixtureCase(dir, name, stack, fixtureIn(dir, name)) }))));

// Every (design, context) the 0.5.0 tests asked the rules about, replayed in the context as it was captured: the request
// table and semantics each step's adapter declared, the expectations the design names, the shape, the record.
export const CAPTURED = json("test", "fixtures", "qa-contradictions", "captured.json");
const replayed = (cx) => ({ expectations: new Map(cx.expectations), shape: shapeOf(cx.shape), requestTableOf: (i) => CAPTURED.tables[cx.tables[i - 1]] ?? null, semanticsOf: (i) => CAPTURED.semantics[cx.semantics[i - 1]] ?? null, ...(cx.investigation ? { investigation: { shapes: cx.investigation.shapes, earlier: cx.investigation.earlier.map((e) => ({ ...e, design: CAPTURED.designs[e.design], cx: replayed(e.cx) })) } } : {}) });
export const captured = () => CAPTURED.entries.map((e, n) => ({ label: `captured ${n + 1} ${e.cx.shape}`, shape: e.cx.shape, design: CAPTURED.designs[e.design], cx: replayed(e.cx) }));

export const corpus = () => [...references(), ...worked(), ...sent(), ...fixtures(), ...captured()];

// What the rules say of one entry: refused, then advised, each by the rule that says it.
export const contextOf = (x) => x.cx ?? { ...contextOn(x.stack, x.design, x.shape, x.expectations ?? ACCEPTED), ...(x.investigation ? { investigation: x.investigation } : {}) };
export const saidOf = (x) => ((cx) => ({ findings: contradictionFindings(x.design, cx), advice: contradictionAdvice(x.design, cx) }))(contextOf(x));

// The golden snapshot: every entry the rules say anything of, by its label, and how many entries were read.
export function goldenOf() {
  const all = corpus();
  const said = all.map((x) => [x.label, saidOf(x)]).filter(([, s]) => s.findings.length + s.advice.length > 0);
  return { checked: all.length, said: Object.fromEntries(said) };
}
