// A chat's WORKING BRANCH moves only when a person moves it: to another branch of its repository (fetched for it through
// the source's own sign-in, into a clone of Orbit Web's own, then into the workspace), to another branch of the
// workspace, or to a new branch made from the work as it is. Never to the repository's default branch, never over
// uncommitted work, never while Claude works; and the changes are then read against where the branch left the one the
// chat started from.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ChangesReport, SessionDetail, SessionSummary, WorkBranches } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type Call } from "../../src/testing/fake-process.js";
import { claudeRun, eventually, fixtureClone, REPOSITORY, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd, encoding: "utf8" });

const after1 = (args: string[], flag: string): string => args[args.indexOf(flag) + 1] as string;

// The first clone, as gh leaves it: the branch checked out, and the repository's view of it (refs/remotes/origin/main).
function firstClone(call: Call) {
  const answer = fixtureClone(call);
  git(join(call.cwd, call.args[3] as string), "update-ref", "refs/remotes/origin/main", "HEAD");
  return answer;
}

// The repository on GitHub, as far as a branch fetch sees it: the workspace's history, and `dev` one commit past main.
function branchClone(call: Call) {
  const destination = join(call.cwd, call.args[3] as string);
  const reference = after1(call.args, "--reference-if-able");
  const branch = after1(call.args, "--branch");
  const work = mkdtempSync(join(tmpdir(), "ow-dev-"));
  git(work, "clone", "-q", reference, ".");
  git(work, "switch", "-q", "-c", "dev", "refs/remotes/origin/main");
  writeFileSync(join(work, "dev.txt"), "made on dev\n");
  git(work, "add", "dev.txt");
  git(work, "commit", "-qm", "dev work");
  git(call.cwd, "clone", "-q", "--bare", "--single-branch", "--branch", branch, work, destination);
  rmSync(work, { recursive: true, force: true });
  return { code: 0 };
}

const isBranchClone = (file: string, args: string[]) => program("gh", "repo", "clone")(file, args) && args.includes("--bare");

