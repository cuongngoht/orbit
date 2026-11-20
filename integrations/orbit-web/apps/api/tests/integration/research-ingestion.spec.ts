// WHAT RESEARCH STORES, AND WHAT IT REFUSES: a file is what its bytes say it is, within its bound, under a name the
// server makes; a document that cannot be read fails with why (and can be tried again); a URL is fetched by the server
// as a snapshot -- only on the public internet's web ports, never this machine, the cloud's metadata address or a private
// range --, kept as an immutable revision, and fetched again into a new revision only when it changed.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { MUTATION_HEADER, type ResearchSourceContent, type ResearchSourceRevision, type ResearchSourceSummary, type ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { URL_ADDRESS_POLICY, type AddressPolicy } from "../../src/modules/research/ingestion/url-fetcher.js";
import { startHarness, type Harness } from "../../src/testing/harness.js";
import { errorCode, newWorkspace, settledSource, upload, uploaded } from "../../src/testing/research-client.js";
import { makeDocx, makeDocxBomb, makePdf, makeTextlessPdf } from "../../src/testing/research-fixtures.js";

const sourcesOf = async (h: Harness, workspaceId: string) => (await h.get(`/api/research/workspaces/${workspaceId}/sources`)).body as ResearchSourceSummary[];

describe("an upload is what its bytes say, within its bound, under a name the server makes", () => {
  let h: Harness;
  let workspace: ResearchWorkspaceSummary;
  before(async () => {
    h = await startHarness({ env: { ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB: "1" } });
    workspace = await newWorkspace(h);
  });
  after(() => h.close());

  test("a kind of file research does not read, or one that is not what its name says, is refused -- and nothing is stored", async () => {
    const exe = await upload(h, workspace.id, "setup.exe", Buffer.from("MZ\u0090\u0000binary"));
    assert.deepEqual([exe.status, errorCode(exe)], [415, "unsupported_source"]);
    assert.equal((await upload(h, workspace.id, "report.pdf", Buffer.from("not a pdf at all"))).status, 415);
    assert.equal((await upload(h, workspace.id, "notes.txt", Buffer.from([0x00, 0xff, 0x00]))).status, 415);
    assert.equal((await upload(h, workspace.id, "empty.txt", Buffer.alloc(0))).status, 400);
    assert.deepEqual(await sourcesOf(h, workspace.id), []);
    assert.deepEqual(readdirSync(h.config.data.research).filter((n) => n !== "tmp"), [], "no file was kept");
  });

  test("a file over the bound is refused (413) before it is stored", async () => {
    const big = await upload(h, workspace.id, "big.txt", Buffer.alloc(1_100_000, 0x61));
    assert.equal(big.status, 413);
    assert.deepEqual(await sourcesOf(h, workspace.id), []);
  });

  test("a name is shown, never used as a path: the file is kept under its content's hash, inside the research store", async () => {
    const made = await uploaded(h, workspace.id, "../../../../etc/evil.md", Buffer.from("# Evil\n\nJust text."));
    assert.deepEqual([made.title, made.origin], ["evil", "evil.md"]);
    const ready = await settledSource(h, made.id);
    const hash = ready.revision?.contentHash as string;
    assert.equal(existsSync(join(h.config.data.research, "workspaces", workspace.id, "objects", hash.slice(0, 2), hash)), true);
    assert.equal(existsSync(join(h.config.data.root, "etc")), false);
    assert.equal((await upload(h, workspace.id, "bad\u0007name.txt", Buffer.from("x"))).status, 400);
    const unnamed = await fetch(`${h.url}/api/research/workspaces/${workspace.id}/sources/upload`, { method: "POST", headers: { [MUTATION_HEADER]: "1", "content-type": "application/octet-stream" }, body: "text" });
    assert.equal(unnamed.status, 400, "the file must be named");
  });

  test("the one non-JSON body is that route's alone, and still needs the header and this origin", async () => {
    const headers = { "content-type": "application/octet-stream", "x-orbit-filename": "a.txt" };
    assert.equal((await fetch(`${h.url}/api/research/workspaces/${workspace.id}/sources/upload`, { method: "POST", headers, body: "x" })).status, 403, "no X-Orbit-Web header");
    assert.equal((await fetch(`${h.url}/api/research/workspaces/${workspace.id}/sources/upload`, { method: "POST", headers: { ...headers, [MUTATION_HEADER]: "1", origin: "https://attacker.example" }, body: "x" })).status, 403);
    assert.equal((await fetch(`${h.url}/api/research/workspaces/${workspace.id}/sources/text`, { method: "POST", headers: { ...headers, [MUTATION_HEADER]: "1" }, body: "x" })).status, 415, "anywhere else, a body is JSON");
    assert.equal((await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { ...headers, [MUTATION_HEADER]: "1" }, body: "x" })).status, 415);
    const json = await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/upload`, { file: "x" });
    assert.equal(json.status, 415, "a file is never a JSON or form body");
  });

  test("a document that cannot be read fails with why: a broken PDF, a scanned one, a broken or exploding Word file", async () => {
    const cases: [string, Buffer, RegExp][] = [
      ["broken.pdf", Buffer.from("%PDF-1.4\nthis is not a real pdf"), /could not be read/],
      ["scan.pdf", makeTextlessPdf(), /no selectable text.*OCR is not supported/s],
      ["broken.docx", Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(64)]), /ZIP|central directory|damaged/],
      ["bomb.docx", makeDocxBomb(), /expands to more than research reads/],
    ];
    for (const [name, bytes, why] of cases) {
      const failed = await settledSource(h, (await uploaded(h, workspace.id, name, bytes)).id);
      assert.equal(failed.state, "failed", name);
      assert.match(failed.stateReason ?? "", why, name);
      assert.equal(failed.revision, null, `${name}: nothing to search`);
    }
  });
});

describe("a URL is fetched by the server as a snapshot, and fetched again into a new revision only when it changed", () => {
  let h: Harness;
  let server: Server;
  let base: string;
  let workspace: ResearchWorkspaceSummary;
  const pages: Record<string, { status: number; type: string; body: string }> = {};
  before(async () => {
    server = createServer((req, res) => {
      const page = pages[req.url ?? ""] ?? { status: 404, type: "text/plain", body: "missing" };
      res.writeHead(page.status, { "content-type": page.type }).end(page.body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
    // This test's own server on this machine: what Orbit Web's own policy never allows, allowed here alone.
    const local: AddressPolicy = { allows: (address, p) => address === "127.0.0.1" && p === port };
    h = await startHarness({ overrides: [[URL_ADDRESS_POLICY, local]] });
    workspace = await newWorkspace(h);
  });
  after(async () => {
    await h.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  test("a page's readable text is kept as revision 1, with where and when it was fetched", async () => {
    pages["/guide.html"] = { status: 200, type: "text/html; charset=utf-8", body: "<html><head><title>Guide</title><script>evil()</script></head><body><main><h1>Agents</h1><p>Agents use version one.</p></main></body></html>" };
    const made = await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/url`, { url: `${base}/guide.html` });
    assert.equal(made.status, 202);
    const ready = await settledSource(h, (made.body as ResearchSourceSummary).id);
    assert.deepEqual([ready.state, ready.kind, ready.mediaType, ready.revision?.number], ["ready", "url", "html", 1]);
    assert.ok(ready.revision?.fetchedAt);
    const content = (await h.get(`/api/research/sources/${ready.id}/content`)).body as ResearchSourceContent;
    assert.match(content.chunks.map((c) => c.text).join("\n"), /Agents use version one\./);
    assert.doesNotMatch(JSON.stringify(content), /evil/);
  });

  test("a changed page becomes revision 2; the earlier one stays readable; an unchanged one adds nothing", async () => {
    const source = (await sourcesOf(h, workspace.id)).find((s) => s.kind === "url") as ResearchSourceSummary;
    const first = source.revision?.id as string;
    pages["/guide.html"] = { status: 200, type: "text/html", body: "<main><p>Agents use version two.</p></main>" };
    assert.equal((await h.send("POST", `/api/research/sources/${source.id}/refresh`)).status, 202);
    const refreshed = await settledSource(h, source.id);
    assert.deepEqual([refreshed.state, refreshed.revision?.number], ["ready", 2]);
    const old = (await h.get(`/api/research/sources/${source.id}/content?revision=${first}`)).body as ResearchSourceContent;
    assert.deepEqual([old.revisionNumber, old.current], [1, false]);
    assert.match(old.chunks[0]?.text ?? "", /version one/, "a revision is immutable: it reads as it was");
    assert.equal((await h.send("POST", `/api/research/sources/${source.id}/refresh`)).status, 202);
    await settledSource(h, source.id);
    const revisions = (await h.get(`/api/research/sources/${source.id}/revisions`)).body as ResearchSourceRevision[];
    assert.deepEqual(revisions.map((r) => [r.number, r.current]), [[2, true], [1, false]], "the same bytes again: no new revision");
    assert.notEqual(revisions[0]?.contentHash, revisions[1]?.contentHash);
  });

  test("a page that cannot be fetched again leaves the source stale: the snapshot it had is still used, as of its date", async () => {
    const source = (await sourcesOf(h, workspace.id)).find((s) => s.kind === "url") as ResearchSourceSummary;
    pages["/guide.html"] = { status: 500, type: "text/plain", body: "down" };
    await h.send("POST", `/api/research/sources/${source.id}/refresh`);
    const stale = await settledSource(h, source.id);
    assert.equal(stale.state, "stale");
    assert.match(stale.stateReason ?? "", /HTTP 500.*still used/s);
    assert.equal(stale.revision?.number, 2);
  });

  test("a URL that fails is said to; once it answers, trying again makes it ready -- from the start, nothing doubled", async () => {
    pages["/later.html"] = { status: 503, type: "text/plain", body: "busy" };
    const made = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/url`, { url: `${base}/later.html` })).body as ResearchSourceSummary;
    const failed = await settledSource(h, made.id);
    assert.deepEqual([failed.state, failed.stateReason], ["failed", "The page answered HTTP 503."]);
    pages["/later.html"] = { status: 200, type: "text/markdown", body: "# Later\n\nIt answers now." };
    assert.equal((await h.send("POST", `/api/research/sources/${made.id}/retry`)).status, 202);
    const ready = await settledSource(h, made.id);
    assert.deepEqual([ready.state, ready.mediaType, ready.revision?.chunks], ["ready", "markdown", 1]);
    assert.equal((await h.send("POST", `/api/research/sources/${made.id}/retry`)).status, 409, "only a failed source is tried again");
    pages["/missing"] = { status: 404, type: "text/plain", body: "" };
    const missing = await settledSource(h, ((await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/url`, { url: `${base}/missing` })).body as ResearchSourceSummary).id);
    assert.equal(missing.stateReason, "The page answered HTTP 404.");
  });

  test("a revision of another source, or an id that is no revision, is not found", async () => {
    const [a, b] = (await sourcesOf(h, workspace.id)).filter((s) => s.revision !== null);
    assert.equal((await h.get(`/api/research/sources/${a?.id}/content?revision=${b?.revision?.id}`)).status, 404);
    assert.equal((await h.get(`/api/research/sources/${a?.id}/content?revision=..%2F..%2Fapp`)).status, 404);
    assert.equal((await h.get("/api/research/sources/00000000-0000-4000-8000-000000000000/content")).status, 404);
  });
});

