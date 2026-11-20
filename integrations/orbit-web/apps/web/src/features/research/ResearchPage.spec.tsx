import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fakeApi, type FakeApi } from "../../testing/fakeApi";
import { renderLive } from "../../testing/render";
import { content, RESEARCH_ID, researchDetail, researchStream, source, SOURCE_A, SOURCE_B, workspace, WORKSPACE_ID } from "../../testing/researchFixtures";
import { mobileViewport, tabletViewport, wideViewport } from "../../testing/viewport";
import { ResearchPage } from "./ResearchPage";

const originalMatchMedia = window.matchMedia;
afterEach(() => Object.defineProperty(window, "matchMedia", { writable: true, value: originalMatchMedia }));

function api(detail = researchDetail()): FakeApi {
  return fakeApi()
    .on("GET", `/api/research/sessions/${RESEARCH_ID}`, () => detail)
    .on("GET", `/api/research/workspaces/${WORKSPACE_ID}`, () => workspace())
    .on("GET", `/api/research/workspaces/${WORKSPACE_ID}/sources`, () => [source(), source({ id: SOURCE_B, title: "Codenames", mediaType: "docx", origin: "codenames.docx", state: "failed", stateReason: "The document is encrypted: research cannot read it.", revision: null })])
    .on("GET", `/api/research/workspaces/${WORKSPACE_ID}/notes`, () => [])
    .on("GET", `/api/research/workspaces/${WORKSPACE_ID}/findings`, () => [])
    .on("GET", `/api/research/workspaces/${WORKSPACE_ID}/access`, () => ({ access: "owner", owner: "octo@example.com", people: [] }))
    .on("PUT", `/api/research/sessions/${RESEARCH_ID}/sources`, (body) => ({ sessionId: RESEARCH_ID, selection: (body as { sources: string[] }).sources }))
    .on("GET", `/api/research/sources/${SOURCE_A}/content`, () => content())
    .on("POST", `/api/research/sessions/${RESEARCH_ID}/messages`, () => ({ sessionId: RESEARCH_ID, runId: "r2" }))
    .on("POST", `/api/research/workspaces/${WORKSPACE_ID}/notes`, (body) => ({ id: "n1", workspaceId: WORKSPACE_ID, sessionId: RESEARCH_ID, title: (body as { title: string }).title, body: (body as { body: string }).body, sourceId: null, citationId: null, citation: null, createdBy: "octo@example.com", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z" }));
}

const show = () => renderLive(<ResearchPage sessionId={RESEARCH_ID} onUpdated={vi.fn()} />);

describe("a research session", () => {
  test("from 1440px: sources, the chat and the evidence side by side; the sources it may search, and why one cannot be", async () => {
    wideViewport();
    api();
    show();
    const sources = await screen.findByRole("region", { name: "Sources" });
    expect(screen.getByRole("region", { name: "Research chat" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Evidence" })).toBeInTheDocument();
    await within(sources).findByText("NIST policy");
    expect(within(sources).getByText("Sources (2)")).toBeInTheDocument();
    expect(within(sources).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/Using 1 source/)).toBeInTheDocument();
    expect(within(sources).getByText(/The passages a question retrieves are sent to Claude \(Anthropic\)/)).toBeInTheDocument();
  });

  test("a checkbox decides what this session's questions may retrieve from, kept per session", async () => {
    wideViewport();
    const a = api();
    show();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Use Codenames in this session" }));
    await waitFor(() => expect(a.calls.find((c) => c.method === "PUT")?.body).toEqual({ sources: [SOURCE_A, SOURCE_B] }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Use NIST policy in this session" }));
    await waitFor(() => expect(a.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ sources: [SOURCE_B] }));
  });

  test("a citation opens the exact passage of the revision it cites, marked, in the evidence panel", async () => {
    wideViewport();
    const a = api();
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Citation S1" }));
    const evidence = screen.getByRole("region", { name: "Evidence" });
    const cited = await within(evidence).findByText("Network egress is denied by default.");
    expect(cited.closest("[data-cited]")).not.toBeNull();
    expect(a.calls.find((c) => c.path.startsWith(`/api/research/sources/${SOURCE_A}/content`))?.path).toBe(`/api/research/sources/${SOURCE_A}/content?revision=eeeeeeee-1111-4222-8333-444444444444&around=1`);
    expect(within(evidence).getByText(/Page 2/)).toBeInTheDocument();
  });

  test("the answer list's citations: each one says where it is from and opens it", async () => {
    wideViewport();
    api();
    show();
    await userEvent.click(await screen.findByRole("button", { name: "1 citation" }));
    const open = await screen.findByRole("button", { name: "Open citation S1: NIST policy" });
    expect(within(open).getByText(/p\. 2 · rev\. 1/)).toBeInTheDocument();
    await userEvent.click(open);
    expect(await screen.findByText("Network egress is denied by default.")).toBeInTheDocument();
  });

  test("a question is asked from the composer; the answer streams in and is never doubled", async () => {
    wideViewport();
    const a = api(researchDetail({ messages: [] }));
    show();
    await userEvent.type(await screen.findByRole("textbox", { name: "Message" }), "What about egress?{Enter}");
    await waitFor(() => expect(a.calls.find((c) => c.method === "POST" && c.path.endsWith("/messages"))?.body).toEqual({ text: "What about egress?" }));
    const push = researchStream(RESEARCH_ID);
    push("research.message.completed", { messageId: "q2", role: "user", text: "What about egress?", partial: false, truncated: false });
    push("research.status", { status: "running", reason: null });
    push("research.run.started", { model: "sonnet", effort: "medium", sources: [{ sourceId: SOURCE_A, revisionId: "r", title: "NIST policy" }], passages: 2, matched: 1 });
    expect(await screen.findByText("Answering from 2 passages of 1 source…")).toBeInTheDocument();
    push("research.message.started", { messageId: "a2", role: "assistant" });
    push("research.message.delta", { messageId: "a2", offset: 0, text: "Egress is " }, false);
    push("research.message.delta", { messageId: "a2", offset: 0, text: "Egress is " }, false);
    push("research.message.delta", { messageId: "a2", offset: 10, text: "denied" }, false);
    expect(await screen.findByText("Egress is denied")).toBeInTheDocument();
    expect(screen.getByLabelText("writing")).toBeInTheDocument();
  });

  test("an answer kept as a note: the notes tab opens with it, tied to its first citation", async () => {
    wideViewport();
    const a = api();
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Save as note" }));
    const form = await screen.findByRole("form", { name: "New note" });
    expect(within(form).getByRole("textbox", { name: "Title" })).toHaveValue("Egress is denied by default [S1].");
    await userEvent.click(within(form).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(a.calls.find((c) => c.method === "POST" && c.path.endsWith("/notes"))?.body).toMatchObject({ citationId: "c1111111-1111-4222-8333-444444444444", sessionId: RESEARCH_ID }));
  });

  test("below 1440px the evidence is a drawer; the sources stay beside the chat", async () => {
    tabletViewport();
    api();
    show();
    await screen.findByRole("region", { name: "Sources" });
    expect(screen.queryByRole("region", { name: "Evidence" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Evidence panel" }));
    expect(await screen.findByRole("region", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Citations" })).toBeInTheDocument();
  });

  test("on a phone, one panel at a time behind tabs -- the chat first", async () => {
    mobileViewport();
    api();
    show();
    const tabs = await screen.findByRole("tablist", { name: "Research panels" });
    expect(screen.getByRole("region", { name: "Research chat" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources" })).toBeNull();
    await userEvent.click(within(tabs).getByRole("tab", { name: "Sources" }));
    expect(await screen.findByRole("region", { name: "Sources" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Research chat" })).toBeNull();
    await userEvent.click(within(tabs).getByRole("tab", { name: "Evidence" }));
    expect(await screen.findByRole("region", { name: "Evidence" })).toBeInTheDocument();
  });
});
