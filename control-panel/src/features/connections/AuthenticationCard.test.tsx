// The Authentication card of a connection, through the whole app: one way in per strategy the provider's descriptor offers, the
// options drawn from that descriptor, a session that is only looked at when a person presses a button, the words for each state it
// can be in, and a stop that says what happened and what to do. Over an in-memory server, so nothing starts a program or opens a
// browser -- and nothing it answers can carry a token.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiError, TOKEN_HEADER } from "../../shared/api/client";
import { fakeReports, OWN_COPY, PROVIDERS, signingIn } from "../../testing/fakeReports";
import { fakeTool } from "../../testing/fakeResources";
import { fakeServer, reply, type Call } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";
import { required } from "../../testing/required";
import { programWords, sessionView, sourceWords } from "./authWords";
import { authLine, choiceOf, optionProblem, sameChoice, strategiesOf } from "./connectionWords";
import type { AuthStrategy, AuthTool, ConnectionTest } from "./connections.types";

const PAT = "azure_pat_11PANELCANARY00000000000000000000000000000000000000000000000000";
const AZURE = "/connections/azure-acme";
const SESSION = (tail: string) => `/api/v1/connections/azure-acme/auth/${tail}`;

// The programs a strategy can be held by, as Tools lists them -- where a person is told how to get one.
const PROGRAMS = [
  fakeTool("azure-cli-private", { name: "Azure CLI (Orbit's own copy)", status: "missing", state: "not-installed", autonomous: true, install: { strategy: "python-lock", supported: true, reason: null, version: "2.91.0", source: "https://pypi.org/project/azure-cli/2.91.0/", instructions: null } }),
  fakeTool("azure-cli", { name: "Azure CLI", status: "missing", state: "not-installed", install: { strategy: "manual", supported: false, reason: "install it yourself", version: null, source: null, instructions: "Install the Azure CLI from https://learn.microsoft.com/cli/azure/install-azure-cli or your operating system's package manager. Orbit does not install it." } }),
];

let reports: ReturnType<typeof fakeReports>;
let server: ReturnType<typeof fakeServer>;

const tools = (call: Call) => (call.path === "/api/v1/tools" ? reply(200, { tools: PROGRAMS }) : null);

