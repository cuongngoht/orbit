import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppConfig } from "../../../config/config.js";
import type { Db } from "../../../infra/db/db.js";
import type { ArtifactStore } from "../infrastructure/artifact-store.js";
import { matchBriefExcerpt, ResearchInputs } from "./research-inputs.js";

describe("ResearchInputs claim verification against pinned sources vs mission brief (Issue #6)", () => {
  const fakeConfig = { data: { research: "/tmp/unused-research" } } as unknown as AppConfig;
  const fakeArtifacts = {} as unknown as ArtifactStore;

  const makeInputs = (chunksByRevision: Record<string, { ordinal: number; page: number | null; text: string }[]>) => {
    const fakeDb = {
      query: async (_sql: string, params: unknown[]) => {
        const revId = String(params[1] ?? "");
        return (chunksByRevision[revId] ?? []).map((c) => ({ ordinal: c.ordinal, page: c.page, char_start: 0, text: c.text }));
      },
    } as unknown as Db;
    return new ResearchInputs(fakeConfig, fakeDb, fakeArtifacts);
  };

  test("distinguishes pinned-source verified claims, brief-attributed claims, web refs, and unverified external claims", async () => {
    const inputs = makeInputs({
      "rev-1": [{ ordinal: 0, page: 2, text: "Annual audited revenue reached 2,400,000 USD in FY2026." }],
    });
    const pinnedSources = [
      { label: "S1", sourceId: "src-1", revisionId: "rev-1", workspaceId: "ws-1", contentHash: "a".repeat(64), title: "Annual Report", mediaType: "text/plain", fileName: "report.txt", origin: "mission" as const, ref: null },
    ];
    const briefText = "Prepare a summary for Acme Corp. The mission brief states: Pilot launch target is 15 December 2026 with 12 beta customers.";

    const verified = await inputs.verify(
      "acct-1",
      pinnedSources,
      [
        {
          text: "FY2026 revenue was 2,400,000 USD.",
          sources: ["S1"],
          quote: "Annual audited revenue reached 2,400,000 USD",
          url: null,
          basis: "source",
        },
        {
          text: "Pilot launch target is 15 December 2026 with 12 beta customers.",
          sources: [],
          quote: "Pilot launch target is 15 December 2026 with 12 beta customers",
          url: null,
          basis: null,
        },
        {
          text: "Competitor pricing rose 18% last quarter.",
          sources: [],
          quote: "Competitor pricing rose 18% last quarter.",
          url: null,
          basis: "brief",
        },
        {
          text: "Public status page reports 99.95% uptime.",
          sources: [],
          quote: null,
          url: "https://status.example.com/uptime",
          basis: "web",
        },
        {
          text: "Unverified external market share estimate is 42%.",
          sources: [],
          quote: null,
          url: null,
          basis: "external",
        },
      ],
      briefText,
    );

    assert.equal(verified.length, 5);

    // 1. Pinned research source match -> supported: true, basis: "pinned_source"
    assert.equal(verified[0]?.supported, true);
    assert.equal(verified[0]?.basis, "pinned_source");
    assert.equal(verified[0]?.sources.length, 1);
    assert.equal(verified[0]?.sources[0]?.label, "S1");

    // 2. Verbatim quote from mission brief -> basis: "brief", supported MUST stay false (no unearned source-verification badge!)
    assert.equal(verified[1]?.supported, false);
    assert.equal(verified[1]?.basis, "brief");
    assert.equal(verified[1]?.sources.length, 0);
    assert.match(verified[1]?.briefExcerpt ?? "", /Pilot launch target is 15 December 2026/);

    // 3. Fabricated basis: "brief" claim whose text is NOT in the brief -> rejected down to "external", supported: false
    assert.equal(verified[2]?.supported, false);
    assert.equal(verified[2]?.basis, "external");
    assert.equal(verified[2]?.briefExcerpt, undefined);

    // 4. Web URL claim -> basis: "web", supported: false
    assert.equal(verified[3]?.supported, false);
    assert.equal(verified[3]?.basis, "web");
    assert.equal(verified[3]?.web?.url, "https://status.example.com/uptime");

    // 5. External factual claim without pinned source -> basis: "external", supported: false
    assert.equal(verified[4]?.supported, false);
    assert.equal(verified[4]?.basis, "external");
  });

  test("with no pinned sources, brief context is still separated from external factual claims and neither is marked supported", async () => {
    const inputs = makeInputs({});
    const briefText = "Synthetic scenario: Contoso operates 4 regional warehouses in Southeast Asia.";
    const verified = await inputs.verify(
      "acct-1",
      [],
      [
        { text: "Contoso operates 4 regional warehouses in Southeast Asia.", sources: [], quote: null, url: null },
        { text: "Industry average shipping cost dropped 9% in 2026.", sources: [], quote: null, url: null },
      ],
      briefText,
    );
    assert.equal(verified[0]?.supported, false);
    assert.equal(verified[0]?.basis, "brief");
    assert.equal(verified[1]?.supported, false);
    assert.equal(verified[1]?.basis, "external");
  });

  test("matchBriefExcerpt enforces minimum quote length and exact normalized substring matching", () => {
    assert.equal(matchBriefExcerpt("short", "short", null, true, true), null);
    assert.equal(matchBriefExcerpt("the target budget for phase two is 450,000 usd.", "Target budget for phase two is 450,000 USD", null, false, true), "Target budget for phase two is 450,000 USD");
    assert.equal(matchBriefExcerpt("the target budget for phase two is 450,000 usd.", "Unrelated claim text here", null, true, true), null);
  });
});
