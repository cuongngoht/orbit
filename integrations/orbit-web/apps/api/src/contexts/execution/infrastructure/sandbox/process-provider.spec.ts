// THE DEVELOPMENT PROVIDER does what the container provider does with directories -- and says it is not isolated: no
// shell, ever; file tools held to the attempt's own places through links; the desk published under its version check,
// once per assignment; every removal read back.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type ResourceProfile } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../../../infra/process/node-process.js";
import type { AttemptHandle, AttemptSpec } from "../../application/sandbox.port.js";
import { AllocatorError, FILE_AREAS } from "./allocator-protocol.js";
import { ProcessSandboxProvider } from "./process-provider.js";

const O = "0f1e2d3c-0000-4000-8000-0000000000aa";
const ids = { orbitId: O, employeeId: "emp-1", sandboxId: "sbx-1" };

const spec = (over: Partial<AttemptSpec> = {}): AttemptSpec => ({
  ...ids,
  runId: "run-1",
  dispatchKey: "run-1:1",
  fence: 1,
  assignmentId: "asg-1",
  resources: (DEFAULT_PRESETS[0] as { profile: ResourceProfile }).profile,
  modelPlane: { cpuMillis: 500, memoryMiB: 1024, connectionHome: `${O}/conn-1`, env: {} },
  egress: { proxyHost: "127.0.0.1", proxyPort: 3128, runToken: "tok_abcdefgh" },
  bridge: { url: "http://127.0.0.1:3000/api/runtime/tools", runToken: "tok_abcdefgh" },
  inputs: [],
  teamRoom: null,
  ...over,
});

