import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { FakeEventSource } from "../../testing/fakeEventSource";
import { idleFlow, setupStatus } from "../../testing/fixtures";
import { renderUi } from "../../testing/render";
import { AzureCard } from "./AzureCard";

describe("the Azure account card", () => {
  test("Connect Azure sends the optional tenant and shows the URL and code the Azure CLI printed", async () => {
    const api = fakeApi().on("POST", "/api/azure/login", () => ({ ...idleFlow(), state: "starting" }));
    renderUi(<AzureCard status={setupStatus().azure} onChanged={() => undefined} />);
    expect(screen.getByLabelText("Azure Account").textContent).toContain("Not connected");
    await userEvent.type(screen.getByLabelText("Tenant (optional)"), "contoso.onmicrosoft.com");
    await userEvent.click(screen.getByRole("button", { name: "Connect Azure" }));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/azure/login", body: { tenant: "contoso.onmicrosoft.com" } });
    act(() => FakeEventSource.last("/api/azure/login/events").emit({ ...idleFlow(), state: "awaiting_user", url: "https://microsoft.com/devicelogin", code: "DXT2KQ9LM", updatedAt: "2026-11-19T00:01:00.000Z" }));
    expect(await screen.findByLabelText("Azure one-time code")).toHaveTextContent("DXT2KQ9LM");
    expect(screen.getByRole("link", { name: "https://microsoft.com/devicelogin" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("connected: who, which subscription, sign out, and the switch that lets Claude Code use it", async () => {
    const changed = vi.fn();
    const api = fakeApi()
      .on("PATCH", "/api/settings", (body) => ({ defaultModel: "sonnet", webTools: false, theme: "system", maxBudgetUsd: null, azureForClaude: (body as { azureForClaude: boolean }).azureForClaude }))
      .on("POST", "/api/azure/logout", () => setupStatus().azure);
    const status = setupStatus({}, {}, { state: "connected", account: { user: "dev@contoso.com", userType: "user", tenantId: "t", subscription: "Contoso Dev", subscriptionId: "s" } }).azure;
    renderUi(<AzureCard status={status} onChanged={changed} />);
    expect(screen.getByLabelText("Azure Account").textContent).toContain("dev@contoso.com");
    expect(screen.getByLabelText("Azure Account").textContent).toContain("Contoso Dev");
    const toggle = screen.getByRole("switch", { name: "Let Claude Code use this Azure sign-in" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ azureForClaude: true }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/azure/logout")).toBe(true));
    expect(changed).toHaveBeenCalled();
  });

  test("an image without the Azure CLI says so and offers no sign-in", () => {
    fakeApi();
    renderUi(<AzureCard status={setupStatus({}, {}, { state: "unavailable", detail: "The Azure CLI is not installed in this image." }).azure} onChanged={() => undefined} />);
    expect(screen.getByText(/not installed in this image/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Azure" })).toBeNull();
  });
});
