// The standard renderer: one self-contained, offline page -- vendored assets as
// pinned, every string escaped, nothing loadable from a network, and nothing of
// a switched-off section in the page at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_ROOT, renderAssets, standardSections, vendorManifest } from "../skills/orbit-report/pack.mjs";
import { payloadOf, renderReport, safeJson } from "../skills/orbit-report/render.mjs";
import { githubSnapshot } from "./project-report/snapshots.mjs";

const input = (over = {}) => ({ project: { name: "portal <b>", key: "repo-x" }, snapshot: githubSnapshot(), model: { contract: "orbit.report.model/v1", contributors: [{ login: "lan-nguyen", merged: 3 }], kpis: {}, periods: [], sections: {} }, metrics: [], forecast: null, sections: standardSections(), sectionsEnabled: {}, parts: [], runId: "20260925T030000Z-0001", render: 1, engine: "1.6.0", kit: "1.0.0", generatedAt: "2026-09-25T04:00:00Z", ...over });

test("every vendored file is byte-for-byte what VENDOR.json pins (a CRLF checkout would break this, hence -text)", () => {
  for (const f of vendorManifest().files) {
    const bytes = readFileSync(join(PACK_ROOT, "assets", "vendor", f.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, f.file);
  }
  const chart = readFileSync(join(PACK_ROOT, "assets", "vendor", "chart.umd.min.js"), "utf8");
  assert.ok(!chart.includes("</script") && !chart.includes("<!--"), "safe to inline in a <script>");
});

test("the page loads nothing: a CSP forbids it, and no src/href/url() points anywhere", () => {
  const html = renderReport(input(), renderAssets());
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(html, /<(script|link|img|iframe)[^>]+(src|href)=["']?https?:/i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /sourceMappingURL/);
  assert.match(html, /@font-face\{font-family:"IBM Plex Sans";font-style:normal;font-weight:400/);
});

test("data from a source cannot close its script block or become markup", () => {
  const model = { contract: "orbit.report.model/v1", kpis: {}, periods: [], sections: {}, prTable: [{ number: 94, title: "<script>alert('pwned')</script> & <b>bold</b>", url: "javascript:alert(1)" }] };
  const html = renderReport(input({ model }), renderAssets());
  const block = html.slice(html.indexOf('<script id="report-data"'), html.indexOf("</script>", html.indexOf('<script id="report-data"')));
  assert.ok(!block.includes("<script>alert"), "a PR title holding a script tag stays text");
  assert.ok(block.includes("\\u003cscript\\u003ealert"));
  assert.equal(JSON.parse(safeJson({ t: "</script><!--  " })).t, "</script><!--  ");
  assert.match(html, /<title>portal &lt;b&gt;/);
});

test("a section switched off is not in the page -- not hidden, absent", () => {
  const html = renderReport(input(), renderAssets());
  assert.ok(!html.includes("lan-nguyen\",\"merged\""), "contributors are off by default, so their rows are not embedded");
  const on = payloadOf(input({ sectionsEnabled: { "orbit.report.section.contributors": true } }));
  assert.equal(on.model.contributors.length, 1);
  const off = payloadOf(input({ sectionsEnabled: { "orbit.report.section.coverage": false } }));
  assert.equal(off.sections.find((s) => s.id === "orbit.report.section.coverage").enabled, true, "coverage cannot be switched off");
});

test("links are allowed only to the hosts the report's own records came from", () => {
  const meta = payloadOf(input()).meta;
  assert.deepEqual(meta.linkHosts.sort(), ["example.test", "github.com"]);
});

test("an extension section goes where it asked, else before coverage, marked as an extension", () => {
  const ext = { id: "demo.aging.section", title: "Open PR aging", placement: "after:orbit.report.section.backlog", part: "demo.aging", version: "0.1.0", source: "store", status: "ok", blocks: [] };
  const ids = payloadOf(input({ extensions: [ext, { ...ext, id: "demo.other", placement: undefined }] })).sections.map((s) => s.id);
  assert.equal(ids[ids.indexOf("orbit.report.section.backlog") + 1], "demo.aging.section");
  assert.equal(ids[ids.indexOf("orbit.report.section.coverage") - 1], "demo.other");
});