describe("the process provider (development only)", () => {
  let data: string;
  let provider: ProcessSandboxProvider;
  let handle: AttemptHandle;
  before(() => {
    data = mkdtempSync(join(tmpdir(), "process-provider-"));
    mkdirSync(join(data, "connections", O, "conn-1", "claude"), { recursive: true });
    provider = new ProcessSandboxProvider({ dataRoot: data, process: new NodeProcessPort() });
  });
  after(() => rmSync(data, { recursive: true, force: true }));

  test("its probe says what it is: no limit, measured storage, never a shell", async () => {
    const caps = await provider.probe();
    assert.deepEqual([caps.provider, caps.shellPossible, caps.limits.memory, caps.storage.perArea], ["process", false, "UNSUPPORTED", "SOFT_MONITORED"]);
  });

  test("a sandbox is READY with its desk and toolbox; a second provisioning finds it; another sandbox id is refused", async () => {
    const r = await provider.provisionEmployee(ids, { deskMiB: 256, cacheMiB: 64 });
    assert.equal(r.state, "READY");
    assert.deepEqual(r.areas.map((a) => [a.area, a.level]), [["desk", "SOFT_MONITORED"], ["cache", "SOFT_MONITORED"]]);
    assert.equal(existsSync(join(data, "workforce/accounts", O, "employees/emp-1/desk/files/toolbox/skills")), true);
    assert.equal((await provider.provisionEmployee(ids, { deskMiB: 256, cacheMiB: 64 })).state, "READY");
    assert.equal((await provider.provisionEmployee({ ...ids, sandboxId: "sbx-2" }, { deskMiB: 256, cacheMiB: 64 })).state, "FAILED");
  });

  test("an attempt: its places, the connection's own home, an empty working directory; the same key twice is one attempt", async () => {
    writeFileSync(join(data, "workforce/accounts", O, "employees/emp-1/desk/files/notes.md"), "from the desk\n");
    await provider.prepareWorkspace(ids, "asg-1", 256);
    handle = await provider.startAttempt(spec());
    assert.deepEqual(await provider.startAttempt(spec()), handle);
    assert.equal(handle.modelPlaneHome, join(data, "connections", O, "conn-1"));
    assert.equal(existsSync(handle.modelPlaneCwd), true);
    assert.match(handle.bridgeCommand.args[0] ?? "", /bridge\/main\.js$/);
    assert.equal((await provider.readFile(handle, "notes.md", 1000))?.toString(), "from the desk\n");
    await assert.rejects(provider.startAttempt(spec({ runId: "run-other" })), /another run/);
    await assert.rejects(provider.startAttempt(spec({ dispatchKey: "run-1:2", modelPlane: { cpuMillis: 500, memoryMiB: 1024, connectionHome: "other-account/conn-1", env: {} } })), /another account/);
  });

  test("no shell, and an attestation that says so", async () => {
    await assert.rejects(provider.exec(handle, { argv: ["ls"], timeoutMs: 1000, maxOutputBytes: 100 }), (e: unknown) => e instanceof AllocatorError && e.code === "shell_refused");
    const e = await provider.attest();
    assert.deepEqual([e.attestation.state, e.attestation.shell, e.applied, e.observed], ["not_isolated", false, null, null]);
  });

  test("file tools: binary-safe, inside /work, /output and /toolbox -- never through a link out, never above", async () => {
    await provider.writeFile(handle, "/toolbox/scripts/run.py", Buffer.from([0, 255, 10]));
    assert.deepEqual([...((await provider.readFile(handle, "toolbox/scripts/run.py", 10)) as Buffer)], [0, 255, 10]);
    await provider.writeFile(handle, "/output/report.md", Buffer.from("ok"));
    assert.deepEqual((await provider.list(handle, "/output", 10)).map((f) => [f.path, f.type, f.size]), [["report.md", "file", 2]]);
    assert.equal(await provider.readFile(handle, "missing.txt", 10), null);
    const work = join(data, "workforce/accounts", O, "employees/emp-1/assignments/asg-1/scratch/work");
    writeFileSync(join(data, "outside-secret"), "secret");
    symlinkSync(join(data, "outside-secret"), join(work, "escape"));
    symlinkSync(data, join(work, "updir"));
    await assert.rejects(provider.readFile(handle, "escape", 100), /out of the workspace/);
    await assert.rejects(provider.readFile(handle, "updir/outside-secret", 100), /out of the workspace/);
    await assert.rejects(provider.writeFile(handle, "updir/planted", Buffer.from("x")), /out of the workspace/);
    await assert.rejects(provider.writeFile(handle, "escape", Buffer.from("x")), /out of the workspace|a link/);
    await assert.rejects(provider.readFile(handle, "/etc/passwd", 100), /inside \/work/);
    await assert.rejects(provider.readFile(handle, "../../../../outside-secret", 100), /inside \/work/);
    await assert.rejects(provider.readFile(handle, "notes.md", 2), (e: unknown) => e instanceof AllocatorError && e.code === "file_too_large");
    rmSync(join(work, "escape"));
    rmSync(join(work, "updir"));
  });

  test("publish: refused on a stale desk version; once per assignment, its answer again on a retry", async () => {
    const stale = await provider.publishWorkspace(ids, "asg-1", 7);
    assert.deepEqual([stale.published, stale.deskVersion], [false, 0]);
    const first = await provider.publishWorkspace(ids, "asg-1", 0);
    assert.deepEqual([first.published, first.deskVersion], [true, 1]);
    assert.ok(first.changed.includes("toolbox/scripts/run.py"));
    assert.deepEqual(await provider.publishWorkspace(ids, "asg-1", 0), first, "a retry after a crash gets the same answer");
    assert.deepEqual(await provider.publishWorkspace(ids, "asg-1", 1), first);
    assert.equal(existsSync(join(data, "workforce/accounts", O, "employees/emp-1/desk/files/toolbox/scripts/run.py")), true);
    assert.equal((await provider.publishWorkspace(ids, "asg-2", 0)).published, false);
  });

  test("find after the provider is recreated; stop; remove and removeWorkspace verified -- and gone again when already gone", async () => {
    const again = new ProcessSandboxProvider({ dataRoot: data, process: new NodeProcessPort() });
    const found = await again.find("run-1:1");
    assert.deepEqual(found?.handle, handle);
    await again.stop(handle);
    assert.equal((await again.find("run-1:1"))?.toolPlaneRunning, false);
    assert.deepEqual((await again.remove(handle)).gone, true);
    assert.equal(await again.find("run-1:1"), null);
    assert.equal((await again.removeWorkspace(ids, "asg-1")).gone, true);
    assert.equal((await again.removeWorkspace(ids, "asg-1")).gone, true);
    assert.equal((await again.removeWorkspace(ids, "never-existed")).gone, true);
  });

  test("a person's look into the desk: one folder, the biggest first; a file's first bytes; never through a link", async () => {
    const desk = join(data, "workforce/accounts", O, "employees/emp-1/desk/files");
    mkdirSync(join(desk, "reports"), { recursive: true });
    writeFileSync(join(desk, "reports/q3.md"), `# Q3\n${"x".repeat(100)}`);
    writeFileSync(join(desk, ".orbit-canary-0123456789abcdef"), "a marker");
    symlinkSync(join(data, "connections"), join(desk, "out"));
    const top = await provider.listDesk(ids, "", 100);
    assert.deepEqual([top.deskVersion, top.entries[0]?.path], [1, "reports"]);
    assert.equal(top.entries.some((e) => e.name.startsWith(".orbit-canary-")), false);
    assert.equal(top.entries.find((e) => e.name === "out")?.type, "link");
    const file = await provider.readDesk(ids, "reports/q3.md", 4);
    assert.deepEqual([file.data.toString("utf8"), file.bytes, file.truncated, file.deskVersion], ["# Q3", 105, true, 1]);
    const code = (c: string) => (e: unknown) => e instanceof AllocatorError && e.code === c;
    await assert.rejects(provider.readDesk(ids, "out/x", 10), code("bad_request"));
    await assert.rejects(provider.readDesk(ids, "nowhere.md", 10), code("not_found"));
    await assert.rejects(provider.listDesk(ids, "../", 10), code("bad_request"));
    await assert.rejects(provider.listDesk({ ...ids, sandboxId: "sbx-other" }, "", 10), code("not_found"));
  });

  test("a clean: refused while a workspace of the employee exists or at another desk version; then it goes, the toolbox stays", async () => {
    const desk = join(data, "workforce/accounts", O, "employees/emp-1/desk/files");
    const conflict = (said: RegExp) => (e: unknown) => e instanceof AllocatorError && e.code === "conflict" && said.test(e.message);
    await provider.prepareWorkspace(ids, "asg-3", 64);
    await assert.rejects(provider.cleanDesk(ids, { remove: ["reports"], empty: false, cache: false }, 1), conflict(/workspace/));
    assert.equal(existsSync(join(desk, "reports/q3.md")), true);
    await provider.removeWorkspace(ids, "asg-3");
    await assert.rejects(provider.cleanDesk(ids, { remove: ["reports"], empty: false, cache: false }, 0), conflict(/version 1/));
    const r = await provider.cleanDesk(ids, { remove: [], empty: true, cache: false }, 1);
    assert.equal(r.deskVersion, 1, "a clean does not move the desk's version");
    assert.deepEqual(readdirSync(desk).sort(), [".orbit-canary-0123456789abcdef", "toolbox"]);
    assert.equal(existsSync(join(data, "connections", O)), true, "a link's target is never touched");
  });

  test("a publish of a big work tree keeps the desk's record small, so the employee's next work tree is still made", async () => {
    await provider.prepareWorkspace(ids, "asg-4", 64);
    const work = join(data, "workforce/accounts", O, "employees/emp-1/assignments/asg-4/scratch/work");
    mkdirSync(join(work, "many"), { recursive: true });
    for (let i = 0; i < 650; i += 1) writeFileSync(join(work, "many", `f${i}.txt`), "x");
    const r = await provider.publishWorkspace(ids, "asg-4", 1);
    assert.deepEqual([r.published, r.deskVersion, r.changed.length, r.changedTotal], [true, 2, 500, 651]);
    const record = statSync(join(data, "workforce/accounts", O, "employees/emp-1/desk/version")).size;
    assert.ok(record < 64 * 1024, `the desk's version record is ${record} bytes`);
    assert.deepEqual(await provider.publishWorkspace(ids, "asg-4", 1), r, "a retry after a crash gets the same answer, its count too");
    assert.equal((await provider.removeWorkspace(ids, "asg-4")).gone, true);
    await provider.prepareWorkspace(ids, "asg-5", 64);
    assert.equal((await provider.removeWorkspace(ids, "asg-5")).gone, true);
  });
});

