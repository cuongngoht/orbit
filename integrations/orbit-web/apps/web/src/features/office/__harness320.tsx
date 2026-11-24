// TEMPORARY: a 320 px layout check of the office pages, with the API answered here. Deleted after the check.
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { MissionDetail } from "@orbit-web/contracts";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { OfficePage } from "../../hooks/useHashRoute";
import { I18nProvider } from "../../i18n";
import { AppEventsProvider } from "../../services/events/AppEvents";
import "../../themes/global.css";
import * as fx from "../../testing/officeFixtures";
import { OfficeView } from "./OfficeView";

class QuietEventSource {
  url: string;
  readyState = 0;
  onopen: unknown = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
Object.defineProperty(window, "EventSource", { value: QuietEventSource, writable: true });

const LONG = "Supercalifragilisticexpialidocious-department-of-very-long-names-without-spaces";
const target = { kind: "department" as const, departmentId: fx.DEPT_ACCOUNTING, departmentName: "Accounting and Financial Reporting Services", appointmentId: fx.APPOINTMENT_ID, appointmentRevision: 3 };
const root = fx.assignmentView({ title: "Q3 team report with a rather long title that has to wrap on a phone", state: "ANSWERING", target, planCount: 2, questionCount: 1, actions: ["pause", "hand_over", "repin", "cancel"], lastRun: fx.runView({ wakeReason: "its team asked a question about the quarterly ledger reconciliation" }) });
const part = fx.partView({ state: "BLOCKED", reason: "It waits for the answer to its question.", waitingOn: "information", questionCount: 1, planCount: 1, actions: ["answer", "pause", "hand_over", "repin", "cancel"] });
const sub = fx.partView({ id: "b1000000-0000-4000-8000-000000000003", parentId: fx.PART_ID, title: `Sub-part ${LONG}`, unitKey: "deep", leadName: "Bao", actions: ["pause", "cancel"] });
const sub2 = fx.partView({ id: "b1000000-0000-4000-8000-000000000004", parentId: sub.id, title: "Sub-sub-part", unitKey: "deeper", leadName: "Bao" });
const sub3 = fx.partView({ id: "b1000000-0000-4000-8000-000000000005", parentId: sub2.id, title: "Sub-sub-sub-part", unitKey: "deepest", leadName: "Bao" });
const mission: MissionDetail = fx.missionDetail({
  title: root.title,
  target,
  assignments: [root, part, sub, sub2, sub3],
  responsibleNow: [
    { assignmentId: root.id, employeeId: fx.EMP_ANA, name: "Anastasia Konstantinopoulou-Vasquez", what: "answers its team's questions", why: `its team asked: ${LONG}` },
    { assignmentId: part.id, employeeId: null, name: "You", what: "answer Bao", why: "Which contracts count as renewed?" },
  ],
  clarifications: [
    fx.clarificationView({ question: `Which contracts count as **renewed**? <b>Q3</b> only?\nA very long line: ${LONG}${LONG}` }),
    fx.clarificationView({ id: "c2000000-0000-4000-8000-000000000002", askerName: "Cam", state: "answered", answer: `Use the 2026 ledger. ${LONG}`, answeredBy: "Ana", answeredAt: "2026-11-21T08:35:00.000Z", addressee: "lead", addresseeName: "Ana", kind: "information", route: [{ addressee: "lead", addresseeName: "Ana", why: "asked of its lead", at: "2026-11-21T08:31:00.000Z" }] }),
  ],
  dataShares: [fx.dataShareView({ recipientName: "Bartholomew Featherstonehaugh", fromUnit: `intake-${LONG}` }), fx.dataShareView({ id: "5a000000-0000-4000-8000-000000000002", kind: "source", sourceRevisionId: fx.SOURCE_REVISION_ID, fromUnit: null, mode: "full", revokedBy: "Ann Owner", revokedAt: "2026-11-21T08:45:00.000Z" })],
  handoffs: [fx.handoff(), fx.handoff({ id: "4a000000-0000-4000-8000-000000000011", assignmentId: fx.PART_ID, revision: 1, digest: "ef".repeat(32), summary: "The research.", missing: [], review: { by: "Ana", at: "2026-11-21T08:25:00.000Z", note: `Add the renewal dates ${LONG}` } })],
});
const roster = fx.roster({
  departments: [
    fx.department({ name: "Accounting and Financial Reporting Services" }),
    fx.department({ id: fx.DEPT_LEGAL, name: "Legal", position: 1, manager: fx.appointmentSummary({ employeeId: fx.EMP_BAO, name: "Bartholomew Featherstonehaugh", state: "suspended" }) }),
  ],
});
const responsible = { employeeId: fx.EMP_ANA, appointmentId: fx.APPOINTMENT_ID, appointmentRevision: 3, employeeName: "Anastasia Konstantinopoulou-Vasquez", role: "manager" as const, departmentName: "Accounting and Financial Reporting Services" };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function answer(method: string, url: URL): Response {
  const p = url.pathname;
  if (p === `/api/missions/${fx.MISSION_ID}`) return json(200, mission);
  if (p === `/api/missions/${fx.MISSION_ID}/team-room`) return json(200, []);
  if (p === "/api/office/roster") return json(200, roster);
  if (p === "/api/connections") return json(200, fx.connectionsView());
  if (p === "/api/research/workspaces") return json(200, []);
  if (p === "/api/missions/target")
    return json(200, url.searchParams.get("kind") === "ceo" ? fx.targetPreview({ target: { kind: "ceo" }, responsible: null, code: "no_ceo", reason: "The company has no CEO: appoint one (Office → Leadership), or give the work to an employee." }) : fx.targetPreview({ responsible }));
  if (p === "/api/inbox")
    return json(200, fx.inbox([fx.inboxItem({ kind: "information", assignmentId: fx.PART_ID, title: "A question from the team", reason: `Which contracts count as renewed? ${LONG}\n\n(human decision: the budget is the owner's to decide)`, waiting: `assignment:${fx.ASSIGNMENT_ID}`, pin: { assignmentVersion: 4, handoffDigest: null, deliveryId: null } })]));
  if (method === "POST" && p === "/api/missions") return json(409, { error: { code: "target_changed", message: "changed", details: { current: { ...responsible, employeeId: fx.EMP_BAO, employeeName: "Bartholomew Featherstonehaugh", appointmentRevision: 4 } } } });
  return json(404, { error: { code: "not_found", message: `no route ${method} ${p}` } });
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => answer((init?.method ?? "GET").toUpperCase(), new URL(String(input), location.origin));

function Harness() {
  const params = new URLSearchParams(location.search);
  const [at, setAt] = useState<{ page: OfficePage; item: string | null; tab: string | null }>({ page: (params.get("page") ?? "mission") as OfficePage, item: params.get("page") === "mission" || params.get("page") === null ? fx.MISSION_ID : null, tab: params.get("tab") });
  return <OfficeView page={at.page} item={at.item} tab={at.tab} go={(page, item = null, tab = null) => setAt({ page, item, tab })} account={null} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider locale="en">
      <FluentProvider theme={webLightTheme} style={{ height: "100%" }}>
        <AppEventsProvider>
          <Harness />
        </AppEventsProvider>
      </FluentProvider>
    </I18nProvider>
  </StrictMode>,
);
