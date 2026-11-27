// THE POLICY'S RUNTIME SECURITY SECTION (ADR 0063): the mode and the controls are the policy's own fields; what the host
// has proven is shown before publishing, as a prediction -- enforce on a host that cannot prevent is said to refuse.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultAccountPolicy, type AccountPolicy } from "@orbit-web/governance-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { authSession } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { PolicyTable } from "./PolicyTable";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const host = (state: "SUPPORTED" | "UNSUPPORTED") => ({ backend: "tetragon", backendVersion: "v1.8.0", backendImage: null, hostKind: "native-linux", kernel: "6.8", arch: "x86_64", sensor: { state: "HEALTHY", generation: "g", since: null, detail: "", cpuPercent: null, memoryMiB: null }, capabilities: [{ capability: "prevent.exec", state, detail: "", checkedAt: null }], probedAt: null, floor: "disabled", telemetry: { lastEventAt: null, lost: 0, unattributed: 0, retentionDays: 14 } });

describe("Policy → Runtime security", () => {
  test("choosing enforce writes the policy's own field, and a host that cannot prevent is said to refuse every attempt", async () => {
    fakeApi().on("GET", "/api/governance/runtime-security/host", () => host("UNSUPPORTED"));
    const onChange = vi.fn<(next: AccountPolicy) => void>();
    const doc = defaultAccountPolicy("acc-1", "single");
    const view = renderLive(<PolicyTable document={doc} editable onChange={onChange} />);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Runtime security mode" }), "enforce");
    expect(onChange.mock.calls.at(-1)?.[0].runtimeSecurity).toEqual({ mode: "enforce", controls: ["exec.shared-areas"] });
    view.rerender(<PolicyTable document={{ ...doc, runtimeSecurity: { mode: "enforce", controls: ["exec.shared-areas"] } }} editable onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/enforce would refuse every attempt here/)).toBeTruthy());
    expect(screen.getByText(/proven prevention: UNSUPPORTED/)).toBeTruthy();
  });
});