describe("the server never fetches this machine, the cloud's metadata address or a private network", () => {
  let h: Harness;
  let workspace: ResearchWorkspaceSummary;
  before(async () => {
    h = await startHarness();
    workspace = await newWorkspace(h);
  });
  after(() => h.close());

  test("every such URL fails with why, and nothing of it is stored", async () => {
    for (const url of ["http://127.0.0.1:3000/api/settings", "http://localhost/", "http://169.254.169.254/latest/meta-data/iam/", "http://10.0.0.1/", "http://192.168.1.1/admin", "http://[::1]/", "http://0.0.0.0/", "https://example.com:8443/"]) {
      const made = await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/url`, { url });
      assert.equal(made.status, 202, url);
      const failed = await settledSource(h, (made.body as ResearchSourceSummary).id);
      assert.equal(failed.state, "failed", url);
      assert.match(failed.stateReason ?? "", /never fetches it|does not resolve|could not be reached/, url);
    }
    assert.equal((await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/url`, { url: "http://user:pass@example.com/" })).status, 400, "a URL with credentials is refused outright");
    assert.equal((await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/url`, { url: "file:///etc/passwd" })).status, 400);
    assert.equal((await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/url`, { url: "javascript:alert(1)" })).status, 400);
    assert.deepEqual(readdirSync(join(h.config.data.research)).filter((n) => n === "workspaces"), [], "nothing was stored");
  });

  test("an installation that switched URL import off refuses it outright", async () => {
    const off = await startHarness({ env: { ORBIT_WEB_RESEARCH_URL_IMPORT: "off" } });
    try {
      const w = await newWorkspace(off);
      const r = await off.send("POST", `/api/research/workspaces/${w.id}/sources/url`, { url: "https://example.com/" });
      assert.deepEqual([r.status, errorCode(r)], [403, "url_import_off"]);
    } finally {
      await off.close();
    }
  });
});

