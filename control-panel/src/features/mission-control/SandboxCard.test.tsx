// A task's SANDBOX on its page, through the whole app: what the runtime says about it, shown as it said it;
// Stop and Release asked about first, sent once as a person's `{ human: true }` and never shown done before
// the server answers; a location that cannot be checked said plainly, with a Retry that sends only where to
// ask; a session's output inline, read once; and no button that starts, restarts or builds anything.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../shared/api/client";
import { M_CHECKOUT, M_KEY, MOVED_TREE, OTHER_SESSION, SANDBOX_ENV, SANDBOX_SESSION, SOURCE_TREE, TASK, TASK_API, TASK_PAGE, fakeMission, sandboxView } from "../../testing/fakeMission";
import { DB_ID, fakeRuntime } from "../../testing/fakeRuntime";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";
import { elementOf, required } from "../../testing/required";

let mission: ReturnType<typeof fakeMission>;
let server: ReturnType<typeof fakeServer>;

const AT = { key: M_KEY, checkout: M_CHECKOUT };
const RETRY = `/api/v1/projects/${M_KEY}/checkouts/${M_CHECKOUT}/runtime/connectivity/${DB_ID}/retry`;

type Fetch = typeof server.fetch;

// The mission fake answers the task and its sandbox; the runtime fake, at the same checkout, answers Retry.
// `wrap` stands between the page and both, for a test that must hold an answer back.
function serve(over: Parameters<typeof fakeMission>[0] = {}, wrap: (fetch: Fetch) => (path: string, init?: RequestInit) => Promise<Response> = (f) => f) {
  mission = fakeMission(over);
  const runtime = fakeRuntime({ target: true, at: AT });
  server = fakeServer(undefined, (call) => mission.handle(call) ?? runtime.handle(call));
  vi.stubGlobal("fetch", wrap(server.fetch));
}

