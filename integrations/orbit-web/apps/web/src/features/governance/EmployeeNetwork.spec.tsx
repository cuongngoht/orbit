import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountPolicy } from "@orbit-web/governance-core";
import type { RevisionView } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { DRAFT_DIGEST, authSession, draftView, revisionSummary, revisionView } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { NETWORK_DISCLOSURE } from "../office/parts";
import { GovernanceView } from "./GovernanceView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const ACCOUNT = { displayName: "Octo & Co", email: "ann@example.com" };
const overview = (draft: RevisionView) => ({ effective: revisionView(), revisions: [revisionSummary({ ...draft, revision: null }), revisionSummary()] });

describe("Governance → Policy → Employee network access", () => {
  test("a policy that does not say is Autonomous; a draft switches to Restricted, lists hosts and a limit, and saves them in its document", async () => {
    const draft = draftView();
    const api = fakeApi()
      .on("GET", "/api/governance/policy", () => overview(draft))
      .on("GET", "/api/governance/revisions/rev-2", () => draft)
      .on("PUT", "/api/governance/revisions/rev-2", () => draft);
    renderLive(<GovernanceView page="policy" item="rev-2" go={vi.fn()} account={ACCOUNT} />);
    const section = await screen.findByRole("region", { name: "Employee network access" });
    expect(section.textContent).toContain("This revision does not say, so employee runs use Autonomous.");
    expect(section.textContent).toContain(NETWORK_DISCLOSURE);
    expect(within(section).getByRole("radio", { name: /^Autonomous/ })).toBeChecked();
    await userEvent.click(within(section).getByRole("radio", { name: /^Restricted/ }));
    const host = within(section).getByRole("textbox", { name: /Host or domain to allow/ });
    await userEvent.type(host, "not a host");
    expect(within(section).getByText("Not a host name or *.domain.")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Allow" })).toBeDisabled();
    await userEvent.clear(host);
    await userEvent.type(host, "*.Example.com");
    await userEvent.click(within(section).getByRole("button", { name: "Allow" }));
    await userEvent.type(host, "docs.python.org");
    await userEvent.click(within(section).getByRole("button", { name: "Allow" }));
    expect(within(within(section).getByRole("list", { name: "Allowed hosts" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["*.example.com", "docs.python.org"]);
    await userEvent.type(within(section).getByRole("spinbutton", { name: /Download per run \(MiB\)/ }), "100");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const sent = api.calls.find((c) => c.method === "PUT")?.body as { document: AccountPolicy & { employeeNetwork: unknown }; expectedDigest: string };
    expect(sent.expectedDigest).toBe(DRAFT_DIGEST);
    expect(sent.document.employeeNetwork).toEqual({ mode: "RESTRICTED", allow: ["*.example.com", "docs.python.org"], limits: { downloadBytesPerRun: 104857600 } });
    // The rest of the document is kept as it was.
    expect(sent.document.rules).toEqual((draft.document as AccountPolicy).rules);
  });

  test("a published revision that says Restricted is shown read only, with its hosts and limits", async () => {
    const published = revisionView({ document: { ...(revisionView().document as object), employeeNetwork: { mode: "RESTRICTED", allow: ["pypi.org"], limits: { bandwidthMbpsPerRun: 50 } } } });
    fakeApi().on("GET", "/api/governance/policy", () => ({ effective: published, revisions: [revisionSummary()] }));
    renderLive(<GovernanceView page="policy" item={null} go={vi.fn()} account={ACCOUNT} />);
    const section = await screen.findByRole("region", { name: "Employee network access" });
    // The rest of the policy is still a table: the network part does not make it unreadable.
    expect(screen.queryByText(/This revision cannot be shown/)).toBeNull();
    expect(within(section).getByRole("radio", { name: /^Restricted/ })).toBeChecked();
    expect(within(section).getByRole("radio", { name: /^Restricted/ })).toBeDisabled();
    expect(within(section).getByText("pypi.org")).toBeInTheDocument();
    expect(within(section).getByRole("spinbutton", { name: /Bandwidth per run/ })).toHaveValue(50);
    expect(within(section).queryByRole("button", { name: "Allow" })).toBeNull();
    expect(within(section).queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
