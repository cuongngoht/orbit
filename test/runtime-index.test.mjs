// The commands, end to end, through the table: the lifecycle as a person runs it, the
// governance table and the command table agreeing, and every refusal that stops
// something happening in the wrong order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS, COMMAND_NAMES, governed } from "../src/runtime/index.mjs";
import { OPERATIONS, NOT_RUNTIME } from "../src/runtime/governance.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { STALE_REVISION } from "../src/store/revisioned.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { DEVCONTAINER_JSONC, NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { CHECKOUT, fakeRuntime } from "./fakes/runtime-ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TOOLS = { node: "22.1.0", npm: "10.8.1", dotnet: "8.0.100", docker: "27.3.1", "docker-daemon": "27.3.1", devcontainer: "0.71.0" };
const NEWER = { ...NODE_AND_DOTNET, "api/Api.csproj": `<Project Sdk="Vendor.NET.Sdk.Web"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>` };

const run = async (rt, name, ...args) => COMMANDS[name].run(rt.ctx, args);

// A person adopting through Orbit Control's door: adopting writes the checkout, the PRIMARY_CHECKOUT_WRITE protected
// boundary only a person's own act crosses (src/protected/). A terminal with no person typing in it is refused.
const asPerson = async (rt, name, ...args) => COMMANDS[name].run({ ...rt.ctx, door: "control" }, args);

// A runtime whose checkout is bound, as it is once Orbit has been used from it.
function bound(files = NODE_AND_DOTNET, opts = {}) {
  const rt = fakeRuntime(files, { tools: TOOLS, ...opts });
  rt.io.write(join(stateRooms("/store").checkouts, `${CHECKOUT}.json`), JSON.stringify({ key: "repo-aaaa", root: "/work/shop" }));
  return rt;
}

test("the command table and the governance table are one: every command is governed, writes what it says, and no command is QA's", () => {
  const gov = Object.fromEntries(governed().map((g) => [g.command, g.mutates]));
  assert.deepEqual(Object.keys(gov).sort(), [...COMMAND_NAMES].sort());
  for (const [name, entry] of Object.entries(COMMANDS)) assert.equal(entry.writes, gov[name] === "none" ? "nothing" : gov[name], name);
  assert.deepEqual(Object.entries(COMMANDS).filter(([, c]) => c.writes === "repository").map(([n]) => n), ["adopt"]);
  assert.deepEqual(NOT_RUNTIME.filter((n) => OPERATIONS.some((o) => o.class === n)), []);
  assert.deepEqual(Object.entries(COMMANDS).filter(([, c]) => c.needs === "machine").map(([n]) => n), ["projects", "forget"]);
});

test("Scenario A end to end: discover, doctor, start native, status, stop -- and no container anywhere", async () => {
  const rt = bound();
  const discovered = await run(rt, "discover");
  assert.deepEqual([discovered.decision.name, discovered.state, discovered.byKind.component], ["BOOTSTRAP", "CURRENT", 3]);
  assert.match(COMMANDS.discover.say(discovered), /RUNTIME BOOTSTRAP · CURRENT/);
  assert.equal((await run(rt, "doctor")).plan.overall, "READY");
  const started = await run(rt, "start");
  assert.deepEqual(started.started.map((s) => s.component).sort(), ["dotnet:api", "node:web"]);
  assert.match(COMMANDS.start.say(started), /RUNNING is not READY/);
  const status = await run(rt, "status");
  assert.deepEqual([status.plan.overall, status.sessions.filter((s) => s.state === "RUNNING").length], ["READY", 2]);
  assert.match(COMMANDS.status.say(status), /components:/);
  assert.equal((await run(rt, "stop")).stopped.length, 2);
  assert.equal(rt.process.launches.some((l) => /devcontainer|docker/.test(l.file)), false);
});

test("a project's registry summary follows what the commands did: discovered, then running, then stopped", async () => {
  const rt = bound();
  await run(rt, "discover");
  const summary = () => rt.ctx.registry.find("repo-aaaa", CHECKOUT).checkout.summary;
  assert.deepEqual([summary().understanding, summary().branch], ["CURRENT", "main"]);
  await run(rt, "doctor");
  assert.equal(summary().runtime, "STOPPED");
  await run(rt, "start");
  assert.equal(summary().runtime, "RUNNING");
  await run(rt, "stop");
  assert.equal(summary().runtime, "STOPPED");
  assert.equal(COMMANDS.projects.run(rt.ctx)[0].checkouts[0].summary.runtime, "STOPPED");
  assert.match(COMMANDS.projects.say(COMMANDS.projects.run(rt.ctx)), /project\s+branch\s+runtime\s+understanding/);
});

test("nothing is designed or started on nothing: discover comes first, and what moved must be read again", async () => {
  const rt = bound();
  await assert.rejects(() => run(rt, "design"), (e) => e instanceof Refused && /run `runtime discover` first/.test(e.message));
  await assert.rejects(() => run(rt, "start"), /run `runtime discover` first/);
  await run(rt, "discover");
  rt.source.write("web/package.json", JSON.stringify({ engines: { node: ">=24" }, scripts: { dev: "vite" } }));
  await assert.rejects(() => run(rt, "start"), (e) => e instanceof Refused && /STALE: run `runtime discover` first/.test(e.message));
  assert.equal(rt.process.launches.length, 0);
});

test("a design and an adopt refuse to rest on facts the files have moved past -- the way a start does", async () => {
  const rt = bound();
  await run(rt, "discover");
  const proposal = await run(rt, "design");
  rt.source.write("web/package.json", JSON.stringify({ engines: { node: ">=24" }, scripts: { dev: "vite" } }));
  await assert.rejects(() => run(rt, "design"), (e) => e instanceof Refused && /STALE: run `runtime discover` first, so the environment it designs rests on what the files say now/.test(e.message));
  await assert.rejects(() => asPerson(rt, "adopt", proposal.id, "--human"), (e) => e instanceof Refused && /so what is adopted rests on what the files say now/.test(e.message));
  assert.deepEqual(rt.tree.state.writes, [], "nothing was written on facts a commit old");
  await run(rt, "discover");
  assert.equal((await run(rt, "design")).state, "CREATE", "and once it is read again, a design is made");
});

test("a design asked for again after its files were removed is OPEN again, and can be adopted again -- not a dead end", async () => {
  const rt = bound();
  await run(rt, "discover");
  const first = await run(rt, "design");
  await asPerson(rt, "adopt", first.id, "--human");
  assert.equal(rt.ctx.proposals.read(first.id).status, "adopted");
  const again = await run(rt, "design");
  assert.notEqual(again.state, "CREATE", "while the files are there there is nothing to create: the design is a different one");
  delete rt.tree.state.files[".devcontainer/devcontainer.json"];
  const reopened = await run(rt, "design");
  assert.deepEqual([reopened.id, reopened.state, rt.ctx.proposals.read(first.id).status], [first.id, "CREATE", "open"], "the same design, open again");
  const done = await asPerson(rt, "adopt", first.id, "--human");
  assert.equal(done.instance.state, "ADOPTED");
  assert.deepEqual(rt.tree.state.writes, [".devcontainer/devcontainer.json", ".devcontainer/devcontainer.json"], "written the first time and again");
});

test("a machine without the container tools is BLOCKED, and the environment is neither failed nor changed by it", async () => {
  const rt = bound(NODE_AND_DOTNET, { tools: { ...TOOLS, docker: false, "docker-daemon": false, devcontainer: false } });
  await run(rt, "discover");
  await run(rt, "doctor");
  const proposal = await run(rt, "design");
  await asPerson(rt, "adopt", proposal.id, "--human");
  const before = JSON.stringify(rt.ctx.instances.list());
  await assert.rejects(() => run(rt, "validate"), (e) => e instanceof Blocked && /the Docker command is not available — install Docker/.test(e.message) && /the Dev Containers CLI is not available/.test(e.message));
  assert.equal(JSON.stringify(rt.ctx.instances.list()), before, "the instance is exactly as it was: ADOPTED, no failed validation recorded");
  assert.deepEqual(rt.process.calls.filter((c) => c.file === "devcontainer"), [], "and nothing was asked of a tool that is not there");
  await assert.rejects(() => run(rt, "prepare", "--apply"), (e) => e instanceof Blocked);
});

test("--dry says what would be read and leaves the store and the registry alone", async () => {
  const rt = bound();
  const dry = await run(rt, "discover", "--dry");
  assert.deepEqual([dry.decision.writes, dry.facts > 0, rt.store.all().length], [false, true, 0]);
  assert.equal(rt.ctx.registry.find("repo-aaaa", CHECKOUT).checkout.summary, null);
  assert.match(COMMANDS.discover.say(dry), /--dry: nothing was written/);
});

test("Scenario B end to end: design -> review -> adopt (a person) -> validate -> start in the container -- and native was never in the way", async () => {
  const rt = bound();
  await run(rt, "discover");
  const proposal = await run(rt, "design");
  assert.equal(proposal.state, "CREATE");
  assert.match(COMMANDS.design.say(proposal), /adopt it yourself in Orbit Control \(Runtime → proposal ep-[a-f0-9]{12} → Adopt\)/);
  assert.match(COMMANDS.design.say(proposal), /\n {2}create \.devcontainer\/devcontainer\.json\n {6}\| \/\/ Created by Orbit[^\n]*\n(?: {6}\|[^\n]*\n)*? {6}\|\s+"appPort": \[/, "a person reviews the bytes adopting would write");
  assert.equal(rt.tree.state.writes.length, 0, "designing writes nothing");
  assert.equal((await run(rt, "design")).id, proposal.id, "the same design is the same proposal");
  assert.equal(rt.ctx.proposals.list().length, 1);
  await assert.rejects(() => run(rt, "adopt", proposal.id), (e) => e.code === "PROTECTED_DENIED" && /A person does it themselves, in Orbit Control \(Runtime → proposal ep-[a-f0-9]{12} → Adopt\)/.test(e.message));
  await assert.rejects(() => run(rt, "adopt", proposal.id, "--human"), (e) => e.code === "PROTECTED_DENIED", "--human from a terminal crosses nothing");
  assert.equal(rt.tree.state.writes.length, 0, "an agent's adopt writes nothing");
  const adopted = await asPerson(rt, "adopt", proposal.id, "--human");
  assert.deepEqual([adopted.instance.state, rt.tree.state.writes], ["ADOPTED", [".devcontainer/devcontainer.json"]]);
  assert.match(COMMANDS.adopt.say(adopted), /adopted is not validated/);
  rt.process.run = (file, args) => (rt.process.calls.push({ file, args }), { ok: true, out: "", status: 0 });
  assert.equal((await run(rt, "validate")).state, "VALIDATED", "bringing a local environment up is autonomous: nobody relays anything");
  await run(rt, "configure", "--strategy=devcontainer", "--human");
  rt.process.run = (file, args) => (rt.process.calls.push({ file, args }), { ok: true, out: args[0] === "ps" ? "abc\n" : "", status: 0 });
  const started = await run(rt, "start", "--component=node:web");
  assert.equal(started.started[0].provider, "devcontainer");
  assert.equal(rt.process.launches.at(-1).file, "devcontainer");
  assert.ok(rt.process.launches.at(-1).args.includes(`ORBIT_RUNTIME_SESSION=${started.started[0].session}`), "what it starts carries the session's marker, for the stop to find");
});

test("a port a person says a component answers on is PUBLISHED too, when the checkout's own files name none", async () => {
  const rt = bound({ "web/package.json": JSON.stringify({ engines: { node: ">=22" }, scripts: { start: "node server.js" } }), "web/package-lock.json": "{}" });
  await run(rt, "discover");
  assert.equal((await run(rt, "design")).files.create[0].text.includes("appPort"), false, "nothing names a port yet");
  await run(rt, "configure", "--component=node:web", "--probe=tcp", "--target=3000", "--human");
  assert.match((await run(rt, "design")).files.create[0].text, /"appPort": \[\s*3000\s*\]/);
  await run(rt, "configure", "--component=node:web", "--probe=http", "--target=http://127.0.0.1:8080/health", "--expect=200", "--human");
  assert.match((await run(rt, "design")).files.create[0].text, /"appPort": \[\s*8080\s*\]/);
});

test("Scenario C end to end: a stale dev container is PATCHED -- comments intact -- only after a person adopts it", async () => {
  const rt = bound(NEWER, { worktree: { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC } });
  await run(rt, "discover");
  const proposal = await run(rt, "design");
  assert.equal(proposal.state, "PATCH");
  assert.match(COMMANDS.design.say(proposal), /\n {2}patch {2}\.devcontainer\/devcontainer\.json {2}\(2 edit\(s\); every other byte stays\)\n {6}set {4}features › ghcr\.io\/devcontainers\/features\/dotnet:2 › version {2}"9\.0"\n {6}set {4}features › ghcr\.io\/devcontainers\/features\/node:1 › version {2}"22"\n/, "each edit, as the key it touches and the value it leaves");
  await asPerson(rt, "adopt", "--human");
  assert.equal(rt.tree.read(".devcontainer/devcontainer.json"), DEVCONTAINER_JSONC.replace('"version": "20"', '"version": "22"').replace('"version": "8.0"', '"version": "9.0"'));
});

test("adopting is refused before anything of the checkout is touched unless Orbit Control's door is acting", async () => {
  const inert = new Proxy({}, { get: (target, key) => { if (key === "door") return undefined; throw new Error("the context was touched"); } });
  await assert.rejects(() => COMMANDS.adopt.run(inert, ["ep-aaaaaaaaaaaa"]), (e) => e.code === "PROTECTED_DENIED" && /in Orbit Control \(Runtime → proposal ep-aaaaaaaaaaaa → Adopt\)/.test(e.message));
  await assert.rejects(() => COMMANDS.adopt.run(inert, ["ep-aaaaaaaaaaaa", "--human"]), (e) => e.code === "PROTECTED_DENIED");
});

test("forgetting a checkout whose directory is gone is store bookkeeping, and autonomous; a checkout is named by the directory projects prints or by twelve characters of its id", async () => {
  const asked = [];
  const twins = [{ id: "ab".repeat(32), root: "/work/gone" }, { id: `${"ab".repeat(6)}${"cd".repeat(26)}`, root: "/work/also-gone" }];
  const ctx = { registry: { list: () => [{ key: "repo-aaaa", name: "shop", checkouts: twins.map((c) => ({ ...c, exists: false })) }], forget: (key, id) => asked.push([key, id]) } };
  const done = await COMMANDS.forget.run(ctx, ["/work/gone"]);
  assert.match(COMMANDS.forget.say(done), /FORGOTTEN \/work\/gone, a checkout of shop whose directory is gone/);
  await COMMANDS.forget.run(ctx, [twins[1].id.slice(0, 14), "--human"]);
  assert.deepEqual(asked, [["repo-aaaa", twins[0].id], ["repo-aaaa", twins[1].id]]);
  await assert.rejects(() => COMMANDS.forget.run(ctx, ["ab".repeat(6), "--human"]), /names more than one checkout/);
  await assert.rejects(() => COMMANDS.forget.run(ctx, ["/work/nowhere", "--human"]), /no checkout \/work\/nowhere is known on this machine/);
  assert.match(COMMANDS.projects.say(ctx.registry.list()), /comes off this list with: runtime forget <its directory>/);
});

test("a stale proposal is refused -- the developer's edit is not overwritten -- and designing again makes a fresh one", async () => {
  const rt = bound(NEWER, { worktree: { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC } });
  await run(rt, "discover");
  const proposal = await run(rt, "design");
  rt.tree.edit(".devcontainer/devcontainer.json", `${DEVCONTAINER_JSONC}// mine\n`);
  await assert.rejects(() => asPerson(rt, "adopt", proposal.id, "--human"), (e) => e.code === "STALE_PROPOSAL");
  const fresh = await run(rt, "design");
  assert.notEqual(fresh.id, proposal.id);
  assert.equal((await asPerson(rt, "adopt", fresh.id, "--human")).instance.state, "ADOPTED");
  assert.ok(rt.tree.read(".devcontainer/devcontainer.json").includes("// mine"), "their note survived the patch");
});

test("a definition that appears while a CREATE proposal is being read makes it stale too", async () => {
  const rt = bound();
  await run(rt, "discover");
  const proposal = await run(rt, "design");
  rt.tree.edit(".devcontainer.json", "{}");
  await assert.rejects(() => asPerson(rt, "adopt", proposal.id, "--human"), (e) => e.code === "STALE_PROPOSAL" && /\.devcontainer\.json changed/.test(e.message));
});

test("record keeps an agent's inference as a HYPOTHESIS: possible, never certain, never launched, and never overwriting what a file derived", async () => {
  const rt = bound({ ...NODE_AND_DOTNET, "README.md": "# shop\nRun `npm run dev:all` for everything.\n" });
  await run(rt, "discover");
  rt.ctx.read = () => [JSON.stringify({ kind: "command", key: "web|dev:all", statement: "the README says dev:all starts everything", scope: ["README.md"], evidence: ["README.md"], because: "documented in the README, not declared by a file", declaredAs: "dev:all", text: "npm run dev:all", purpose: "start", unknowns: ["whether it is still true"] })].join("\n");
  const out = await run(rt, "record");
  assert.equal(out.recorded, 1);
  const fact = rt.store.all().find((f) => f.source === "inference");
  assert.deepEqual([fact.confidence, fact.safe, fact.argv, fact.key], ["possible", false, [], "inference|web|dev:all"]);
  await run(rt, "discover", "--rescan");
  assert.equal(rt.store.all().some((f) => f.source === "inference"), true, "a rescan does not remove what a read did not derive");
  await run(rt, "doctor");
  const view = (await run(rt, "status")).plan.components.find((c) => c.key === "node:web");
  assert.equal(view.command.declaredAs, "dev", "the inferred command is never the one that starts");
});

test("a batch of inferences is all or nothing, and may not claim what the engine stamps, a command's argv, or a path nothing tracks", async () => {
  const rt = bound();
  await run(rt, "discover");
  const good = { kind: "port", key: "api|9000", statement: "x", scope: ["web/package.json"], evidence: ["web/package.json"], because: "read it", port: 9000 };
  rt.ctx.read = () => [JSON.stringify(good), JSON.stringify({ ...good, key: "b", source: "manifest", confidence: "certain", id: "x", argv: ["rm"], safe: true, evidence: ["nowhere.md"] }), JSON.stringify({ ...good, kind: "component", key: "c" })].join("\n");
  const before = rt.store.all().length;
  await assert.rejects(() => run(rt, "record"), (e) => e instanceof Refused && /all or nothing/.test(e.message) && /source is stamped by the engine/.test(e.message) && /nowhere\.md is not a tracked path/.test(e.message) && /kind is requirement, command/.test(e.message));
  assert.equal(rt.store.all().length, before, "not even the good one was kept");
  rt.ctx.read = () => "not json";
  await assert.rejects(() => run(rt, "record"), /line 1 is not JSON/);
  rt.ctx.read = () => "";
  await assert.rejects(() => run(rt, "record"), /no candidates were given/);
});

test("configure is a person's, names the revision it read, and applies flags field by field", async () => {
  const rt = bound();
  await assert.rejects(() => run(rt, "configure", "--strategy=native"), /relay them with --human/);
  const first = await run(rt, "configure", "--strategy=native", "--component=node:web", "--command=dev", "--probe=http", "--target=http://localhost:5173/health", "--expect=200", "--env=NODE_OPTIONS,PORT", "--human");
  assert.deepEqual([first.settings.strategy, first.settings.components["node:web"].command, first.settings.components["node:web"].env], ["native", "dev", ["NODE_OPTIONS", "PORT"]]);
  const second = await run(rt, "configure", "--component=node:web", "--provider=native", "--human");
  assert.deepEqual([second.settings.components["node:web"].command, second.settings.components["node:web"].provider], ["dev", "native"]);
  const cleared = await run(rt, "configure", "--component=node:web", "--clear", "--human");
  assert.deepEqual(cleared.settings.components, {});
  assert.match(COMMANDS.settings.say(await run(rt, "settings")), /SETTINGS for this machine · strategy native/);
  await assert.rejects(() => run(rt, "configure", "--strategy=teleport", "--human"), /do not hold/);
});

test("configure keeps a connectivity target field by field under --reach, sets the retry policy for all or for one, and --remove-reach takes it away", async () => {
  const rt = bound();
  const added = await run(rt, "configure", "--reach=corporate-sql", "--label=Corporate SQL", "--address=sql.corp.example", "--port=1433", "--required-by=dotnet:api", "--check-from=native,devcontainer", "--before-start=true", "--note=reached over the VPN", "--human");
  assert.deepEqual(added.settings.connectivity.targets["corporate-sql"], { label: "Corporate SQL", host: "sql.corp.example", port: 1433, protocol: "tcp", requiredBy: ["dotnet:api"], checkFrom: ["native", "devcontainer"], beforeStart: true, note: "reached over the VPN", classification: "unknown" });
  const relabelled = await run(rt, "configure", "--reach=corporate-sql", "--label=The SQL server", "--human");
  assert.deepEqual([relabelled.settings.connectivity.targets["corporate-sql"].label, relabelled.settings.connectivity.targets["corporate-sql"].host], ["The SQL server", "sql.corp.example"], "one field changes, every other stays");
  const policy = await run(rt, "configure", "--retry-attempts=5", "--retry-interval-ms=500", "--human");
  assert.deepEqual(policy.settings.connectivity.retry, { attempts: 5, intervalMs: 500, timeoutMs: 3000 });
  const own = await run(rt, "configure", "--reach=corporate-sql", "--retry-timeout-ms=10000", "--human");
  assert.deepEqual([own.settings.connectivity.targets["corporate-sql"].retry, own.settings.connectivity.retry.timeoutMs], [{ timeoutMs: 10000 }, 3000], "with --reach the policy is that target's own");
  assert.match(COMMANDS.settings.say(await run(rt, "settings")), /connectivity: retry 5 attempt\(s\), 500 ms apart, 3000 ms each[\s\S]*corporate-sql\s+sql\.corp\.example:1433\s+dotnet:api\s+native,devcontainer\s+before start\s+5 attempt\(s\), 500 ms apart, 10000 ms each/);
  await assert.rejects(() => run(rt, "configure", "--reach=corporate-sql", "--address=http://sql.corp.example", "--human"), /no scheme, no credential and no path/);
  await assert.rejects(() => run(rt, "configure", "--retry-attempts=0", "--human"), /retry\.attempts is 1 to 10/);
  const removed = await run(rt, "configure", "--reach=corporate-sql", "--remove-reach", "--human");
  assert.deepEqual(removed.settings.connectivity.targets, {});
  await assert.rejects(() => run(rt, "configure", "--reach=x", "--address=db", "--port=1"), /relay them with --human/);
});

test("a target required by a key no component of the checkout has is kept and SAID -- a typo gates nothing, silently or otherwise", async () => {
  const rt = bound();
  const before = await run(rt, "configure", "--reach=db", "--address=db.internal", "--port=1433", "--required-by=dotnet:Api-typo", "--human");
  assert.equal(before.notes, undefined, "nothing is understood yet: there is nothing to hold a key against");
  await run(rt, "discover");
  const known = (await run(rt, "status")).plan.components[0].key;
  const after = await run(rt, "configure", "--reach=db", `--required-by=${known},dotnet:Api-typo`, "--human");
  assert.deepEqual(after.settings.connectivity.targets.db.requiredBy, [known, "dotnet:Api-typo"], "kept: a component may come");
  assert.deepEqual(after.notes, ["db is required by dotnet:Api-typo, which is not a component of this checkout: it gates nothing for it"]);
  assert.match(COMMANDS.configure.say(after), /note: db is required by dotnet:Api-typo/);
});

test("a target checked before a start that no component requires gates nothing -- and is SAID to, not shown as a gate", async () => {
  const rt = bound();
  const set = await run(rt, "configure", "--reach=db", "--address=db.internal", "--port=1433", "--before-start=true", "--human");
  assert.deepEqual(set.notes, ["db is checked before a start, and no component requires it: it gates nothing until one does (--required-by)"]);
  assert.match(COMMANDS.connectivity.say(await run(rt, "connectivity")), /before start, but nothing requires it yet: it gates nothing/);
});

test("a stale settings write from a screen that read an old revision is refused, not merged", () => {
  const rt = bound();
  const first = rt.ctx.writeSettings({ next: { strategy: "native" }, revision: null, by: "person" });
  rt.ctx.writeSettings({ next: { strategy: "auto" }, revision: first.revision, by: "person" });
  assert.throws(() => rt.ctx.writeSettings({ next: { strategy: "devcontainer" }, revision: first.revision, by: "person" }), (e) => e.code === STALE_REVISION);
});

test("a start of a component that is not known, or whose environment is not ready, says what is in the way", async () => {
  const rt = bound({ ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC, ...NODE_AND_DOTNET });
  await run(rt, "discover");
  await assert.rejects(() => run(rt, "start", "--component=nonesuch:x"), Refused);
  rt.ctx.writeSettings({ next: { strategy: "devcontainer" }, revision: null, by: "person" });
  await assert.rejects(() => run(rt, "start", "--component=node:web"), (e) => e instanceof Blocked && /validate the environment|design and adopt/.test(e.message));
});

test("the playbook's own record example is a candidate the engine accepts, and an unknown field is refused with what the kind may carry", async () => {
  const skill = readFileSync(join(ROOT, "skills", "orbit-runtime", "SKILL.md"), "utf8").replaceAll("\r\n", "\n");
  const example = /<<'JSON'\n(.+)\nJSON/.exec(skill)?.[1];
  assert.ok(example, "the playbook shows a record example");
  const rt = bound({ ...NODE_AND_DOTNET, "README.md": "# shop\nNeeds a message queue.\n" });
  await run(rt, "discover");
  rt.ctx.read = () => example;
  assert.equal((await run(rt, "record")).recorded, 1);
  rt.ctx.read = () => JSON.stringify({ ...JSON.parse(example), says: 1 });
  await assert.rejects(() => run(rt, "record"), (e) => /unknown field "says" \(a service fact may carry: .*service, image, port, name\)/.test(e.message) && !/source|confidence/.test(e.message.split("may carry:")[1] ?? ""));
});
