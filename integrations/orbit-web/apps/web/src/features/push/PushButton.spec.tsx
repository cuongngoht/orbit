import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";
import { resetOperatorStore } from "../../services/operator";
import { fakeApi } from "../../testing/fakeApi";
import { approval, CSRF, FINGERPRINT, governanceState, SESSION_ID, sessionDetail } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { PushButton } from "./PushButton";

beforeEach(() => resetOperatorStore());

describe("Push branch", () => {
  test("is not offered for a chat with no repository", () => {
    fakeApi();
    renderLive(<PushButton session={sessionDetail({ source: null, repository: null, branch: null })} compact={false} />);
    expect(screen.queryByRole("button", { name: "Push branch" })).toBeNull();
  });

  test("without an operator signed in, it says why and where to sign in -- and asks for nothing", async () => {
    const api = fakeApi().on("GET", "/api/operator/state", () => governanceState("none"));
    renderLive(<PushButton session={sessionDetail({ source: "github", repository: "octo/sum-fixture", workBranch: "orbit-web/0b6c2f5e" })} compact={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Push branch" }));
    expect(await screen.findByText(/Pushing is a protected action/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Governance" }).getAttribute("href")).toBe("#/governance/overview");
    expect(api.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  test("an operator prepares the exact push of the chat's branch -- to Azure DevOps too -- and approves it there", async () => {
    const api = fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", `/api/sessions/${SESSION_ID}/pushes`, () => ({ approvals: [] }))
      .on("POST", `/api/sessions/${SESSION_ID}/push`, () => ({ approvalId: "apr-1", state: "pending", fingerprint: FINGERPRINT, decision: { decisionId: "dec-1", verdict: "require_approval", reasonCodes: ["RULE_MATCHED"], enforcement: "boundary", policyRevision: "rev-1" }, message: "…", approval: approval({ summary: "Push aaaaaaaaaaaa to orbit-web/0b6c2f5e of Fabrikam/Web (Azure DevOps): 1 commit(s), 1 file(s)" }) }))
      .on("POST", "/api/governance/approvals/apr-1/grant", () => approval({ state: "consumed", outcome: "pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e" }));
    renderLive(<PushButton session={sessionDetail({ source: "azure", repository: "Fabrikam/Web", workBranch: "orbit-web/0b6c2f5e" })} compact={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Push branch" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Azure DevOps/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Prepare the push" }));
    expect(await within(dialog).findByText(FINGERPRINT)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and push" }));
    expect(await within(dialog).findByText("pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e")).toBeTruthy();
    await waitFor(() => {
      const grant = api.calls.find((c) => c.path === "/api/governance/approvals/apr-1/grant");
      expect(grant?.body).toEqual({ fingerprint: FINGERPRINT });
      expect(grant?.headers["x-orbit-operator-csrf"]).toBe(CSRF);
    });
  });

  test("where the Constitution simply allows git, the push is made at once: nothing waits for an approval", async () => {
    const api = fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", `/api/sessions/${SESSION_ID}/pushes`, () => ({ approvals: [] }))
      .on("POST", `/api/sessions/${SESSION_ID}/push`, () => ({ approvalId: null, state: "pushed", fingerprint: FINGERPRINT, decision: { decisionId: "dec-1", verdict: "allow", reasonCodes: ["RULE_MATCHED"], enforcement: "boundary", policyRevision: "rev-1" }, message: "Pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e of origin: the Constitution in effect allows it, so nobody was asked.", approval: null }));
    renderLive(<PushButton session={sessionDetail({ source: "github", repository: "octo/sum-fixture", workBranch: "orbit-web/0b6c2f5e" })} compact={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Push branch" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Prepare the push" }));
    expect(await within(dialog).findByText(/the Constitution in effect allows it, so nobody was asked/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Prepare the push" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Approve and push" })).toBeNull();
    expect(api.calls.filter((c) => c.path.startsWith("/api/governance/approvals"))).toEqual([]);
  });
});
