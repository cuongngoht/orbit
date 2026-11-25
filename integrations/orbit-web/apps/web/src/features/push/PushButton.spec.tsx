import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { approval, authSession, CSRF, FINGERPRINT, SESSION_ID, sessionDetail } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { PushButton } from "./PushButton";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

describe("Push branch", () => {
  test("is not offered for a chat with no repository", () => {
    fakeApi();
    renderLive(<PushButton session={sessionDetail({ source: null, repository: null, branch: null })} compact={false} />);
    expect(screen.queryByRole("button", { name: "Push branch" })).toBeNull();
  });

  test("a chat shared with this account is not its to push: it says whose it is, and asks for nothing", async () => {
    const api = fakeApi();
    renderLive(<PushButton session={sessionDetail({ source: "github", repository: "octo/sum-fixture", workBranch: "orbit-web/0b6c2f5e", access: "shared", owner: "alice@example.com" })} compact={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Push branch" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Only the account that owns this chat \(alice@example.com\) pushes it/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Prepare the push" })).toBeNull();
    expect(api.calls).toEqual([]);
  });

  test("the chat's owner prepares the exact push of its branch -- to Azure DevOps too -- and approves it there, with this browser session's CSRF token", async () => {
    const api = fakeApi()
      .on("GET", `/api/sessions/${SESSION_ID}/pushes`, () => ({ approvals: [] }))
      .on("POST", `/api/sessions/${SESSION_ID}/push`, () => ({ approvalId: "apr-1", state: "pending", fingerprint: FINGERPRINT, decision: { decisionId: "dec-1", verdict: "require_approval", reasonCodes: ["RULE_MATCHED"], enforcement: "boundary", policyRevision: "rev-1" }, message: "…", approval: approval({ summary: "Push aaaaaaaaaaaa to orbit-web/0b6c2f5e of Fabrikam/Web (Azure DevOps): 1 commit(s), 1 file(s)", requestedBy: "owner:x", requestedByType: "human" }) }))
      .on("POST", "/api/governance/approvals/apr-1/grant", () => approval({ state: "consumed", outcome: "pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e" }));
    renderLive(<PushButton session={sessionDetail({ source: "azure", repository: "Fabrikam/Web", workBranch: "orbit-web/0b6c2f5e" })} compact={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Push branch" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Azure DevOps/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Prepare the push" }));
    expect(await within(dialog).findByText(FINGERPRINT)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and push" }));
    expect(await within(dialog).findByText("pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e")).toBeInTheDocument();
    await waitFor(() => {
      const grant = api.calls.find((c) => c.path === "/api/governance/approvals/apr-1/grant");
      expect(grant?.body).toEqual({ fingerprint: FINGERPRINT });
      expect(grant?.headers["x-orbit-csrf"]).toBe(CSRF);
    });
    expect(api.calls.find((c) => c.path === `/api/sessions/${SESSION_ID}/push`)?.headers["x-orbit-csrf"]).toBe(CSRF);
  });

  test("where the account's policy simply allows git, the push is made at once: nothing waits for an approval", async () => {
    const api = fakeApi()
      .on("GET", `/api/sessions/${SESSION_ID}/pushes`, () => ({ approvals: [] }))
      .on("POST", `/api/sessions/${SESSION_ID}/push`, () => ({ approvalId: null, state: "pushed", fingerprint: FINGERPRINT, decision: { decisionId: "dec-1", verdict: "allow", reasonCodes: ["RULE_MATCHED"], enforcement: "boundary", policyRevision: "rev-1" }, message: "Pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e of origin: your policy allows it, so nobody was asked.", approval: null }));
    renderLive(<PushButton session={sessionDetail({ source: "github", repository: "octo/sum-fixture", workBranch: "orbit-web/0b6c2f5e" })} compact={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Push branch" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Prepare the push" }));
    expect(await within(dialog).findByText(/your policy allows it, so nobody was asked/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Prepare the push" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Approve and push" })).toBeNull();
    expect(api.calls.filter((c) => c.path.startsWith("/api/governance/approvals"))).toEqual([]);
  });
});