describe("the working branch of a chat", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let session: SessionSummary;
  let ws: string;
  let start: string;
  const branches = async () => (await h.get(`/api/sessions/${session.id}/branches`)).body as WorkBranches;
  const move = (body: unknown) => h.send("POST", `/api/sessions/${session.id}/branch`, body);
  const head = () => git(ws, "symbolic-ref", "--short", "HEAD").stdout.trim();

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(program("gh", "repo", "clone"), { run: firstClone }).on(isBranchClone, { run: branchClone });
    h = await startHarness({ fake });
    session = (await h.send("POST", "/api/sessions", { repository: { source: "github", id: REPOSITORY }, branch: "main", model: "sonnet" })).body as SessionSummary;
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "ready");
    ws = join(h.config.data.workspaces, session.id, "repository");
    start = ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).baseCommit as string;
  });
  after(() => h.close());

  test("lists the chat's own branch, the workspace's and the repository's -- the default one said as such", async () => {
    const list = await branches();
    assert.equal(list.current, session.workBranch ?? `orbit-web/${session.id.slice(0, 8)}`);
    assert.equal(list.base, "main");
    assert.equal(list.remoteError, null);
    const by = Object.fromEntries(list.branches.map((b) => [b.name, b]));
    assert.deepEqual(by.main, { name: "main", local: true, remote: true, isDefault: true });
    assert.deepEqual(by.dev, { name: "dev", local: false, remote: true, isDefault: false });
    assert.equal(by[list.current as string]?.local, true);
  });

  test("never the repository's default branch, never a branch nobody has, never over uncommitted work", async () => {
    const own = head();
    assert.equal((await move({ branch: "main" })).status, 409);
    assert.equal((await move({ branch: "nowhere" })).status, 404);
    assert.equal((await move({ branch: "-x" })).status, 400);
    writeFileSync(join(ws, "draft.md"), "not committed\n");
    const dirty = await move({ branch: "dev" });
    assert.equal(dirty.status, 409);
    assert.match(JSON.stringify(dirty.body), /uncommitted/);
    rmSync(join(ws, "draft.md"));
    assert.equal(head(), own, "nothing moved");
  });

  test("a branch of the repository is fetched through the source's sign-in into a clone of Orbit Web's own, then worked on", async () => {
    const from = head();
    const r = await move({ branch: "dev" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((r.body as SessionSummary).workBranch, "dev");
    assert.equal((r.body as SessionSummary).branch, "main", "the chat still compares against the branch it started from");
    assert.equal(head(), "dev");
    assert.equal(readFileSync(join(ws, "dev.txt"), "utf8"), "made on dev\n");
    const call = fake.callsOf(isBranchClone)[0] as Call;
    assert.ok(call.args.includes("--single-branch") && after1(call.args, "--branch") === "dev" && after1(call.args, "--reference-if-able") === ws);
    assert.ok(!call.cwd.startsWith(ws), "never inside the workspace");
    assert.equal(existsSync(join(call.cwd, call.args[3] as string)), false, "the clone of Orbit Web's own is removed");
    const detail = (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail;
    assert.equal(detail.baseCommit, start, "read against where dev left main");
    const changes = (await h.get(`/api/sessions/${session.id}/changes`)).body as ChangesReport;
    assert.deepEqual(changes.files.map((f) => f.path), ["dev.txt"]);
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "workspace.branch") });
    assert.deepEqual((events.find((e) => e.type === "workspace.branch") as { data: unknown }).data, { from, workBranch: "dev", created: false, baseCommit: start });
    assert.equal((await branches()).current, "dev");
    assert.equal((await move({ branch: from })).status, 200, "back to the chat's own branch, which the workspace keeps");
    assert.equal(head(), from);
  });

  test("a new branch is made from the work as it is: what is uncommitted comes along, and the changes stay read as before", async () => {
    writeFileSync(join(ws, "notes.md"), "work in progress\n");
    const r = await move({ branch: "docs/approvers", create: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(head(), "docs/approvers");
    assert.equal(readFileSync(join(ws, "notes.md"), "utf8"), "work in progress\n");
    assert.equal(((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).baseCommit, start);
    assert.equal((await move({ branch: "dev", create: true })).status, 409, "a branch the repository has is switched to, not made again");
    assert.equal((await move({ branch: "main", create: true })).status, 409);
  });

  test("no run starts while the branch moves, and one move at a time", async () => {
    let release: () => void = () => undefined;
    fake.on(isBranchClone, { run: (call) => new Promise((done) => (release = () => done(branchClone(call)))) });
    git(ws, "stash", "-u", "-q");
    git(ws, "branch", "-q", "-D", "dev");
    const moving = move({ branch: "dev" });
    await eventually(() => fake.callsOf(isBranchClone).length, (n) => n === 2);
    const message = await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Hello." });
    assert.equal(message.status, 409);
    assert.match(JSON.stringify(message.body), /workspace_busy/);
    assert.equal((await move({ branch: "docs/approvers" })).status, 409, "one change at a time");
    release();
    assert.equal((await moving).status, 200);
  });

  test("the branch never moves while Claude works", async () => {
    fake.on(claudeRun, {
      spawn: (c, call) => {
        c.onInputClosed(() => c.line({ type: "system", subtype: "init", cwd: call.cwd, session_id: after1(call.args, "--session-id"), claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] }));
        c.onSignal(() => c.exit(130, "SIGINT"));
      },
    });
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Work on it." })).status, 202);
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "running");
    const r = await move({ branch: "docs/approvers" });
    assert.equal(r.status, 409);
    assert.match(JSON.stringify(r.body), /run_active/);
    assert.equal(head(), "dev");
    await h.send("POST", `/api/sessions/${session.id}/stop`);
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s !== "running");
  });
});
