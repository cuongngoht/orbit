// THE PROOF that Orbit learns a company it has never heard of without learning
// anything in its core. A fictional company's vocabulary arrives through an
// EXTENSION (test/fixtures/knowledge/), loaded by the real loader; its claims
// arrive through the one door; its capability is registered by a second
// extension. The engine is asked, and answers -- and the last test reads
// src/, cli/, catalog/ and skills/ to show none of it had to be taught there.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { withExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { createKnowledgeParts } from "../src/extensions/knowledge-parts.mjs";
import { derive } from "../src/knowledge/derive.mjs";
import { ingest } from "../src/knowledge/ingest.mjs";
import { discovered } from "../src/knowledge/opportunities.mjs";
import { measured, query } from "../src/knowledge/query.mjs";
import { surfaced } from "../src/knowledge/surface.mjs";
import { resolved } from "../src/knowledge/verify.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { candidate, knowledgeWorld, seenBy } from "./fakes/knowledge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURES = join(HERE, "fixtures", "knowledge");

// A machine store holding exactly the named extensions, loaded for real.
async function loaded(ids) {
  const root = mkdtempSync(join(tmpdir(), "orbit-company-"));
  const room = qcToolPaths(root).root;
  mkdirSync(room, { recursive: true });
  for (const id of ids) cpSync(join(FIXTURES, id), join(room, id), { recursive: true });
  return withExtensions({ ...fakeContext(), store: () => root, process: fakeProcess() });
}

const ZETA = { "company.dimension.zeta": "omega" };
const at = (over) => candidate({ evidence: ["src/app/group.ts"], ...over });

// The company's knowledge, as claims -- recorded through the same door as any.
const CLAIMS = [
  at({ subject: "company.operation.beta", relation: "company.relation.gamma", object: "company.system.alpha.record" }),
  at({ subject: "company.system.alpha.record", relation: "company.relation.via", object: "company.mechanism.epsilon", context: ZETA }),
  at({ subject: "company.system.alpha.record", relation: "company.relation.witness", object: "company.observation.eta" }),
  at({ subject: "company.observation.eta", relation: "company.relation.needs", object: "company.capability.delta" }),
];

function taught(base) {
  const ctx = knowledgeWorld({ parts: base.knowledge, capabilities: base.capabilities.list() });
  ingest(ctx, CLAIMS, { seenBy: seenBy() });
  return ctx;
}

const ask = (context = ZETA) => ({ tokens: ["company", "operation", "beta"], subjects: [], context, near: [], changed: [] });

test("§29 taught by extensions only: a relation, a contextual implementation, an observation and a capability -- and the resolver finds the provider", async () => {
  const base = await loaded(["company-knowledge", "company-delta"]);
  assert.deepEqual(base.extensions.refused, []);
  assert.deepEqual(base.extensions.loaded.map((e) => [e.id, e.relations.length, e.capabilities.length]), [["company-delta", 0, 1], ["company-knowledge", 4, 0]]);
  const ctx = taught(base);
  const found = derive(ctx.know.all(), ask(), ctx.parts, measured(ctx, ctx.know.all()));
  assert.deepEqual(found.needs.map((n) => [n.capability, n.proves.consequence, n.proves.observation]), [["company.capability.delta", "company.system.alpha.record", "company.observation.eta"]]);
  const [result] = resolved(found.needs, ctx.effective()).results;
  assert.deepEqual([result.outcome, result.provider.kind, result.provider.id, result.provider.ownership], ["provided", "capability", "company.capability.delta", "project"]);
});

test("§29 the contextual implementation is answered in its context, and only there", async () => {
  const ctx = taught(await loaded(["company-knowledge", "company-delta"]));
  const via = (context) => query(ctx.know.all(), { ...ask(context), subjects: ["company.system.alpha.record"] }, ctx.parts).answers.find((a) => a.relation.id === "company.relation.via");
  assert.deepEqual([via(ZETA).status, via(ZETA).prevails[0].claim.object], ["known", "company.mechanism.epsilon"]);
  assert.equal(via({ "company.dimension.zeta": "sigma" }), undefined, "excluded elsewhere: it says nothing there");
  assert.equal(via({}).status, "unknown", "and nowhere is it a global rule");
});

test("§29 with the provider REMOVED, the same need becomes an opportunity -- never a failure -- and a verification asks it once", async () => {
  const ctx = taught(await loaded(["company-knowledge"]));
  const found = derive(ctx.know.all(), ask(), ctx.parts);
  const results = resolved(found.needs, ctx.effective()).results;
  assert.deepEqual(results.map((r) => [r.outcome, r.remedy]), [["gap", "prepare"]]);
  const run = { at: "2026-09-24T10:00:00.000Z", workflow: "company-release", purpose: "verification", seenBy: seenBy(), subjects: found.subjects, context: ZETA };
  const [doc] = discovered([], results, run);
  const world = { purpose: "verification", workflow: "company-release", seenBy: run.seenBy, derived: new Map([["company.capability.delta", found.needs]]), demanded: new Map() };
  assert.deepEqual([doc.capability, doc.state, surfaced(doc, world).row], ["company.capability.delta", "candidate", "DEMANDED"]);
});

