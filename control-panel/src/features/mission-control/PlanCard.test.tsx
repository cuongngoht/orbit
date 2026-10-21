// A coordinated workflow's PLAN on its task page (0.0.4): the steps, and under the playbook step the run its declared
// workflow made -- the pinned version, each step's word, the provider it went through and the receipts it rests on --
// shown exactly as the server projected them. Nothing reported is shown as verified, and a task that is no workflow
// asks for no plan at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { TASK_PAGE, fakeMission, pbi482View, workflowPlan } from "../../testing/fakeMission";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";
import { required } from "../../testing/required";

let mission: ReturnType<typeof fakeMission>;

function serve(over: Parameters<typeof fakeMission>[0] = {}) {
  mission = fakeMission(over);
  const server = fakeServer(undefined, (call) => mission.handle(call));
  vi.stubGlobal("fetch", server.fetch);
}

const workflowView = () => ((v) => ({ ...v, task: { ...v.task, provider: "automation" } }))(pbi482View());

beforeEach(() => {
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const card = (title: string) => required(screen.getByRole("heading", { name: title }).closest<HTMLElement>("section"), `the ${title} card`);

describe("Plan card", () => {
  it("shows the plan's steps and the declared run under its playbook step, in the server's words", async () => {
    serve({ view: workflowView(), plan: workflowPlan() });
    renderApp(TASK_PAGE);
    await screen.findByRole("heading", { name: "Plan" });
    await waitFor(() => expect(within(card("Plan")).getByText(/plan-1 \(playbook\) · 2 step\(s\) · goal goal-0123456789ab gu-11111111/)).toBeTruthy());
    const plan = card("Plan");
    expect(within(plan).getByText("playbook")).toBeTruthy();
    const run = within(plan).getByLabelText("Skill run srun-0123456789ab");
    expect(within(run).getByText("Skill release-readiness-verification")).toBeTruthy();
    expect(within(run).getByText("release-readiness-verification:0.1.0:7c195e58")).toBeTruthy();
    expect(within(run).getAllByText("CONTRACT_MET")).toHaveLength(2);
    expect(within(run).getAllByText(/reported, not proven/)).toHaveLength(2);
    expect(within(run).getByText("managed:corp")).toBeTruthy();
    expect(within(run).getByText("invocation:srun-0123456789ab.notes.2")).toBeTruthy();
    expect(within(plan).queryByText("VERIFIED"), "nothing a call answered is shown as verified").toBeNull();
  });

  it("asks for no plan for a task that is no workflow", async () => {
    serve({ plan: workflowPlan() });
    renderApp(TASK_PAGE);
    await screen.findByRole("heading", { name: "Readiness" });
    expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull();
    expect(mission.state.planReads).toBe(0);
  });

  it("says when the run's workflow could not be read, instead of drawing steps it does not know", async () => {
    const plan = workflowPlan();
    serve({ view: workflowView(), plan: { ...plan, runs: plan.runs.map((r) => ({ ...r, unread: true })) } });
    renderApp(TASK_PAGE);
    await screen.findByText(/Its workflow could not be read/);
  });
});
