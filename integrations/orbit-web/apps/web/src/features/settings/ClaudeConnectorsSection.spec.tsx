import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConnectorList } from "@orbit-web/contracts";
import { describe, expect, test } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { renderUi } from "../../testing/render";
import { ClaudeConnectorsSection } from "./ClaudeConnectorsSection";

const LIST: ConnectorList = {
  source: "account",
  readAt: "2026-11-21T00:00:00.000Z",
  detail: null,
  connectors: [
    { name: "claude.ai Claude Docs", label: "Claude Docs", kind: "claude.ai", status: "connected", tools: 8, chat: true, research: true },
    { name: "claude.ai Gmail", label: "Gmail", kind: "claude.ai", status: "needs-auth", tools: null, chat: true, research: false },
  ],
};

describe("Settings → Claude connectors", () => {
  test("the account's connectors, each with its state and a box for chats and one for research", async () => {
    fakeApi().on("GET", "/api/claude/connectors", () => LIST);
    renderUi(<ClaudeConnectorsSection />);
    const section = await screen.findByRole("region", { name: "Claude connectors" });
    const rows = await within(section).findAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(section).getByText("Sign in at claude.ai")).toBeInTheDocument();
    expect(within(section).getByRole("checkbox", { name: "Claude Docs in research" })).toBeChecked();
    expect(within(section).getByRole("checkbox", { name: "Gmail in research" })).not.toBeChecked();
    expect(within(section).getByRole("checkbox", { name: "Gmail in chat" })).toBeChecked();
  });

  test("a box changes that one connector's one use; Read again asks the account anew", async () => {
    const api = fakeApi()
      .on("GET", "/api/claude/connectors", () => LIST)
      .on("PUT", "/api/claude/connectors", () => ({ ...LIST, connectors: LIST.connectors.map((c) => (c.label === "Gmail" ? { ...c, chat: false } : c)) }))
      .on("POST", "/api/claude/connectors/refresh", () => LIST);
    renderUi(<ClaudeConnectorsSection />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Gmail in chat" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ connectors: { "claude.ai Gmail": { chat: false } } }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Gmail in chat" })).not.toBeChecked());
    await userEvent.click(screen.getByRole("button", { name: "Read again" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/claude/connectors/refresh")).toBe(true));
  });

  test("an account the CLI could not be asked about says so, and keeps the choices made", async () => {
    fakeApi().on("GET", "/api/claude/connectors", () => ({ ...LIST, source: "unavailable", readAt: null, detail: "The Claude CLI could not be asked which connectors this account has; the choices kept so far are shown." }));
    renderUi(<ClaudeConnectorsSection />);
    expect(await screen.findByText(/could not be asked which connectors/)).toBeInTheDocument();
    expect(screen.getByText("Not read from your Claude account")).toBeInTheDocument();
  });
});