test("the engine does not understand the company: without its vocabulary the same claims are kept, recalled -- and derive nothing", async () => {
  const bare = knowledgeWorld({ parts: createKnowledgeParts() });
  ingest(bare, CLAIMS, { seenBy: seenBy() });
  const found = derive(bare.know.all(), ask(), bare.parts);
  assert.deepEqual([bare.know.all().length, found.needs.length], [4, 0]);
  assert.ok(found.uninterpreted.includes("company.relation.gamma"));
  assert.ok(query(bare.know.all(), ask(), bare.parts).answers.some((a) => a.relation.id === "company.relation.gamma" && a.role === null), "recalled, with no role");
});

test("§31 a relation never seen before is persisted, recalled, scoped and evidenced -- and reaches the extension that understands it", async () => {
  const base = await loaded(["company-knowledge"]);
  const ctx = knowledgeWorld({ parts: base.knowledge });
  const [d] = ingest(ctx, [at({ subject: "company.operation.beta", relation: "relation-never-seen-before", object: "company.thing.kappa", context: ZETA, evidence: ["src/app/group.ts", "test/workspace.test.ts"] })], { seenBy: seenBy() });
  const stored = ctx.know.find(d.claim.id);
  assert.deepEqual([stored.relation, stored.context, stored.evidence], ["relation-never-seen-before", ZETA, ["src/app/group.ts", "test/workspace.test.ts"]]);
  const answer = query(ctx.know.all(), ask(), ctx.parts).answers.find((a) => a.relation.id === "relation-never-seen-before");
  assert.deepEqual([answer.status, answer.role], ["many", null]);
  assert.equal(query(ctx.know.all(), ask({ "company.dimension.zeta": "sigma" }), ctx.parts).answers.length, 0, "scoped: elsewhere it says nothing");
  const found = derive(ctx.know.all(), ask(), ctx.parts);
  assert.deepEqual(found.notes, ["company-knowledge.unseen: company.operation.beta is linked to company.thing.kappa in a way only this company understands"]);
  assert.deepEqual(found.uninterpreted, [], "understood by an interpreter, not by a central enum");
});

test("a knowledge module that breaks its contract refuses its WHOLE extension -- the capability beside it too", async () => {
  const base = await loaded(["company-broken", "company-knowledge"]);
  assert.deepEqual(base.extensions.refused.map((r) => r.id), ["company-broken"]);
  assert.match(base.extensions.refused[0].why, /does not hold/);
  assert.equal(base.capabilities.has("company.capability.broken"), false);
  assert.equal(base.knowledge.relation("company.relation.gamma").role, "consequence", "the rest still load");
});

// The kernel and the trail reach no other memory: what they need of
// architecture, engineering, the working set or a host's memory is bound by
// their composition roots (cli/knowledge.mjs, cli/learn-hook.mjs) and handed
// IN. The one thing either reads out of learn/ is the argument helper every
// view in this engine shares. (That neither names a host is
// test/knowledge-hosts.test.mjs's.)
test("src/knowledge/ and src/trace/ import no other subsystem's memory", () => {
  const files = (d) => readdirSync(join(ROOT, d), { recursive: true }).filter((f) => String(f).endsWith(".mjs")).map((f) => join(ROOT, d, String(f)));
  for (const file of [...files("src/knowledge"), ...files("src/trace")]) {
    const imports = [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    for (const i of imports) assert.doesNotMatch(i, /\/(architecture|engineering|intelligence|qa|help|lifecycle|run|report)\//, `${file} imports ${i}`);
    for (const i of imports.filter((x) => /\/learn\//.test(x))) assert.match(i, /\/learn\/args\.mjs$/, `${file} imports ${i}`);
  }
});

test("zero core change: no fictional id appears anywhere the engine ships", () => {
  const FICTION = /company\.(system|operation|relation|capability|dimension|mechanism|observation|thing)\.|relation-never-seen-before|company-knowledge|company-delta/;
  const shipped = ["src", "cli", "catalog", "skills"].flatMap((d) => readdirSync(join(ROOT, d), { recursive: true }).filter((f) => /\.(mjs|json|md)$/.test(String(f))).map((f) => join(ROOT, d, String(f))));
  for (const file of shipped) assert.doesNotMatch(readFileSync(file, "utf8"), FICTION, file);
});