beforeEach(() => {
  serve();
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

// Fluent marks a dialog aria-hidden while it settles which layer is modal: read it with hidden: true.
const modal = () => screen.findByRole("alertdialog", { hidden: true });
const inModal = async (name: string) => within(await modal()).getByRole("button", { name, hidden: true });
const posts = () => server.calls.filter((c) => c.method !== "GET");
const gets = (path: string) => server.calls.filter((c) => c.method === "GET" && c.path === path).length;
const SANDBOX_PATH = `${TASK_API}/sandbox`;

const card = (title: string) => required(screen.getByRole("heading", { name: title }).closest<HTMLElement>("section"), `the ${title} card`);

// The card, once it has answered one way or the other.
async function sandbox() {
  await screen.findByRole("heading", { name: "Sandbox" });
  await waitFor(() => expect(within(card("Sandbox")).queryByText(/Reading the task/)).toBeNull());
  return card("Sandbox");
}

// The value a description list gives a term: what a person reads next to the label.
const fact = (scope: HTMLElement, term: string) => within(scope).getByText(term, { selector: "dt" }).nextElementSibling?.textContent ?? "";

const button = (scope: HTMLElement, name: string) => elementOf(within(scope).getByRole("button", { name }), HTMLButtonElement, name);

describe("Sandbox card", () => {
  it("shows what the runtime says about the sandbox -- state, owner, trees, execution, ownership, data -- and asks for it exactly once", async () => {
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    expect(within(sbx).getAllByText("READY")).toHaveLength(2);
    expect(within(sbx).getByText("built from the task's current source tree").previousElementSibling?.textContent).toBe("READY");
    expect(within(sbx).getByText(`Owned by ${TASK}`)).toBeTruthy();
    expect([fact(sbx, "Environment"), fact(sbx, "Workspace"), fact(sbx, "Running tree"), fact(sbx, "Current tree")]).toEqual([SANDBOX_ENV, "ws-0123456789ab", SOURCE_TREE.slice(0, 12), SOURCE_TREE.slice(0, 12)]);
    expect(fact(sbx, "Execution")).toBe("node:web: Host (native) · dotnet:api: Dev Container");
    expect(fact(sbx, "Ownership")).toMatch(/1 process\(es\) and 1 container\(s\).*0 other\(s\) found there and never touched/);
    expect(fact(sbx, "Data isolation")).toBe("shared-development — Orders database is a shared development server");
    const rows = within(within(sbx).getByRole("table", { name: "Sandbox components" })).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows[0]).toMatch(/node:web.*Host \(native\).*RUNNING.*READY.*http:\/\/127\.0\.0\.1:42017/);
    expect(rows[1]).toMatch(/dotnet:api.*Dev Container.*RUNNING.*NOT_READY.*http:\/\/127\.0\.0\.1:5001/);
    expect(gets(SANDBOX_PATH)).toBe(1);
    expect(posts()).toEqual([]);
  });

  it("shows an endpoint as text, never a link to a server", async () => {
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    expect(within(sbx).getByText("http://127.0.0.1:42017").closest("a")).toBeNull();
    expect(sbx.querySelectorAll("a[href]")).toHaveLength(0);
  });

  it("a stale sandbox says which tree it runs and which the task holds, that the agent's next start-sandbox rebuilds it, and has no Start, Restart or Build button", async () => {
    serve({ sandbox: sandboxView({ state: "STALE", stale: true, currentTree: MOVED_TREE, because: "the workspace moved after this sandbox was built from it" }) });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    expect(within(sbx).getByText("STALE")).toBeTruthy();
    const notice = required(within(sbx).getByText(/This sandbox runs older code than the task holds now/).parentElement, "the stale notice").textContent ?? "";
    expect(notice).toContain(SOURCE_TREE.slice(0, 12));
    expect(notice).toContain(MOVED_TREE.slice(0, 12));
    expect(notice).toMatch(/next start-sandbox rebuilds it/);
    expect(fact(sbx, "Running tree")).toBe(SOURCE_TREE.slice(0, 12));
    expect(fact(sbx, "Current tree")).toBe(MOVED_TREE.slice(0, 12));
    expect(within(sbx).queryAllByRole("button", { name: /restart|start|rebuild|build|prepare/i })).toEqual([]);
  });

  it("Stop asks first and posts nothing until it is confirmed; then exactly one POST with { human: true } and the token, nothing reads stopped before the answer, and the queries are read again", async () => {
    let answer: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { answer = resolve; });
    serve({}, (fetch) => async (path, init) => {
      if (init?.method === "POST") await gate;
      return fetch(path, init);
    });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    fireEvent.click(button(sbx, "Stop sandbox"));
    expect(await modal()).toBeTruthy();
    expect(within(await modal()).getByText(/Only the processes and containers Orbit can prove it started for this task are ended/)).toBeTruthy();
    expect(posts()).toEqual([]);
    fireEvent.click(await inModal("Cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(posts()).toEqual([]);
    fireEvent.click(button(sbx, "Stop sandbox"));
    fireEvent.click(await inModal("Stop the sandbox"));
    expect(within(sbx).getAllByText("RUNNING")).toHaveLength(2);
    expect(within(sbx).queryByText("STOPPED")).toBeNull();
    answer();
    await waitFor(() => expect(within(card("Sandbox")).getAllByText("STOPPED")).toHaveLength(2));
    expect(posts()).toHaveLength(1);
    const post = required(posts()[0], "the one POST");
    expect([post.method, post.path, post.body, post.headers[TOKEN_HEADER]]).toEqual(["POST", `${SANDBOX_PATH}/stop`, { human: true }, "tok-123"]);
    await waitFor(() => expect(gets(SANDBOX_PATH)).toBeGreaterThan(1));
  });

  it("releasing a sandbox somebody released already is refused in the server's words, and shown in the card", async () => {
    serve({ releasedElsewhere: true });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    fireEvent.click(button(sbx, "Release sandbox"));
    fireEvent.click(await inModal("Release the sandbox"));
    expect(await within(card("Sandbox")).findByText(`${SANDBOX_ENV} was released already`)).toBeTruthy();
    expect(within(card("Sandbox")).getByText("The sandbox was not released")).toBeTruthy();
    expect(posts().map((c) => c.path)).toEqual([`${SANDBOX_PATH}/release`]);
  });

  it("a released sandbox says so and offers nothing to stop or release", async () => {
    serve({ sandbox: sandboxView({ state: "RELEASED", components: [], leases: [], ownership: { processes: 0, containers: 0, external: 0 } }) });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    expect(within(sbx).getByText("RELEASED")).toBeTruthy();
    expect(button(sbx, "Stop sandbox").disabled).toBe(true);
    expect(button(sbx, "Release sandbox").disabled).toBe(true);
  });

  it("a location that could not be checked says so, names that Orbit controls no VPN, and its Retry sends only where to ask", async () => {
    const asked = "2026-10-06T21:12:00.000Z";
    serve({ sandbox: sandboxView({ connectivity: [{ target: DB_ID, from: "native", state: "REACHABLE", because: "db.internal:1433 accepted a connection", checkedAt: asked, stale: false }, { target: DB_ID, from: "devcontainer", state: "BLOCKED", because: "the environment is not up: there is no container to ask from", checkedAt: asked, stale: true }] }) });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    expect(within(sbx).getByText(/VPN or a route this machine does not have/)).toBeTruthy();
    expect(within(sbx).getByText(/Orbit controls no VPN/)).toBeTruthy();
    fireEvent.click(button(sbx, `Retry ${DB_ID} from Dev Container`));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const post = required(posts()[0], "the retry");
    expect([post.path, post.body, post.headers[TOKEN_HEADER]]).toEqual([RETRY, { provider: "devcontainer" }, "tok-123"]);
  });

  it("Show logs reads a session's output once, inline and in a log region, and nothing polls it", async () => {
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    fireEvent.click(button(sbx, "Show logs of node:web"));
    const log = await within(sbx).findByRole("log", { name: "Output of node:web" });
    expect(log.textContent).toBe("listening on 42017\nGET /health 200");
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull();
    const path = `${SANDBOX_PATH}/logs/${SANDBOX_SESSION}?stream=out`;
    expect(gets(path)).toBe(1);
    await new Promise((done) => setTimeout(done, 100));
    expect(gets(path)).toBe(1);
    fireEvent.click(button(sbx, "Reload"));
    await waitFor(() => expect(gets(path)).toBe(2));
    fireEvent.click(button(sbx, "Hide logs of node:web"));
    expect(within(sbx).queryByRole("log")).toBeNull();
    expect(server.calls.some((c) => c.path.includes(OTHER_SESSION))).toBe(false);
  });

  it("without the page's token every change is disabled and nothing is posted", async () => {
    window.sessionStorage.clear();
    serve({ sandbox: sandboxView({ connectivity: [{ target: DB_ID, from: "devcontainer", state: "BLOCKED", because: "not up", checkedAt: null, stale: true }] }) });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    for (const name of ["Stop sandbox", "Release sandbox", `Retry ${DB_ID} from Dev Container`]) {
      const pressed = button(sbx, name);
      expect(pressed.disabled, name).toBe(true);
      fireEvent.click(pressed);
    }
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull();
    expect(posts()).toEqual([]);
  });

  it("a task that asked for no sandbox says so and shows no button", async () => {
    serve({ sandbox: null });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    expect(within(sbx).getByText(/This task has no sandbox/)).toBeTruthy();
    expect(within(sbx).queryAllByRole("button")).toEqual([]);
  });

  it("a refusal to read the sandbox is shown in the card, and the rest of the page is untouched", async () => {
    serve({ sandboxRefused: true });
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    expect(await within(sbx).findByText(`${SANDBOX_ENV} is not ${TASK}'s sandbox: it belongs to another task`)).toBeTruthy();
    expect(within(sbx).getByText("Could not read this task's sandbox")).toBeTruthy();
    expect(card("Current state")).toBeTruthy();
    expect(screen.getAllByText(/belongs to another task/)).toHaveLength(1);
  });

  it("no path of the machine is in the card's words -- not a workspace, a log file or a checkout", async () => {
    renderApp(TASK_PAGE);
    const sbx = await sandbox();
    fireEvent.click(button(sbx, "Show logs of node:web"));
    await within(sbx).findByRole("log");
    expect(sbx.textContent ?? "").not.toMatch(/\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\|workspaces\/|\.log\b/);
  });
});
