import { screen } from "@testing-library/react";
import type { AnySessionEvent, SharedChat } from "@orbit-web/contracts";
import { describe, expect, test } from "vitest";
import { fakeApi, withStatus } from "../testing/fakeApi";
import { renderUi } from "../testing/render";
import { SharedChatPage } from "./SharedChatPage";

const SHARE = "A".repeat(43);

let seq = 0;
const ev = (type: string, data: unknown) => ({ id: `e${++seq}`, type, stream: "session", sessionId: "shared", seq, runId: null, at: "2026-11-20T00:00:00.000Z", data }) as AnySessionEvent;

const sharedChat = (): SharedChat => ({
  title: "Fix sum",
  repository: "octo/sum-fixture",
  source: "github",
  sharedAt: "2026-11-20T04:00:00.000Z",
  includeTools: false,
  events: [
    ev("message.completed", { messageId: "u1", role: "user", text: "Why does the test fail?", parentToolUseId: null, partial: false, truncated: false }),
    ev("tool.started", { toolUseId: "t1", name: "Bash", title: "$ npm test", input: "", inputTruncated: false, parentToolUseId: null, agent: null }),
    ev("tool.completed", { toolUseId: "t1", output: "", truncated: false, isError: false, interrupted: false, parentToolUseId: null }),
    ev("message.completed", { messageId: "a1", role: "assistant", text: "The **sum** subtracts.", parentToolUseId: null, partial: false, truncated: false }),
  ],
});

describe("a shared chat, as its link shows it", () => {
  test("the conversation as it was shared, read-only: its title, repository, messages and tools by title", async () => {
    fakeApi().on("GET", `/api/shared/${SHARE}`, () => sharedChat());
    renderUi(<SharedChatPage token={SHARE} />);
    expect(await screen.findByRole("heading", { name: "Fix sum" })).toBeInTheDocument();
    expect(screen.getByText("octo/sum-fixture")).toBeInTheDocument();
    expect(screen.getByText("Why does the test fail?")).toBeInTheDocument();
    expect(screen.getByText("sum")).toBeInTheDocument();
    expect(screen.getByText("$ npm test")).toBeInTheDocument();
    expect(screen.getByText(/read-only snapshot/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show details" }), "a tool shared by its title has no details to show").toBeNull();
  });

  test("a link that names no shared chat says so", async () => {
    fakeApi().on("GET", `/api/shared/${SHARE}`, () => withStatus(404, { error: { code: "not_found", message: "Shared chat was not found" } }));
    renderUi(<SharedChatPage token={SHARE} />);
    expect(await screen.findByText(/not shared, or no longer/i)).toBeInTheDocument();
  });
});
