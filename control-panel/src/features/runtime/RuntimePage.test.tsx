// One checkout's runtime through the whole app: what is understood, how each component would run
// here, what is running and whether it answers, the optional environment, and what a person chose.
// What is promised: reading changes nothing; every change carries the token and acts on the
// checkout the ADDRESS names; adopting is a person's, confirmed, and refused when stale; settings
// name the revision they read; and nothing on the page says a runtime is verified.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../shared/api/client";
import { CHECKOUT, DB, DB_ID, KEY, OTHER_CHECKOUT, PAGE_PATH, PROPOSAL, RUNTIME_PATH, SANDBOX_DEFAULTS, fakeRuntime } from "../../testing/fakeRuntime";
import { fakeServer, reply } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";
import { elementOf, fieldOf } from "../../testing/required";
import type { ComponentSetting } from "./runtime.types";

let runtime: ReturnType<typeof fakeRuntime>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  runtime = fakeRuntime();
  server = fakeServer(undefined, runtime.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const posts = () => server.calls.filter((c) => c.method !== "GET");

describe("Runtime", () => {
  it("says what is understood and how each component would run here, with the reason for every one", async () => {
    renderApp(PAGE_PATH);
    expect(await screen.findByRole("heading", { name: "Understanding" })).toBeTruthy();
    expect(screen.getByText(/9 fact\(s\), read/)).toBeTruthy();
    const components = within(screen.getByRole("table", { name: "Components" }));
    expect(components.getByText("can start here")).toBeTruthy();
    expect(components.getByText("blocked")).toBeTruthy();
    expect(screen.getByText("the classic .NET Framework runs on Windows only")).toBeTruthy();
    expect(screen.getByText(/Part of it can start here/)).toBeTruthy();
    expect(screen.getAllByText("Ways to run it").length).toBe(2);
  });

  it("shows the operating systems as a matrix per component, never one word for the project, with the evidence beside it", async () => {
    renderApp(PAGE_PATH);
    const table = await screen.findByRole("table", { name: "Operating systems" });
    expect(within(table).getByLabelText("dotnet:legacy on macOS: no, .NET Framework (classic) can only be met on Windows")).toBeTruthy();
    expect(within(table).getByLabelText("dotnet:legacy on Windows: yes")).toBeTruthy();
    expect(within(table).getByLabelText("node:web on Linux: yes")).toBeTruthy();
    expect(screen.getByText(/Built or run on Linux, Windows \(\.github\/workflows\/ci\.yml\): where somebody runs it, not what it requires/)).toBeTruthy();
    expect(screen.getByText("dotnet:legacy: no on Linux, macOS — .NET Framework (classic) can only be met on Windows")).toBeTruthy();
  });

  it("reading changes nothing: every call it made was a GET", async () => {
    renderApp(PAGE_PATH);
    await screen.findByRole("heading", { name: "Understanding" });
    expect(posts()).toEqual([]);
  });

  it("choosing another checkout is navigation: the address changes and nothing is written", async () => {
    const router = renderApp(PAGE_PATH);
    await screen.findByRole("heading", { name: "Understanding" });
    fireEvent.change(screen.getByLabelText("Checkout"), { target: { value: OTHER_CHECKOUT } });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${KEY}/checkouts/${OTHER_CHECKOUT}/runtime`));
    expect(posts()).toEqual([]);
  });

  it("an address that names a project nobody registered says so in the server's words", async () => {
    renderApp("/projects/repo-zzzz/checkouts/abc/runtime");
    expect(await screen.findByText("no project and checkout like that is known on this machine")).toBeTruthy();
  });

  it("says what could be checked now -- and that it is not a verdict", async () => {
    renderApp(PAGE_PATH);
    const table = await screen.findByRole("table", { name: "Verification" });
    expect(within(table).getByText("A browser can drive it")).toBeTruthy();
    expect(within(table).getAllByText("blocked").length).toBeGreaterThan(0);
    expect(screen.getByText(/Not a verdict/)).toBeTruthy();
    expect(screen.getByText("vitest run")).toBeTruthy();
    expect(screen.queryByText(/healthy|passing/i)).toBeNull();
  });

  it("reads the checkout again with the token, on the checkout the address names", async () => {
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Read it again" }));
    expect(await screen.findByText(/CURRENT: what is kept still answers this/)).toBeTruthy();
    const call = posts()[0];
    expect([call?.method, call?.path, call?.body, call?.headers[TOKEN_HEADER]]).toEqual(["POST", `${RUNTIME_PATH}/discover`, {}, "tok-123"]);
  });

  it("without the page's token no change can be made", async () => {
    window.sessionStorage.removeItem("orbit.control.token");
    renderApp(PAGE_PATH);
    expect((await screen.findByRole("button", { name: "Read it again" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Start web" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(true);
  });

  it("starts one component by name, shows what the start did, and lists what is running as Orbit's own", async () => {
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Start web" }));
    expect(await screen.findByText(/started node:web \(pid 4242\)/)).toBeTruthy();
    expect(posts()[0]?.body).toEqual({ component: "node:web", wait: 30 });
    const table = await screen.findByRole("table", { name: "Running" });
    expect(within(table).getByText("Orbit's own")).toBeTruthy();
    expect(within(table).getByText("nothing says how to tell")).toBeTruthy();
  });

  it("stops only what Orbit can prove is its own, by its session", async () => {
    runtime.state.status = { ...runtime.state.status, sessions: [{ id: "rs-0123456789ab", component: "node:web", provider: "native", state: "RUNNING", ownership: "ORBIT_OWNED", why: "proven", pid: 4242, startedAt: "2026-10-03T09:10:00.000Z", ports: [], readiness: { state: "READY", probe: { kind: "tcp", target: 5173, source: "human" } } }, { id: "rs-aaaaaaaaaaaa", component: "dotnet:legacy", provider: "native", state: "RUNNING", ownership: "EXTERNAL", why: "no receipt", pid: 77, startedAt: null, ports: [], readiness: { state: "NOT_RUNNING" } }] };
    renderApp(PAGE_PATH);
    const table = await screen.findByRole("table", { name: "Running" });
    expect(within(table).getAllByRole("button", { name: /^Stop / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Stop node:web"]);
    fireEvent.click(within(table).getByRole("button", { name: "Stop node:web" }));
    await waitFor(() => expect(posts()[0]?.path).toBe(`${RUNTIME_PATH}/stop`));
    expect(posts()[0]?.body).toEqual({ session: "rs-0123456789ab" });
  });

  it("a start that reused a server somebody else runs says so, and offers no way to stop it", async () => {
    runtime.state.reused = [{ component: "node:web", provider: "native", ownership: "EXTERNAL", readiness: { state: "READY", probe: { kind: "tcp", target: 5173, source: "human" } }, because: "an external server answered as the component should" }];
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Start web" }));
    const note = await screen.findByRole("list", { name: "What the start did" });
    expect(within(note).getByText("reused node:web: already running and not Orbit's, it answers (tcp 5173) — never stopped by Orbit")).toBeTruthy();
  });

  it("a server answering as a component should and not Orbit's is shown as reused, with no Stop beside it", async () => {
    runtime.state.status = { ...runtime.state.status, external: [{ component: "node:web", provider: "native", ownership: "EXTERNAL", readiness: { state: "READY", probe: { kind: "tcp", target: 5173, source: "human" } } }] };
    renderApp(PAGE_PATH);
    const list = await screen.findByRole("list", { name: "Reused, not Orbit's" });
    expect(within(list).getByText("node:web: answers (tcp 5173)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop node:web" })).toBeNull();
  });

  it("a start that names no such component says so and keeps the page", async () => {
    renderApp(PAGE_PATH);
    await screen.findByRole("button", { name: "Start web" });
    runtime.state.status = { ...runtime.state.status, plan: { ...runtime.state.status.plan, components: runtime.state.status.plan.components.map((c) => ({ ...c, key: `${c.key}-renamed` })) } };
    fireEvent.click(screen.getByRole("button", { name: "Start web" }));
    expect(await screen.findByText('no component "node:web" is known here')).toBeTruthy();
  });
});

// Fluent's focus manager marks a dialog aria-hidden while it settles which layer is modal, and on a
// slow runner it has been seen not to settle for these first dialogs at all. What these tests prove is
// what the dialog SAYS and what each click does, so they read it whether or not that bookkeeping has
// caught up -- and a closed dialog must be GONE, not only hidden.
const modal = () => screen.findByRole("alertdialog", { hidden: true });
const inModal = async (name: string) => within(await modal()).getByRole("button", { name, hidden: true });

describe("Runtime environment", () => {
  it("shows the proposal as it is, writes nothing until a person adopts it, and says which files", async () => {
    renderApp(PAGE_PATH);
    expect(await screen.findByRole("heading", { name: `Proposal ${PROPOSAL}` })).toBeTruthy();
    expect(screen.getByLabelText("Contents of .devcontainer/devcontainer.json").textContent).toContain('"name": "shop"');
    expect(screen.getByText("the first build downloads an image")).toBeTruthy();
    expect(posts()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Adopt…" }));
    const dialog = await modal();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText(".devcontainer/devcontainer.json")).toBeTruthy();
    expect(posts()).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", hidden: true }));
    await waitFor(() => expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull());
    expect(posts()).toEqual([]);
  });

  it("adopting is relayed as a person's, to the proposal and the checkout the address names", async () => {
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Adopt…" }));
    fireEvent.click(await inModal("Adopt"));
    expect(await screen.findByText(/read back and verified/)).toBeTruthy();
    const call = posts()[0];
    expect([call?.path, fieldOf(call?.body, "human"), call?.headers[TOKEN_HEADER]]).toEqual([`${RUNTIME_PATH}/proposals/${PROPOSAL}/adopt`, true, "tok-123"]);
    expect(screen.getByText(/Adopted is not validated/)).toBeTruthy();
  });

  it("a proposal that stopped being true is refused with the server's sentence, and nothing is claimed adopted", async () => {
    runtime.state.staleProposal = true;
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Adopt…" }));
    fireEvent.click(await inModal("Adopt"));
    expect(await screen.findByText(/an environment file changed since this was designed/)).toBeTruthy();
    expect(screen.queryByText(/read back and verified/)).toBeNull();
  });

  it("designing an environment is asked for, and opens what it designed", async () => {
    runtime.state.status = { ...runtime.state.status, proposals: [] };
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Design an environment" }));
    expect(await screen.findByRole("heading", { name: `Proposal ${PROPOSAL}` })).toBeTruthy();
    expect(posts()[0]?.path).toBe(`${RUNTIME_PATH}/design`);
  });

  it("validating is confirmed first, because it builds an image and spends the machine", async () => {
    runtime.state.status = { ...runtime.state.status, proposals: [], instances: [{ id: "env-0123456789ab", name: "devcontainer", provider: "devcontainer", state: "ADOPTED", validation: null }] };
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Validate the environment" }));
    const dialog = await modal();
    expect(within(dialog).getByText(/spends this machine/)).toBeTruthy();
    expect(posts()).toEqual([]);
    expect(within(dialog).getByText(/initializeCommand/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Validate", hidden: true }));
    expect(await screen.findByText(/VALIDATED: the environment came up/)).toBeTruthy();
    const call = posts()[0];
    expect([call?.path, fieldOf(call?.body, "human")]).toEqual([`${RUNTIME_PATH}/validate`, true]);
  });
});

describe("Runtime settings", () => {
  it("saves a person's choices against the revision they read, and a readiness probe is the person's word", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("How to run it"), { target: { value: "native" } });
    fireEvent.change(screen.getByLabelText("Readiness probe for node:web"), { target: { value: "tcp" } });
    fireEvent.change(screen.getByLabelText("Readiness target for node:web"), { target: { value: "5173" } });
    fireEvent.change(screen.getByLabelText("Variable names for node:web"), { target: { value: "API_URL, FEATURE_FLAG" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    const call = posts().find((c) => c.method === "PUT");
    expect(call?.path).toBe(`${RUNTIME_PATH}/settings`);
    expect(call?.body).toEqual({ settings: { strategy: "native", reuseExternal: false, components: { "node:web": { env: ["API_URL", "FEATURE_FLAG"], readiness: { kind: "tcp", target: 5173 } } }, connectivity: { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }, targets: {} }, sandbox: SANDBOX_DEFAULTS }, revision: null });
  });

  it("places each component on its own, reuses only by a person's word, and names a server to reach -- saved exactly as chosen", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("Placement of node:web"), { target: { value: "devcontainer" } });
    fireEvent.change(screen.getByLabelText("Placement of dotnet:legacy"), { target: { value: "native" } });
    fireEvent.click(screen.getByRole("switch", { name: "Reuse a compatible server already running on this host" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a target" }));
    fireEvent.change(within(screen.getByRole("group", { name: "Target (no id yet)" })).getByLabelText("Id"), { target: { value: "orders-db" } });
    const target = within(screen.getByRole("group", { name: "Target orders-db" }));
    fireEvent.change(target.getByLabelText("Host"), { target: { value: " db.internal " } });
    fireEvent.change(target.getByLabelText("Port"), { target: { value: "1433" } });
    fireEvent.click(target.getByRole("checkbox", { name: "web" }));
    fireEvent.click(target.getByRole("checkbox", { name: "Host (native)" }));
    fireEvent.click(target.getByRole("switch", { name: "Check it before starting what requires it" }));
    fireEvent.change(within(target.getByRole("group", { name: "Retry policy of orders-db" })).getByLabelText("Timeout per attempt (ms)"), { target: { value: "5000" } });
    fireEvent.change(within(screen.getByRole("group", { name: "Retry policy" })).getByLabelText("Attempts"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    expect(posts().find((c) => c.method === "PUT")?.body).toEqual({
      settings: {
        strategy: "auto",
        reuseExternal: true,
        components: { "node:web": { provider: "devcontainer" }, "dotnet:legacy": { provider: "native" } },
        connectivity: { retry: { attempts: 5, intervalMs: 1000, timeoutMs: 3000 }, targets: { "orders-db": { label: "orders-db", host: "db.internal", port: 1433, protocol: "tcp", requiredBy: ["node:web"], checkFrom: ["devcontainer"], beforeStart: true, retry: { timeoutMs: 5000 } } } },
        sandbox: SANDBOX_DEFAULTS,
      },
      revision: null,
    });
  });

  it("calls the ways of running what a person calls them, and sends the engine's own words", async () => {
    renderApp(PAGE_PATH);
    const options = (label: string) => [...elementOf(screen.getByLabelText(label), HTMLSelectElement, label).options].map((o) => [o.value, o.text]);
    await screen.findByLabelText("How to run it");
    expect(options("How to run it")).toEqual([["auto", "Auto"], ["native", "Host (native)"], ["devcontainer", "Dev Container"]]);
    expect(options("Placement of node:web")).toEqual([["", "as chosen above"], ["native", "Host (native)"], ["devcontainer", "Dev Container"]]);
    expect(screen.getByText("Orbit reuses it only when expected readiness can be established. Orbit never stops an external server.")).toBeTruthy();
  });

  it("a server to reach is a host and a port: nothing can be typed that is a URL, a user, a password or a command", async () => {
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Add a target" }));
    const target = within(screen.getByRole("group", { name: "Target (no id yet)" }));
    const labels = target.getAllByRole("textbox").map((box) => box.getAttribute("id")).map((id) => document.querySelector(`label[for="${id}"]`)?.textContent ?? "");
    expect(labels.map((l) => l.replace(/\s*\*$/, ""))).toEqual(["Id", "Label", "Host", "Port", "Note", "Attempts", "Wait between attempts (ms)", "Timeout per attempt (ms)"]);
    expect(target.queryByLabelText(/url|user|password|credential|connection string|command/i)).toBeNull();
    expect(within(screen.getByRole("group", { name: "Retry policy" })).queryByLabelText(/url|user|password|credential|command/i)).toBeNull();
  });

  it("a target a person did not touch is saved as it was read -- its note and its own policy with it", async () => {
    runtime = fakeRuntime({ target: true });
    server = fakeServer(undefined, runtime.handle);
    vi.stubGlobal("fetch", server.fetch);
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("How to run it"), { target: { value: "native" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    const sent = fieldOf(fieldOf(fieldOf(posts().find((c) => c.method === "PUT")?.body, "settings"), "connectivity"), "targets");
    expect(sent).toEqual({ [DB_ID]: DB });
  });

  it("a saved target keeps its id, and removing one is saved as gone", async () => {
    runtime = fakeRuntime({ target: true });
    server = fakeServer(undefined, runtime.handle);
    vi.stubGlobal("fetch", server.fetch);
    renderApp(PAGE_PATH);
    const target = within(await screen.findByRole("group", { name: `Target ${DB_ID}` }));
    expect(target.queryByLabelText("Id")).toBeNull();
    fireEvent.click(target.getByRole("button", { name: `Remove target ${DB_ID}` }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    expect(fieldOf(fieldOf(fieldOf(posts().find((c) => c.method === "PUT")?.body, "settings"), "connectivity"), "targets")).toEqual({});
  });

  it("two targets under one id cannot be saved: one of them would be lost without a word", async () => {
    runtime = fakeRuntime({ target: true });
    server = fakeServer(undefined, runtime.handle);
    vi.stubGlobal("fetch", server.fetch);
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Add a target" }));
    fireEvent.change(within(screen.getByRole("group", { name: "Target (no id yet)" })).getByLabelText("Id"), { target: { value: DB_ID } });
    expect(screen.getByText(new RegExp(`Two targets are called ${DB_ID}`))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(true);
  });

  it("a stale save keeps the target a person typed", async () => {
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Add a target" }));
    fireEvent.change(within(screen.getByRole("group", { name: "Target (no id yet)" })).getByLabelText("Id"), { target: { value: "cache" } });
    fireEvent.change(within(screen.getByRole("group", { name: "Target cache" })).getByLabelText("Host"), { target: { value: "cache.internal" } });
    runtime.state.revision = "somebody-else";
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(/changed since they were read/)).toBeTruthy();
    expect(elementOf(within(screen.getByRole("group", { name: "Target cache" })).getByLabelText("Host"), HTMLInputElement, "Host").value).toBe("cache.internal");
  });

  it("a save that changed something says Saved -- even though the form is drawn afresh for the new revision", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("How to run it"), { target: { value: "native" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("How to run it") as HTMLSelectElement).value).toBe("native"));
    expect(screen.getByText("Saved.")).toBeTruthy();
  });

  it("only what can be STARTED is placed or required: a library is listed among the components, never in the settings", async () => {
    const lib = { ...runtime.state.status.plan.components[0], key: "node:lib", name: "lib", kind: "library", state: "not-startable" as const, provider: null, command: null, candidates: [] };
    runtime.state.status = { ...runtime.state.status, plan: { ...runtime.state.status.plan, components: [...runtime.state.status.plan.components, lib] } };
    renderApp(PAGE_PATH);
    expect(await screen.findByLabelText("Placement of node:web")).toBeTruthy();
    expect(screen.queryByLabelText("Placement of node:lib")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a target" }));
    expect(within(screen.getByRole("group", { name: "Target (no id yet)" })).queryByRole("checkbox", { name: "lib" })).toBeNull();
    expect(within(screen.getByRole("table", { name: "Components" })).getByText("lib")).toBeTruthy();
  });

  it("a stale save says so, and the person's draft is kept rather than replaced", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("How to run it"), { target: { value: "native" } });
    runtime.state.revision = "somebody-else";
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(/changed since they were read/)).toBeTruthy();
    expect((screen.getByLabelText("How to run it") as HTMLSelectElement).value).toBe("native");
  });

  it("loading the latest settings after a stale save shows what is there now, and the next save names THAT revision", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("How to run it"), { target: { value: "native" } });
    runtime.state.revision = "somebody-else";
    runtime.state.status = { ...runtime.state.status, settings: { ...runtime.state.status.settings, settings: { ...runtime.state.status.settings.settings, strategy: "devcontainer" }, revision: "somebody-else" } };
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load the latest settings" }));
    await waitFor(() => expect((screen.getByLabelText("How to run it") as HTMLSelectElement).value).toBe("devcontainer"));
    fireEvent.change(screen.getByLabelText("How to run it"), { target: { value: "auto" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    expect(posts().filter((c) => c.method === "PUT").map((c) => fieldOf(c.body, "revision"))).toEqual([null, "somebody-else"]);
  });

  it("a draft typed for one checkout is never shown on, or saved to, another", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("How to run it"), { target: { value: "native" } });
    fireEvent.change(screen.getByLabelText("Checkout"), { target: { value: OTHER_CHECKOUT } });
    await screen.findByText("no project and checkout like that is known on this machine");
    fireEvent.change(screen.getByLabelText("Checkout"), { target: { value: CHECKOUT } });
    expect((await screen.findByLabelText("How to run it") as HTMLSelectElement).value).toBe("auto");
    expect(posts()).toEqual([]);
  });

  it("offers no command, no secret and no way to force a way of running", async () => {
    renderApp(PAGE_PATH);
    await screen.findByLabelText("How to run it");
    expect(screen.queryByLabelText(/command to run/i)).toBeNull();
    expect(screen.queryByRole("switch", { name: /force/i })).toBeNull();
    expect(screen.getByText(/never make one work that does not/)).toBeTruthy();
    expect(CHECKOUT).toHaveLength(32);
  });
});

// How a sandbox tells a component its port: a person's word in the Settings card, saved through the same
// save as every other setting, as exactly the override the engine reads -- and the engine judges it.
describe("Runtime settings: how a sandbox tells a component its port", () => {
  const putBody = () => posts().find((c) => c.method === "PUT")?.body;
  const sentPort = () => fieldOf(fieldOf(fieldOf(fieldOf(putBody(), "settings"), "components"), "node:web"), "port");
  const withPort = (port: ComponentSetting["port"]) => {
    const settings = runtime.state.status.settings;
    runtime.state.status = { ...runtime.state.status, settings: { ...settings, settings: { ...settings.settings, components: { "node:web": { port } } } } };
  };

  it("offers none, an argument or an environment variable for each component, and nothing is told by default", async () => {
    renderApp(PAGE_PATH);
    const select = elementOf(await screen.findByLabelText("Port of node:web"), HTMLSelectElement, "Port of node:web");
    expect([...select.options].map((o) => [o.value, o.text])).toEqual([["", "not told (keeps its own)"], ["argv", "an argument"], ["env", "an environment variable"]]);
    expect(select.value).toBe("");
    expect(screen.queryByLabelText("Port flag for node:web")).toBeNull();
  });

  it("an argument is saved as the flag, the format and -- before it, against the revision read", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("Port of node:web"), { target: { value: "argv" } });
    fireEvent.change(screen.getByLabelText("Port flag for node:web"), { target: { value: " --port " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Put -- before the port flag for node:web" }));
    expect(elementOf(screen.getByLabelText("Port format for node:web"), HTMLInputElement, "format").value).toBe("{port}");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    expect(posts().filter((c) => c.method === "PUT").map((c) => c.path)).toEqual([`${RUNTIME_PATH}/settings`]);
    expect(fieldOf(putBody(), "revision")).toBe(null);
    expect(sentPort()).toEqual({ override: { kind: "argv", flag: "--port", format: "{port}", after: "--" } });
  });

  it("choosing an argument starts with --port as a value, so saving at once never sends an empty flag", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("Port of node:web"), { target: { value: "argv" } });
    expect(elementOf(screen.getByLabelText("Port flag for node:web"), HTMLInputElement, "flag").value).toBe("--port");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    expect(sentPort()).toEqual({ override: { kind: "argv", flag: "--port", format: "{port}" } });
  });

  it("choosing an environment variable starts with PORT as a value", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("Port of node:web"), { target: { value: "env" } });
    expect(elementOf(screen.getByLabelText("Port variable for node:web"), HTMLInputElement, "name").value).toBe("PORT");
  });

  it("an environment variable is saved as its name and the format, and an emptied format is {port}", async () => {
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("Port of node:web"), { target: { value: "env" } });
    fireEvent.change(screen.getByLabelText("Port variable for node:web"), { target: { value: "PORT" } });
    fireEvent.change(screen.getByLabelText("Port format for node:web"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    expect(sentPort()).toEqual({ override: { kind: "env", name: "PORT", format: "{port}" } });
  });

  it("an override already saved is shown as it is, kept by a save that did not touch it, and removed by choosing none", async () => {
    withPort({ override: { kind: "argv", flag: "--port", format: "{port}", after: "--" } });
    renderApp(PAGE_PATH);
    expect(elementOf(await screen.findByLabelText("Port flag for node:web"), HTMLInputElement, "flag").value).toBe("--port");
    expect(elementOf(screen.getByRole("checkbox", { name: "Put -- before the port flag for node:web" }), HTMLInputElement, "dashes").checked).toBe(true);
    fireEvent.change(screen.getByLabelText("How to run it"), { target: { value: "native" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(runtime.state.revision).toBe("rev-1"));
    expect(sentPort()).toEqual({ override: { kind: "argv", flag: "--port", format: "{port}", after: "--" } });
    fireEvent.change(await screen.findByLabelText("Port of node:web"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(posts().filter((c) => c.method === "PUT")).toHaveLength(2));
    const second = fieldOf(fieldOf(posts().filter((c) => c.method === "PUT")[1]?.body, "settings"), "components");
    expect(second).toEqual({});
  });

  it("hints early what the engine would refuse, never blocks the save, and shows the engine's own refusal", async () => {
    server = fakeServer(undefined, (call) => (call.method === "PUT" && call.path === `${RUNTIME_PATH}/settings` ? reply(400, { error: { code: "RUNTIME_SETTINGS_INVALID", message: "node:web: an override's format holds {port} once, no credential, and on this machine's loopback when it is a URL" } }) : runtime.handle(call)));
    vi.stubGlobal("fetch", server.fetch);
    renderApp(PAGE_PATH);
    fireEvent.change(await screen.findByLabelText("Port of node:web"), { target: { value: "argv" } });
    fireEvent.change(screen.getByLabelText("Port flag for node:web"), { target: { value: "port" } });
    fireEvent.change(screen.getByLabelText("Port format for node:web"), { target: { value: "{port}{port}" } });
    expect(screen.getByText("A flag starts with - or --, e.g. --port.")).toBeTruthy();
    expect(screen.getByText("The format holds {port} once.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save settings" });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText(/an override's format holds \{port\} once/)).toBeTruthy();
    expect(screen.getByText("The settings were not saved")).toBeTruthy();
    expect(sentPort()).toEqual({ override: { kind: "argv", flag: "port", format: "{port}{port}" } });
  });
});

describe("Sandboxes", () => {
  it("lists what this checkout's tasks own, each owner a link to its task, reading starts nothing, and a lease nobody holds is said", async () => {
    runtime = fakeRuntime({ sandboxes: true });
    server = fakeServer(undefined, runtime.handle);
    vi.stubGlobal("fetch", server.fetch);
    renderApp(PAGE_PATH);
    const table = await screen.findByRole("table", { name: "Sandboxes" });
    const row = within(table).getAllByRole("row")[1];
    expect(row?.textContent).toMatch(/tsk-0123456789ab.*READY.*4b825dc642cb.*2.*42017/);
    const link = within(table).getByRole("link", { name: "tsk-0123456789ab" });
    expect(link.getAttribute("href")).toBe(`/mission-control/${KEY}/checkouts/${CHECKOUT}/tasks/tsk-0123456789ab`);
    expect(screen.getByText(/1 lease\(s\) nobody holds any more: 42033 \(node:web\)/)).toBeTruthy();
    expect(server.calls.filter((c) => c.path === `${RUNTIME_PATH}/sandboxes`)).toHaveLength(1);
    expect(posts()).toEqual([]);
  });

  it("says plainly when no task has a sandbox, and shows the policy beside it", async () => {
    renderApp(PAGE_PATH);
    expect(await screen.findByText("No task of this checkout has a sandbox.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sandbox policy" })).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /start|restart/i }).filter((b) => /sandbox/i.test(b.textContent ?? ""))).toEqual([]);
  });
});