describe("what an attempt was handed, in /input", () => {
  let data: string;
  let provider: ProcessSandboxProvider;
  let handle: AttemptHandle;
  // A part's hand-in written in Vietnamese: what its lead reads back to review it, byte for byte.
  const HANDIN = Buffer.from("# Kế hoạch tuyển dụng\n\n- Mô tả công việc: trưởng phòng FX.\n", "utf8");
  before(async () => {
    data = mkdtempSync(join(tmpdir(), "process-provider-input-"));
    mkdirSync(join(data, "connections", O, "conn-1", "claude"), { recursive: true });
    provider = new ProcessSandboxProvider({ dataRoot: data, process: new NodeProcessPort(), readInput: async () => HANDIN });
    await provider.provisionEmployee(ids, { deskMiB: 256, cacheMiB: 64 });
    await provider.prepareWorkspace(ids, "asg-1", 256);
    handle = await provider.startAttempt(spec({ inputs: [{ name: "unit-a-plan.md", storePath: "store/handin" }] }));
  });
  after(() => rmSync(data, { recursive: true, force: true }));

  test("read and listed with the file tools, as it was handed in", async () => {
    assert.deepEqual(await provider.readFile(handle, "/input/unit-a-plan.md", 1_000_000), HANDIN);
    assert.deepEqual((await provider.list(handle, "/input", 10)).map((f) => [f.path, f.type, f.size]), [["unit-a-plan.md", "file", HANDIN.length]]);
  });

  test("never written: refused, saying why, and nothing is made there", async () => {
    await assert.rejects(provider.writeFile(handle, "/input/unit-a-plan.md", Buffer.from("x")), /\/input is read-only/);
    await assert.rejects(provider.writeFile(handle, "/input/new.md", Buffer.from("x")), /\/input is read-only/);
    assert.deepEqual(readdirSync(join(data, "workforce/accounts", O, "employees/emp-1/assignments/asg-1/scratch/input")), ["unit-a-plan.md"]);
  });

  test("every declared area is a place of the attempt (one with no team room has no /team)", async () => {
    for (const a of FILE_AREAS) {
      if (a.root === "/team") await assert.rejects(provider.list(handle, a.root, 10), /\/team is not part of this attempt/);
      else assert.ok(Array.isArray(await provider.list(handle, a.root, 10)), a.root);
    }
  });
});
