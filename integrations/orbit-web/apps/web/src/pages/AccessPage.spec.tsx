import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { takeAccessLink, watchAccessLinks } from "../services/accessLink";
import { fakeApi, withStatus } from "../testing/fakeApi";
import { renderUi } from "../testing/render";
import { AccessPage } from "./AccessPage";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("the access token, asked for first by an Orbit Web reachable from the internet", () => {
  test("two steps, said as two: the token here, then Continue with Claude -- shown, waiting", async () => {
    const api = fakeApi().on("POST", "/api/access", () => undefined);
    const granted = vi.fn();
    renderUi(<AccessPage onGranted={granted} />);
    expect(screen.getByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(screen.getByText("Enter this Orbit Web's access token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Claude" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Access token/), TOKEN);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(granted).toHaveBeenCalled());
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/access", body: { token: TOKEN } });
  });

  test("the token can be shown to check it, and pasted from the clipboard", async () => {
    const readText = vi.fn(async () => "a-pasted-access-token-of-length");
    Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
    const api = fakeApi().on("POST", "/api/access", () => withStatus(401, { error: { code: "access_token_invalid", message: "That is not this Orbit Web's access token." } }));
    renderUi(<AccessPage onGranted={() => undefined} />);
    const field = screen.getByLabelText(/Access token/);
    expect(field).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show the token" }));
    expect(field).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Hide the token" }));
    expect(field).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(field).toHaveValue("a-pasted-access-token-of-length");
    expect(api.calls, "pasting sends nothing: Continue does").toEqual([]);
  });

  test("a wrong token is said, and nothing opens", async () => {
    fakeApi().on("POST", "/api/access", () => withStatus(401, { error: { code: "access_token_invalid", message: "That is not this Orbit Web's access token." } }));
    const granted = vi.fn();
    renderUi(<AccessPage onGranted={granted} />);
    await userEvent.type(screen.getByLabelText(/Access token/), "not-the-token-at-all");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("That is not this Orbit Web's access token.")).toBeInTheDocument();
    expect(granted).not.toHaveBeenCalled();
  });

  test("an access link sends its token by itself, once, and the address keeps no trace of it", async () => {
    window.history.replaceState(null, "", `/#access=${TOKEN}`);
    takeAccessLink();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    const api = fakeApi().on("POST", "/api/access", () => undefined);
    const granted = vi.fn();
    renderUi(<AccessPage onGranted={granted} />);
    await waitFor(() => expect(granted).toHaveBeenCalledTimes(1));
    expect(api.calls.filter((c) => c.path === "/api/access").map((c) => c.body)).toEqual([{ token: TOKEN }]);
  });

  test("a link opened over the page already open -- only the fragment changes, nothing reloads -- is taken too", async () => {
    window.history.replaceState(null, "", "/");
    const stop = watchAccessLinks();
    const api = fakeApi().on("POST", "/api/access", () => undefined);
    const granted = vi.fn();
    renderUi(<AccessPage onGranted={granted} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    window.history.pushState(null, "", `/#access=${TOKEN}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(granted).toHaveBeenCalledTimes(1));
    expect(api.calls.filter((c) => c.path === "/api/access").map((c) => c.body)).toEqual([{ token: TOKEN }]);
    expect(window.location.hash).toBe("");
    stop();
  });

  test("a fragment that is not an access link is left alone", () => {
    window.history.replaceState(null, "", "/#/chat/0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f");
    takeAccessLink();
    expect(window.location.hash).toBe("#/chat/0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f");
    window.history.replaceState(null, "", "/");
  });
});
