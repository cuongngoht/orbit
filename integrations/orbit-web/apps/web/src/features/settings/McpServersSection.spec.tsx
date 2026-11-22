// SETTINGS → MCP SERVERS: the account's knowledge bases and other remote MCP servers -- each with the tools Orbit Web read
// from it and which employees may use (a read-only one allowed when it was added) -- added with how Orbit Web signs in to
// it (a token typed once, never shown again), read again, and removed.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { McpServerList, McpServerView } from "@orbit-web/contracts";
import { describe, expect, test } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { renderUi } from "../../testing/render";
import { McpServersSection } from "./McpServersSection";

const KB: McpServerView = {
  id: "0b5e2a7c-4d1f-4b8e-9c3a-6f7d8e9a0b1c",
  name: "Team KB",
  url: "https://kb.example.com/mcp",
  auth: { kind: "bearer", header: null, hasToken: true },
  tools: [
    { name: "search", description: "Search the knowledge base.", readOnly: true, allowed: true, employeeName: "kb_teamkb_search" },
    { name: "create_page", description: "Create a page.", readOnly: false, allowed: false, employeeName: "kb_teamkb_create_page" },
  ],
  readAt: "2026-11-22T00:00:00.000Z",
  readError: null,
  createdAt: "2026-11-22T00:00:00.000Z",
};

describe("Settings → MCP servers", () => {
  test("a server, its tools and which ones employees may use; a box changes that", async () => {
    const api = fakeApi()
      .on("GET", "/api/mcp-servers", (): McpServerList => ({ servers: [KB] }))
      .on("PUT", `/api/mcp-servers/${KB.id}`, () => ({ ...KB, tools: KB.tools.map((t) => ({ ...t, allowed: true })) }));
    renderUi(<McpServersSection />);
    const server = await screen.findByRole("region", { name: "Team KB" });
    expect(server.textContent).toContain("https://kb.example.com/mcp");
    expect(server.textContent).toContain("Bearer token");
    expect(within(server).getByText("Read-only")).toBeInTheDocument();
    expect(within(server).getByRole("checkbox", { name: "Employees may use search" })).toBeChecked();
    const create = within(server).getByRole("checkbox", { name: "Employees may use create_page" });
    expect(create).not.toBeChecked();
    await userEvent.click(create);
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ allowedTools: ["search", "create_page"] }));
    await waitFor(() => expect(within(server).getByRole("checkbox", { name: "Employees may use create_page" })).toBeChecked());
  });

  test("a server is added with its sign-in: the token typed once, as a password", async () => {
    const api = fakeApi()
      .on("GET", "/api/mcp-servers", (): McpServerList => ({ servers: [] }))
      .on("POST", "/api/mcp-servers", () => ({ ...KB, readError: "The server refused Orbit Web's sign-in (HTTP 401): check the token." }));
    renderUi(<McpServersSection />);
    expect(await screen.findByText(/No MCP server yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Team KB");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://kb.example.com/mcp");
    await userEvent.click(screen.getByRole("radio", { name: "Bearer token" }));
    const token = screen.getByLabelText("Token");
    expect(token).toHaveAttribute("type", "password");
    await userEvent.type(token, "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Team KB", url: "https://kb.example.com/mcp", auth: { kind: "bearer", token: "s3cret" } }));
    const added = await screen.findByRole("region", { name: "Team KB" });
    expect(added.textContent).toContain("check the token");
  });

  test("read again, and removed once a person confirms", async () => {
    const api = fakeApi()
      .on("GET", "/api/mcp-servers", (): McpServerList => ({ servers: [KB] }))
      .on("POST", `/api/mcp-servers/${KB.id}/refresh`, () => KB)
      .on("DELETE", `/api/mcp-servers/${KB.id}`, (): McpServerList => ({ servers: [] }));
    renderUi(<McpServersSection />);
    const server = await screen.findByRole("region", { name: "Team KB" });
    await userEvent.click(within(server).getByRole("button", { name: "Read again" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/refresh"))).toBe(true));
    await userEvent.click(within(server).getByRole("button", { name: "Remove" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(within(server).getByRole("button", { name: "Remove Team KB" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(await screen.findByText(/No MCP server yet/)).toBeInTheDocument();
  });
});