beforeEach(() => {
  reports = fakeReports();
  reports.connections.set("azure-acme", signingIn("azure-acme", { organization: "acme" }));
  server = fakeServer(undefined, (call) => reports.handle(call) ?? tools(call));
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

async function cardOf(path = AZURE): Promise<HTMLElement> {
  renderApp(path);
  const heading = await screen.findByRole("heading", { name: "Authentication" });
  const found = heading.closest("section");
  if (!found) throw new Error("no Authentication card");
  return found;
}

const sessionCalls = () => server.calls.filter((c) => c.path.includes("/auth/")).map((c) => `${c.method} ${c.path}`);

const press = (card: HTMLElement, name: string) => fireEvent.click(within(card).getByRole("button", { name }));

describe("The Authentication card", () => {
  it("offers one way in per strategy the descriptor declares, marks the recommended one, takes the connection's own, and draws its options from the descriptor", async () => {
    const card = await cardOf();
    const [signIn, token] = [within(card).getByRole("radio", { name: "Microsoft sign-in" }), within(card).getByRole("radio", { name: "Personal access token or environment variable" })];
    expect([(signIn as HTMLInputElement).checked, (token as HTMLInputElement).checked]).toEqual([true, false]);
    expect(within(card).getByText("Recommended")).toBeTruthy();
    expect(within(card).getByText("Alternative")).toBeTruthy();
    expect((within(card).getByLabelText("Directory (tenant)") as HTMLInputElement).value).toBe("");
    expect((within(card).getByRole("checkbox", { name: "Use a device code" }) as HTMLInputElement).checked).toBe(false);
    expect(within(card).queryByLabelText("Credential"), "the credential's controls belong to the alternative").toBeNull();
    expect(within(card).getByText("azure-cli"), "who keeps the session, from the descriptor").toBeTruthy();
  });

  it("starts nothing by itself: the session is 'not checked yet' until a person presses a button, and a GET never reached a program", async () => {
    const card = await cardOf();
    expect(within(card).getAllByText("Not checked yet")).toHaveLength(2);
    expect(within(card).getByText(/Not tested since the last change/)).toBeTruthy();
    expect(sessionCalls()).toEqual([]);
    expect(server.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("says where the sign-in happens: in the person's browser, with the prompt in the terminal Orbit Control runs in", async () => {
    const card = await cardOf();
    expect(within(card).getByText(/happens in your browser/)).toBeTruthy();
    expect(within(card).getByText(/appears in the terminal where Orbit Control is running, not on this page/)).toBeTruthy();
  });

  it.each([
    ["sign-in-required", "Sign-in required", /Press Sign in/],
    ["authenticated", "Signed in", /short-lived access token each time it needs one, and keeps none/],
    ["interaction-required", "Needs a person again", /The session ended, or a policy now asks for more/],
    ["failed", "Failed", /could not give a token/],
  ])("Check: %s is said as '%s' -- and an access token that ran out is never news", async (state, label, says) => {
    reports.state.auth.state = state;
    const card = await cardOf();
    press(card, "Check");
    expect(await within(card).findByText(label)).toBeTruthy();
    expect(within(card).getByText(says)).toBeTruthy();
    expect(within(card).getByText("Installed v2.91.0")).toBeTruthy();
    expect(card.textContent).not.toMatch(/expire|login expired|token expired/i);
    expect(sessionCalls()).toEqual([`POST ${SESSION("check")}`]);
    expect(server.calls.find((c) => c.path === SESSION("check"))?.headers[TOKEN_HEADER]).toBe("tok-123");
  });

  it("says which copy of the program it found: Orbit's own, or the machine's used as a program only", async () => {
    const card = await cardOf();
    press(card, "Check");
    expect(await within(card).findByText("Installed v2.91.0")).toBeTruthy();
    expect(within(card).getByText("Orbit's own copy.")).toBeTruthy();
    reports.state.auth.tool = { ...OWN_COPY, version: "2.70.1", source: "system" };
    press(card, "Check");
    expect(await within(card).findByText("Installed v2.70.1")).toBeTruthy();
    expect(within(card).getByText(/used as a program only: the account it may be signed in with is NOT used/)).toBeTruthy();
  });

  it("a missing program says whether Orbit can install its own copy, and where; otherwise it gives the instructions", async () => {
    reports.state.auth.state = "tool-missing";
    reports.state.auth.tool = { found: false, version: null, source: null, acquirable: "azure-cli-private", tried: [{ id: "azure-cli", reason: "not found" }] };
    const card = await cardOf();
    press(card, "Check");
    expect(await within(card).findByText("Program missing")).toBeTruthy();
    expect(within(card).getByText(/Orbit can install its own copy of the program\. It does so by itself the first time a sign-in needs one/)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "install it from Tools" }).getAttribute("href")).toBe("/tools/azure-cli-private");
    expect(within(within(card).getByRole("list", { name: "Looked for" })).getByText(/azure-cli — not found/)).toBeTruthy();
    expect((within(card).getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled, "nothing to sign out of").toBe(true);
    reports.state.auth.tool = { found: false, version: null, source: null, acquirable: null, tried: [] };
    press(card, "Check");
    expect(await within(card).findByText(/Orbit cannot install its own copy of the program on this machine\. Install the Azure CLI from/)).toBeTruthy();
  });

  it("Sign in sends the saved options with the token, waits while the person finishes in their browser, then Re-authenticate and Sign out follow", async () => {
    reports.connections.set("azure-acme", signingIn("azure-acme", { auth: { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true } }));
    let finish = () => {};
    const gate = new Promise<void>((done) => { finish = done; });
    vi.stubGlobal("fetch", (path: string, init?: RequestInit) => (path === SESSION("sign-in") ? gate.then(() => server.fetch(path, init)) : server.fetch(path, init)));
    const card = await cardOf();
    expect((within(card).getByLabelText("Directory (tenant)") as HTMLInputElement).value).toBe("contoso.example");
    press(card, "Sign in");
    expect(await within(card).findByRole("button", { name: "Waiting for the sign-in…" })).toBeTruthy();
    expect(within(card).getByRole("status").textContent).toMatch(/Finish the sign-in in your browser/);
    expect((within(card).getByRole("button", { name: "Check" }) as HTMLButtonElement).disabled).toBe(true);
    finish();
    expect(await within(card).findByText("Signed in")).toBeTruthy();
    const post = server.calls.find((c) => c.path === SESSION("sign-in"));
    expect([post?.method, post?.body, post?.headers[TOKEN_HEADER]]).toEqual(["POST", { tenant: "contoso.example", deviceCode: true }, "tok-123"]);
    expect(within(card).getByRole("button", { name: "Re-authenticate" })).toBeTruthy();
    press(card, "Sign out");
    expect(await within(card).findByText("Sign-in required")).toBeTruthy();
    expect(sessionCalls()).toEqual([`POST ${SESSION("sign-in")}`, `POST ${SESSION("sign-out")}`]);
    expect(within(card).getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("a sign-in with no options sends an empty body, and a sign-in that cannot go on shows the engine's sentence and next step -- not its code", async () => {
    reports.state.auth.stop = { status: 503, code: "AUTH_LOGIN_CANCELLED", message: "the sign-in was not finished", next: "press Sign in to try again" };
    const card = await cardOf();
    press(card, "Sign in");
    expect(await within(card).findByText("The sign-in did not finish")).toBeTruthy();
    expect(within(card).getByText(/the sign-in was not finished/)).toBeTruthy();
    expect(within(card).getByText("Next: press Sign in to try again")).toBeTruthy();
    expect(within(card).getByText("Failed")).toBeTruthy();
    expect(within(card).queryByText(/could not give a token/), "a stock sentence beside the engine's own words could contradict them").toBeNull();
    expect(card.textContent).not.toContain("AUTH_LOGIN_CANCELLED");
    expect(server.calls.find((c) => c.path === SESSION("sign-in"))?.body).toEqual({});
  });

  it("a browser that gives up on a sign-in that waited long says the page lost its connection -- not that the server is down -- and Check tells how it ended", async () => {
    vi.stubGlobal("fetch", (path: string, init?: RequestInit) => (path === SESSION("sign-in") ? Promise.reject(new TypeError("Load failed")) : server.fetch(path, init)));
    const card = await cardOf();
    press(card, "Sign in");
    expect(await within(card).findByText(/The page lost its connection to Orbit Control while it waited for the sign-in/)).toBeTruthy();
    expect(within(card).queryByText(/Is it still running/)).toBeNull();
    reports.state.auth.state = "authenticated";
    press(card, "Check");
    expect(await within(card).findByText("Signed in")).toBeTruthy();
    expect(within(card).queryByText(/lost its connection/), "the answer that follows replaces it").toBeNull();
  });

  it("the engine's own stop codes become the state they mean: sign-in required, program missing -- any other is a failure", async () => {
    reports.state.auth.stop = { status: 503, code: "AUTH_LOGIN_REQUIRED", message: "no one has signed in for Orbit on this machine", next: "sign in" };
    const card = await cardOf();
    press(card, "Check");
    expect(await within(card).findByText("Sign-in required")).toBeTruthy();
    reports.state.auth.stop = { status: 503, code: "AUTH_TOOL_MISSING", message: "no usable program is available", next: "install it" };
    press(card, "Check");
    expect(await within(card).findByText("Program missing")).toBeTruthy();
    expect(within(card).getByText("Not until the program is here.")).toBeTruthy();
    reports.state.auth.stop = { status: 503, code: "AUTH_TENANT_AMBIGUOUS", message: "more than one directory" };
    press(card, "Check");
    expect(await within(card).findByText("Failed")).toBeTruthy();
    expect(within(card).queryByText(/^Next:/)).toBeNull();
  });

  it("a change is Saved against nothing but the options the strategy declares; until it is, no look or move is offered", async () => {
    const card = await cardOf();
    expect((within(card).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled, "nothing to save yet").toBe(true);
    fireEvent.change(within(card).getByLabelText("Directory (tenant)"), { target: { value: " contoso.example " } });
    fireEvent.click(within(card).getByRole("checkbox", { name: "Use a device code" }));
    expect(within(card).getByText(/Not saved yet/)).toBeTruthy();
    for (const name of ["Check", "Sign in", "Sign out"]) expect((within(card).getByRole("button", { name }) as HTMLButtonElement).disabled, `${name} acts on what is saved`).toBe(true);
    press(card, "Save");
    expect(await within(card).findByText("Saved.")).toBeTruthy();
    const put = server.calls.find((c) => c.method === "PUT" && c.path === "/api/v1/connections/azure-acme");
    expect([put?.body, put?.headers[TOKEN_HEADER]]).toEqual([{ auth: { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true } }, "tok-123"]);
    await waitFor(() => expect((within(card).getByRole("button", { name: "Check" }) as HTMLButtonElement).disabled).toBe(false));
    expect(within(card).getAllByText("Not checked yet"), "what was found about the old way in says nothing about the new").toHaveLength(2);
  });

  it("an option is held to the pattern its descriptor row declares: a bad one is said, and cannot be saved or signed in with", async () => {
    const card = await cardOf();
    fireEvent.change(within(card).getByLabelText("Directory (tenant)"), { target: { value: "--use-device-code" } });
    expect(await within(card).findByText("Not in the form Directory (tenant) takes.")).toBeTruthy();
    for (const name of ["Save", "Check", "Sign in"]) expect((within(card).getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true);
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("choosing the alternative shows its controls instead; a stored credential goes to the server once and is gone from the page, the cache and the storage", async () => {
    const card = await cardOf();
    fireEvent.click(within(card).getByRole("radio", { name: "Personal access token or environment variable" }));
    expect(within(card).queryByLabelText("Directory (tenant)")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(within(card).getByText(/Not saved yet/)).toBeTruthy();
    fireEvent.change(within(card).getByLabelText("Credential"), { target: { value: PAT } });
    fireEvent.click(within(card).getByRole("button", { name: "Store" }));
    expect(await within(card).findByText("Stored. It will not be shown again.")).toBeTruthy();
    expect(reports.received).toEqual([{ id: "azure-acme", body: { value: PAT } }]);
    expect((within(card).getByLabelText("Credential") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML.includes(PAT)).toBe(false);
    expect(JSON.stringify({ ...window.sessionStorage, ...window.localStorage }).includes(PAT)).toBe(false);
    press(card, "Save");
    await waitFor(() => expect(server.calls.find((c) => c.method === "PUT" && c.path === "/api/v1/connections/azure-acme")?.body).toEqual({ auth: { strategy: "credential" } }));
    expect(await screen.findByText("Stored in this machine's OS secret store")).toBeTruthy();
  });

  it("the Source row is what the last test found: accepted, or not -- and a sign-in forgets it", async () => {
    const accepted: ConnectionTest = { at: "2026-09-25T06:35:58Z", ok: true, identity: "Lan Nguyen", checks: [{ id: "authentication", status: "ok", permission: null, message: "signed in as Lan Nguyen" }] };
    reports.connections.set("azure-acme", signingIn("azure-acme", { lastTest: accepted }));
    const card = await cardOf();
    expect(within(card).getByText(/Accepted it · .* · as Lan Nguyen/)).toBeTruthy();
    press(card, "Sign in");
    expect(await within(card).findByText("Signed in")).toBeTruthy();
    expect(await within(card).findByText(/Not tested since the last change/)).toBeTruthy();
  });

  it("a person without the token can read the session and press nothing", async () => {
    window.sessionStorage.clear();
    const card = await cardOf();
    for (const name of ["Check", "Sign in", "Sign out", "Save"]) expect((within(card).getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true);
  });

  it("a connection whose provider offers one way in -- the credential -- shows no choice and no sign-in: just its controls", async () => {
    const card = await cardOf("/connections/github-acme");
    expect(within(card).queryByRole("radio")).toBeNull();
    expect(within(card).getByLabelText("Credential")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("nothing in the card or its words names a vendor, a program or a provider: the descriptor says which", () => {
    const sources = import.meta.glob<string>(["./AuthenticationCard.tsx", "./SignInPanel.tsx", "./authWords.ts"], { query: "?raw", import: "default", eager: true });
    expect(Object.keys(sources)).toHaveLength(3);
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/azure|microsoft|entra|github|devops|\baz\b/i);
  });
});

describe("What the words say", () => {
  const found = (over: Partial<AuthTool>): AuthTool => ({ ...OWN_COPY, ...over });

  it("the program: not checked, Orbit's own copy, the machine's used as a program only, or missing -- with whether Orbit can fetch its own", () => {
    expect(programWords(undefined).label).toBe("Not checked yet");
    expect(programWords(found({ version: "v2.91.0" }))).toMatchObject({ label: "Installed v2.91.0", tone: "success", says: "Orbit's own copy." });
    expect(programWords(found({ source: "system" })).says).toMatch(/used as a program only.*NOT used/);
    expect(programWords(found({ found: false, version: null, source: null, acquirable: "x" }))).toMatchObject({ label: "Program missing", tone: "danger" });
    expect(programWords(found({ found: false, acquirable: "x" })).says).toMatch(/can install its own copy/);
    expect(programWords(found({ found: false, acquirable: null })).says).toMatch(/cannot install its own copy/);
  });

  it("the session: one state per row, no access-token expiry anywhere, and a stop code is the state it means", () => {
    expect(sessionView(undefined, null).signIn?.label).toBe("Not checked yet");
    expect(sessionView({ strategy: "s", state: "authenticated", tool: OWN_COPY }, null)).toMatchObject({ missing: false, signIn: { label: "Signed in" }, program: { label: "Installed v2.91.0" } });
    expect(sessionView({ strategy: "s", state: "tool-missing" }, null)).toMatchObject({ missing: true, signIn: null });
    expect(sessionView({ strategy: "s", state: "something-new" }, null).signIn?.label).toBe("Failed");
    const stop = (code: string) => sessionView(undefined, new ApiError(503, code, "said", [], "next"));
    expect([stop("AUTH_LOGIN_REQUIRED").signIn?.label, stop("AUTH_TOOL_UNSUPPORTED").missing, stop("AUTH_TOKEN_FAILED").signIn?.label, stop("AUTH_TOKEN_FAILED").program]).toEqual(["Sign-in required", true, "Failed", null]);
    expect(sessionView(undefined, new Error("offline")).signIn?.label).toBe("Failed");
  });

  it("the source: what the last test says about the way in -- accepted, refused, or never asked", () => {
    const test = (over: Partial<ConnectionTest>): ConnectionTest => ({ at: new Date().toISOString(), ok: true, identity: null, checks: [{ id: "authentication", status: "ok", permission: null, message: null }], ...over });
    expect(sourceWords(undefined)).toMatch(/Not tested since the last change/);
    expect(sourceWords(test({ identity: "Lan" }))).toMatch(/^Accepted it · .* · as Lan$/);
    expect(sourceWords(test({ ok: false }))).toMatch(/Accepted it, but something this report reads is not readable/);
    expect(sourceWords(test({ ok: false, checks: [{ id: "authentication", status: "forbidden", permission: null, message: "the account may not read this" }] }))).toMatch(/^Did not accept it: the account may not read this/);
    expect(sourceWords(test({ ok: false, checks: [] }))).toMatch(/^The last test failed/);
  });

  it("a connection's way in, in a list: the strategy it signs in with, never 'No credential set'; a credential says where it comes from", () => {
    const azure = PROVIDERS[1];
    expect(authLine(signingIn("a"), azure)).toBe("Microsoft sign-in");
    expect(authLine(signingIn("a"), undefined), "before the providers are known it is still not a missing credential").toBe("azure-cli");
    expect(authLine(signingIn("a", { auth: { strategy: "credential" } }), azure)).toBe("No credential set");
    expect(authLine(signingIn("a", { auth: { strategy: "credential" }, credential: { set: true, from: "env", name: "ADO_PAT" } }), azure)).toBe("From the environment variable ADO_PAT");
  });

  it("a choice is what the strategy declares and a person filled in: trimmed, nothing blank, nothing undeclared, the same whatever the key order", () => {
    const broker: AuthStrategy = required(strategiesOf(PROVIDERS[1])[0], "the sign-in strategy");
    expect(choiceOf(broker, { tenant: " contoso.example ", deviceCode: false, nope: "x" })).toEqual({ strategy: "azure-cli", tenant: "contoso.example" });
    expect(choiceOf(broker, { tenant: "  ", deviceCode: true })).toEqual({ strategy: "azure-cli", deviceCode: true });
    expect(sameChoice({ strategy: "a", tenant: "t", deviceCode: true }, { deviceCode: true, tenant: "t", strategy: "a" })).toBe(true);
    expect(sameChoice({ strategy: "a", deviceCode: false }, { strategy: "a" }), "an unticked box is no option").toBe(true);
    expect(sameChoice({ strategy: "a", tenant: "t" }, { strategy: "a" })).toBe(false);
    const tenant = required(broker.options?.[0], "the tenant option");
    expect([optionProblem(tenant, "contoso.example"), optionProblem(tenant, ""), optionProblem(tenant, "-x"), optionProblem(tenant, "x".repeat(201))]).toEqual([null, null, "Not in the form Directory (tenant) takes.", "Not in the form Directory (tenant) takes."]);
  });
});