describe("a source removed takes its file with it, and a workspace removed takes everything", () => {
  test("its file is removed once no revision of the workspace stores those bytes", async () => {
    const h = await startHarness();
    try {
      const w = await newWorkspace(h);
      const docx = await settledSource(h, (await uploaded(h, w.id, "brief.docx", makeDocx([{ text: "Brief", style: "Heading1" }, { text: "Body text." }]))).id);
      const pdf = await settledSource(h, (await uploaded(h, w.id, "two.pdf", makePdf(["One.", "Two."]))).id);
      assert.deepEqual([docx.state, pdf.state], ["ready", "ready"]);
      const hash = docx.revision?.contentHash as string;
      const file = join(h.config.data.research, "workspaces", w.id, "objects", hash.slice(0, 2), hash);
      assert.equal(existsSync(file), true);
      assert.equal((await h.send("DELETE", `/api/research/sources/${docx.id}`)).status, 204);
      assert.equal(existsSync(file), false);
      assert.equal((await h.get(`/api/research/sources/${docx.id}`)).status, 404);
      assert.deepEqual((await sourcesOf(h, w.id)).map((s) => s.id), [pdf.id]);
      const reasked = await h.send("DELETE", `/api/research/workspaces/${w.id}`, { confirmName: "not it" });
      assert.equal(reasked.status, 400, "the name is typed back to delete a workspace");
      assert.equal((await h.send("DELETE", `/api/research/workspaces/${w.id}`, { confirmName: "AI Governance Research" })).status, 204);
      assert.equal(existsSync(join(h.config.data.research, "workspaces", w.id)), false, "its files went with it");
      assert.equal((await h.get(`/api/research/sources/${pdf.id}`)).status, 404);
    } finally {
      await h.close();
    }
  });
});
