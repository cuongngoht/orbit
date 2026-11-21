import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { SignOut } from "../features/auth/useSignOut";
import { fakeApi, withStatus } from "../testing/fakeApi";
import { TRIAL, authStatus, authUser, setupRequired, signedOut } from "../testing/fixtures";
import { renderUi } from "../testing/render";
import { ChangePasswordPage } from "./ChangePasswordPage";
import { SignInPage } from "./SignInPage";

const rule = (list: HTMLElement, text: RegExp) => within(list).getByText(text).closest("li") as HTMLElement;

describe("the sign-in page: Orbit's own sign-in", () => {
  test("a username and a password, nothing of any AI provider, and the version at the foot", async () => {
    const api = fakeApi().on("POST", "/api/auth/login", () => authStatus());
    const onStatus = vi.fn();
    renderUi(<SignInPage status={signedOut()} onStatus={onStatus} onReload={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(screen.getByText(/Orbit Web 0\.8\.0/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Continue with Claude|claude\.ai/);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Username" }), "  Admin ");
    await userEvent.type(screen.getByLabelText(/^Password\W*$/), "a long passphrase");
    // The password can be shown, to check it.
    await userEvent.click(screen.getByRole("button", { name: "Show the password" }));
    expect(screen.getByLabelText(/^Password\W*$/)).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "signed_in" })));
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/api/auth/login", body: { username: "Admin", password: "a long passphrase" } });
    expect(api.calls[0]?.headers["x-orbit-web"]).toBe("1");
  });

  test("a login on an installation nobody set up reads the state again", async () => {
    fakeApi().on("POST", "/api/auth/login", () => withStatus(409, { error: { code: "setup_required", message: "Set up the first administrator first." } }));
    const onReload = vi.fn();
    renderUi(<SignInPage status={signedOut()} onStatus={vi.fn()} onReload={onReload} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Username" }), "admin");
    await userEvent.type(screen.getByLabelText(/^Password\W*$/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
  });

  test("the first administrator: the one-time code, username admin by default, full name, company, the browser's time zone, an optional email, and the password rules shown live", async () => {
    const api = fakeApi().on("POST", "/api/auth/setup", () => authStatus());
    const onStatus = vi.fn();
    renderUi(<SignInPage status={setupRequired()} onStatus={onStatus} onReload={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Set up Orbit Web" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Username/ })).toHaveValue("admin");
    const zone = screen.getByRole("combobox", { name: /Time zone/ });
    expect(zone).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const rules = screen.getByRole("list", { name: "Password rules" });
    // Nothing typed: no rule is said to be broken yet.
    expect(rules.textContent).not.toContain("— not met");
    const password = screen.getByLabelText(/^Password\W*$/);
    await userEvent.type(password, "123456");
    expect(rule(rules, /At least 12 characters/).textContent).toContain("— not met");
    expect(rule(rules, /keyboard or number sequence/).textContent).toContain("— not met");
    await userEvent.clear(password);
    await userEvent.type(password, "admin-river-stone-42");
    expect(rule(rules, /At least 12 characters/).textContent).toContain("— met");
    expect(rule(rules, /Does not contain the username/).textContent).toContain("— not met");
    await userEvent.clear(password);
    await userEvent.type(password, "violet harbour lantern");
    for (const li of within(rules).getAllByRole("listitem")) expect(li.textContent).toContain("— met");
    // What is wrong is said all at once, before anything is sent.
    await userEvent.click(screen.getByRole("button", { name: "Create the administrator" }));
    expect(await screen.findByRole("list", { name: "What to correct" })).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
    await userEvent.type(screen.getByRole("textbox", { name: /One-time setup code/ }), "ABCD-EFGH-1234");
    await userEvent.type(screen.getByRole("textbox", { name: /Full name/ }), "Ann Owner");
    await userEvent.type(screen.getByRole("textbox", { name: /Company name/ }), "Octo & Co");
    await userEvent.selectOptions(zone, "Asia/Ho_Chi_Minh");
    await userEvent.type(screen.getByLabelText(/Repeat the password/), "violet harbour lantern");
    await userEvent.click(screen.getByRole("button", { name: "Create the administrator" }));
    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    expect(api.calls[0]?.body).toEqual({ code: "ABCD-EFGH-1234", username: "admin", password: "violet harbour lantern", fullName: "Ann Owner", companyName: "Octo & Co", timezone: "Asia/Ho_Chi_Minh", contactEmail: null });
  });

  test("a trial installation says its login in a red bar, and says to change it", () => {
    fakeApi();
    renderUi(<SignInPage status={signedOut({ trial: TRIAL })} onStatus={vi.fn()} onReload={vi.fn()} />);
    expect(screen.getByText("Trial login admin / 123456 — change the password, never expose this installation")).toBeInTheDocument();
  });

  test("a password set by somebody else: the new one is held to the rules, and the change answers the new sign-in", async () => {
    const api = fakeApi().on("POST", "/api/auth/password", () => authStatus());
    const onChanged = vi.fn();
    const signOut: SignOut = { signOut: vi.fn(async () => undefined), signOutEverywhere: vi.fn(async () => undefined), busy: false, error: null, clear: vi.fn() };
    renderUi(<ChangePasswordPage status={authStatus({ user: authUser({ mustChangePassword: true }), trial: TRIAL })} onChanged={onChanged} signOut={signOut} />);
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.getByText(/Trial login admin \/ 123456/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Current password/), "123456");
    await userEvent.type(screen.getByLabelText(/^New password/), "admin12345678");
    await userEvent.type(screen.getByLabelText(/Repeat the new password/), "admin12345678");
    await userEvent.click(screen.getByRole("button", { name: "Change password and continue" }));
    expect(await screen.findByText(/password must not contain the username/)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText(/^New password/));
    await userEvent.type(screen.getByLabelText(/^New password/), "violet harbour lantern");
    await userEvent.clear(screen.getByLabelText(/Repeat the new password/));
    await userEvent.type(screen.getByLabelText(/Repeat the new password/), "violet harbour lantern");
    await userEvent.click(screen.getByRole("button", { name: "Change password and continue" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ state: "signed_in" })));
    expect(api.calls[0]?.body).toEqual({ currentPassword: "123456", newPassword: "violet harbour lantern" });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut.signOut).toHaveBeenCalled();
  });
});
