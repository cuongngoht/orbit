// What a person allows a task's sandbox, and what they trust: saved with the rest of the runtime settings as a
// whole against the revision they read, and granted -- a restore plan, a container definition -- by the
// fingerprint they typed through Control's own routes. What is promised: a Settings save never erases the
// policy; trust names the revision it read, and a stale one is refused in the server's words with what was
// typed kept; nothing is sent without the token; and every list a policy holds goes back exactly as read.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../../shared/api/client";
import { DB_ID, PAGE_PATH, RUNTIME_PATH, SANDBOX_DEFAULTS, TRUSTED_DEFINITION, TRUSTED_RESTORE, fakeRuntime } from "../../../testing/fakeRuntime";
import { fakeServer } from "../../../testing/fakeServer";
import { renderApp } from "../../../testing/renderApp";
import { elementOf, fieldOf, required } from "../../../testing/required";

let runtime: ReturnType<typeof fakeRuntime>;
let server: ReturnType<typeof fakeServer>;

function serve(opts: Parameters<typeof fakeRuntime>[0] = {}) {
  runtime = fakeRuntime(opts);
  server = fakeServer(undefined, runtime.handle);
  vi.stubGlobal("fetch", server.fetch);
}

beforeEach(() => {
  serve();
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const posts = () => server.calls.filter((c) => c.method !== "GET");
const FRESH = "0f1e2d3c4b5a6978".repeat(4);
const short = (fp: string) => fp.slice(0, 12);

const policy = async () => {
  const heading = await screen.findByRole("heading", { name: "Sandbox policy" });
  return required(heading.closest<HTMLElement>("section"), "the Sandbox policy card");
};

const trusting = (scope: HTMLElement, title: string) => within(within(scope).getByRole("group", { name: title }));

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

const button = (scope: HTMLElement, name: string) => elementOf(within(scope).getByRole("button", { name }), HTMLButtonElement, name);

describe("Sandbox policy", () => {
  it("shows what the policy is now -- on, auto, three at once, leased ports, restore only what is trusted, no QA mode, isolated browser, production writes refused", async () => {
    renderApp(PAGE_PATH);
    const card = await policy();
    expect(within(card).getByRole("switch", { name: "Tasks of this checkout may have a sandbox" })).toHaveProperty("checked", true);
    expect(elementOf(within(card).getByLabelText("Where a component runs"), HTMLSelectElement, "strategy").value).toBe("auto");
    expect(elementOf(within(card).getByLabelText("Sandboxes at once"), HTMLInputElement, "limit").value).toBe("3");
    expect([elementOf(within(card).getByLabelText("Port range from"), HTMLInputElement, "from").value, elementOf(within(card).getByLabelText("Port range to"), HTMLInputElement, "to").value]).toEqual(["42000", "42999"]);
    expect(elementOf(within(card).getByLabelText("Restoring dependencies"), HTMLSelectElement, "restore").value).toBe("approved");
    for (const mode of ["observe", "explore-write", "security-test", "regression"]) expect(within(card).getByRole("checkbox", { name: mode })).toHaveProperty("checked", false);
    expect(elementOf(within(card).getByLabelText("Browser"), HTMLSelectElement, "browser").disabled).toBe(true);
    expect(within(card).getByRole("switch", { name: /Production writes are refused/ })).toHaveProperty("checked", true);
  });

  it("saves the WHOLE settings block, the sandbox policy changed and every other field as it was, against the revision it read", async () => {
    renderApp(PAGE_PATH);
    const card = await policy();
    type(within(card).getByLabelText("Sandboxes at once"), "5");
    type(within(card).getByLabelText("Port range from"), "43000");
    type(within(card).getByLabelText("Port range to"), "43500");
    fireEvent.change(within(card).getByLabelText("Restoring dependencies"), { target: { value: "manual" } });
    fireEvent.click(within(card).getByRole("checkbox", { name: "explore-write" }));
    type(within(card).getByLabelText("Component the browser opens"), " node:web ");
    fireEvent.click(within(card).getByRole("switch", { name: /Production writes are refused/ }));
    fireEvent.click(button(card, "Save sandbox policy"));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    const put = required(posts().find((c) => c.method === "PUT"), "the save");
    expect(put.headers[TOKEN_HEADER]).toBe("tok-123");
    expect(put.body).toEqual({
      settings: {
        strategy: "auto",
        reuseExternal: false,
        components: {},
        connectivity: { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }, targets: {} },
        sandbox: { enabled: true, strategy: "auto", limits: { active: 5 }, restore: { mode: "manual", trusted: [] }, ports: { mode: "lease", from: 43000, to: 43500 }, trustedDefinitions: [], qa: { modes: ["explore-write"], entry: "node:web", browser: "isolated" }, network: { denyProductionWrites: false } },
      },
      revision: null,
    });
    expect(await within(await policy()).findByText("Saved.")).toBeTruthy();
  });

  it("keeps the trusted fingerprints exactly as read when the form is saved", async () => {
    serve({ trusted: true });
    renderApp(PAGE_PATH);
    const card = await policy();
    fireEvent.click(within(card).getByRole("switch", { name: "Tasks of this checkout may have a sandbox" }));
    fireEvent.click(button(card, "Save sandbox policy"));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    const sandbox = fieldOf(fieldOf(posts().find((c) => c.method === "PUT")?.body, "settings"), "sandbox");
    expect(fieldOf(sandbox, "enabled")).toBe(false);
    expect(fieldOf(fieldOf(sandbox, "restore"), "trusted")).toEqual([TRUSTED_RESTORE]);
    expect(fieldOf(sandbox, "trustedDefinitions")).toEqual([TRUSTED_DEFINITION]);
  });

  it("a Settings save does not erase the sandbox policy: it goes back exactly as it was read", async () => {
    serve({ trusted: true });
    renderApp(PAGE_PATH);
    const select = await screen.findByLabelText("How to run it");
    fireEvent.change(select, { target: { value: "native" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    const put = required(posts().find((c) => c.method === "PUT"), "the save");
    expect(fieldOf(fieldOf(put.body, "settings"), "strategy")).toBe("native");
    expect(fieldOf(fieldOf(put.body, "settings"), "sandbox")).toEqual({ ...SANDBOX_DEFAULTS, restore: { mode: "approved", trusted: [TRUSTED_RESTORE] }, trustedDefinitions: [TRUSTED_DEFINITION] });
  });

  it("a Settings save keeps what the sandbox policy hangs on other settings: a component's port override and a server's classification", async () => {
    runtime = fakeRuntime({ target: true });
    const was = runtime.state.status.settings;
    const override = { kind: "env" as const, name: "PORT", format: "{port}" };
    const target = { ...was.settings.connectivity.targets[DB_ID], classification: "production" as const };
    runtime.state.status = { ...runtime.state.status, settings: { ...was, settings: { ...was.settings, components: { "node:web": { port: { override } } }, connectivity: { ...was.settings.connectivity, targets: { [DB_ID]: target } } } } };
    server = fakeServer(undefined, runtime.handle);
    vi.stubGlobal("fetch", server.fetch);
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("How to run it"), { target: { value: "native" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    const saved = fieldOf(posts().find((c) => c.method === "PUT")?.body, "settings");
    expect(fieldOf(fieldOf(fieldOf(saved, "components"), "node:web"), "port")).toEqual({ override });
    expect(fieldOf(fieldOf(fieldOf(fieldOf(saved, "connectivity"), "targets"), DB_ID), "classification")).toBe("production");
  });

  it("Trust sends the kind, the fingerprint and the revision it read to Control's own route, and the plan shows trusted once the server says so", async () => {
    renderApp(PAGE_PATH);
    const card = await policy();
    const restore = trusting(card, "Restore plans you trust");
    expect(restore.getByText(/No restore plan is trusted/)).toBeTruthy();
    const grant = elementOf(restore.getByRole("button", { name: "Trust" }), HTMLButtonElement, "Trust");
    expect(grant.disabled).toBe(true);
    type(restore.getByLabelText("Fingerprint to trust (restore)"), "not-a-fingerprint");
    expect(grant.disabled).toBe(true);
    type(restore.getByLabelText("Fingerprint to trust (restore)"), FRESH.slice(0, 16));
    expect(grant.disabled, "a short prefix is not a fingerprint").toBe(true);
    type(restore.getByLabelText("Fingerprint to trust (restore)"), ` ${FRESH} `);
    expect(restore.queryByText(short(FRESH))).toBeNull();
    fireEvent.click(grant);
    expect(await trusting(await policy(), "Restore plans you trust").findByText(short(FRESH))).toBeTruthy();
    expect(posts()).toHaveLength(1);
    const post = required(posts()[0], "the trust");
    expect([post.method, post.path, post.body, post.headers[TOKEN_HEADER]]).toEqual(["POST", `${RUNTIME_PATH}/sandbox/trust`, { kind: "restore", fingerprint: FRESH, revision: null }, "tok-123"]);
    expect((trusting(await policy(), "Restore plans you trust").getByLabelText("Fingerprint to trust (restore)") as HTMLInputElement).value).toBe("");
  });

  it("Approve is the container definition's own list, and Revoke takes a fingerprint back against the revision just read", async () => {
    serve({ trusted: true });
    renderApp(PAGE_PATH);
    const card = await policy();
    const definitions = trusting(card, "Container definitions you approve");
    expect(definitions.getByText(short(TRUSTED_DEFINITION))).toBeTruthy();
    type(definitions.getByLabelText("Fingerprint to approve (definition)"), FRESH);
    fireEvent.click(definitions.getByRole("button", { name: "Approve" }));
    expect(await trusting(await policy(), "Container definitions you approve").findByText(short(FRESH))).toBeTruthy();
    expect(posts()[0]?.body).toEqual({ kind: "definition", fingerprint: FRESH, revision: null });
    fireEvent.click(within(await policy()).getByRole("button", { name: `Revoke ${short(TRUSTED_RESTORE)}` }));
    await waitFor(() => expect(within(card).queryByText(short(TRUSTED_RESTORE))).toBeNull());
    const revoke = required(posts()[1], "the revoke");
    expect([revoke.path, revoke.body]).toEqual([`${RUNTIME_PATH}/sandbox/revoke`, { kind: "restore", fingerprint: TRUSTED_RESTORE, revision: "rev-1" }]);
    expect(runtime.state.status.settings.settings.sandbox.restore.trusted).toEqual([]);
    expect(runtime.state.status.settings.settings.sandbox.trustedDefinitions).toEqual([TRUSTED_DEFINITION, FRESH]);
  });

  it("a trust against a revision that moved is a 409 shown in the server's words, and what was typed is still there", async () => {
    renderApp(PAGE_PATH);
    const card = await policy();
    runtime.state.revision = "rev-9";
    const restore = trusting(card, "Restore plans you trust");
    type(restore.getByLabelText("Fingerprint to trust (restore)"), FRESH);
    fireEvent.click(restore.getByRole("button", { name: "Trust" }));
    expect(await within(await policy()).findByText(/the runtime settings changed since they were read/)).toBeTruthy();
    expect(within(await policy()).getByText("Nothing was changed")).toBeTruthy();
    expect((trusting(await policy(), "Restore plans you trust").getByLabelText("Fingerprint to trust (restore)") as HTMLInputElement).value).toBe(FRESH);
    expect(within(await policy()).getByRole("button", { name: "Load the latest settings" })).toBeTruthy();
    expect(runtime.state.status.settings.settings.sandbox.restore.trusted).toEqual([]);
  });

  it("without the page's token nothing can be saved, trusted or revoked, and nothing is sent", async () => {
    window.sessionStorage.clear();
    serve({ trusted: true });
    renderApp(PAGE_PATH);
    const card = await policy();
    for (const name of ["Save sandbox policy", "Trust", "Approve", `Revoke ${short(TRUSTED_RESTORE)}`, `Revoke ${short(TRUSTED_DEFINITION)}`]) {
      const pressed = button(card, name);
      expect(pressed.disabled, name).toBe(true);
      fireEvent.click(pressed);
    }
    expect(posts()).toEqual([]);
  });
});
