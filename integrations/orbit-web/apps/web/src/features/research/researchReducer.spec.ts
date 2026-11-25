import type { AnyResearchEvent } from "@orbit-web/contracts";
import { describe, expect, test } from "vitest";
import { INITIAL, researchReducer } from "./researchReducer";

let n = 0;
const event = (type: string, data: unknown, seq: number | null): AnyResearchEvent => ({ id: `e${++n}`, type, stream: "research", sessionId: "s", seq, runId: "r1", at: "2026-11-20T00:00:00Z", data }) as AnyResearchEvent;

describe("a research session's stream, folded", () => {
  test("a durable event counts once, by its number: a replay after a reconnect changes nothing", () => {
    const events = [
      event("research.message.completed", { messageId: "q", role: "user", text: "Why?", partial: false, truncated: false }, 1),
      event("research.status", { status: "running", reason: null }, 2),
      event("research.run.started", { model: "sonnet", effort: "medium", sources: [{ sourceId: "a", revisionId: "r", title: "A" }], passages: 3, matched: 2 }, 3),
    ];
    const once = events.reduce(researchReducer, INITIAL);
    const twice = [...events, ...events].reduce(researchReducer, INITIAL);
    expect(twice).toEqual(once);
    expect(once.messages.map((m) => m.text)).toEqual(["Why?"]);
    expect([once.status, once.run?.passages, once.lastSeq]).toEqual(["running", 3, 3]);
  });

  test("an answer grows by offset; a piece sent twice is not doubled; the completed text replaces it", () => {
    let s = researchReducer(INITIAL, event("research.message.started", { messageId: "a", role: "assistant" }, 1));
    for (const d of [{ offset: 0, text: "Agents " }, { offset: 0, text: "Agents " }, { offset: 7, text: "run." }, { offset: 0, text: "Agents run." }]) s = researchReducer(s, event("research.message.delta", { messageId: "a", ...d }, null));
    expect(s.messages[0]).toMatchObject({ text: "Agents run.", streaming: true });
    s = researchReducer(s, event("research.message.completed", { messageId: "a", role: "assistant", text: "Agents run [S1].", partial: false, truncated: false }, 2));
    expect(s.messages[0]).toMatchObject({ text: "Agents run [S1].", streaming: false });
    s = researchReducer(s, event("research.message.delta", { messageId: "a", offset: 0, text: "late piece" }, null));
    expect(s.messages[0]?.text, "a piece after the whole text changes nothing").toBe("Agents run [S1].");
  });

  test("a run that does not complete says how it ended; recorded citations ask for the session again", () => {
    let s = researchReducer(INITIAL, event("research.run.interrupted", { reason: "user_stop" }, 1));
    expect(s.ended?.kind).toBe("interrupted");
    s = researchReducer(s, event("research.run.failed", { reason: "tool_use_refused", message: "a tool was used", costUsd: null, turns: null, durationMs: null }, 2));
    expect(s.ended).toEqual({ kind: "failed", message: "a tool was used" });
    s = researchReducer(s, event("research.citation.recorded", { messageId: "a", citationIds: ["c"], labels: ["S1"], rejected: [] }, 3));
    expect(s.citations).toBe(1);
    s = researchReducer(s, event("research.status", { status: "running", reason: null }, 4));
    expect(s.ended).toBeNull();
  });
});
