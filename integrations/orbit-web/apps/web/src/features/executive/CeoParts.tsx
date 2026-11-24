// CEO CHAT's parts: the quick actions (Orbit's records, and work given in the owner's own words), the details of the CEO
// (who it is, by which appointment, what its answers run on and where each came from, what the last answer stood on),
// and the no-CEO state, which opens the Office's own hire and appointment dialogs -- nobody is appointed by opening it.
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { Briefcase20Regular, Building20Regular, DataBarVertical20Regular, PersonAdd20Regular, PersonStar20Regular, Wrench20Regular } from "@fluentui/react-icons";
import { checkMissionFields, type Department, type ExecutionDefaults, type ExecutiveMissionFields, type ExecutiveReportKind, type ExecutiveState, type ExpectedAssignee, type MissionTargetPreview, type Roster } from "@orbit-web/contracts";
import { useEffect, useState, type ReactElement } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText, newIdempotencyKey } from "../../services/api";
import { office } from "../office/api";
import { AppointmentDialog } from "../office/AppointmentDialogs";
import { HireWizard } from "../office/HireWizard";
import { EmptyState } from "../office/parts";
import { useAppEvent } from "../../services/events/AppEvents";
import { executive } from "./api";
import { NobodyResponsible } from "./cards";

const useStyles = makeStyles({
  quick: { display: "flex", flexWrap: "wrap", gap: "8px" },
  card: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px", borderRadius: "12px", border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground2 },
  row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
  dl: { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "10px", rowGap: "6px", margin: 0 },
  section: { display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" },
  records: { margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "2px" },
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, gap: "16px", padding: "24px" },
});

export const REPORT_ACTIONS: { kind: ExecutiveReportKind; key: "executive.quick.status" | "executive.quick.missions" | "executive.quick.departments" | "executive.quick.resources" | "executive.quick.decisions"; icon: ReactElement }[] = [
  { kind: "status", key: "executive.quick.status", icon: <Building20Regular /> },
  { kind: "missions", key: "executive.quick.missions", icon: <Briefcase20Regular /> },
  { kind: "departments", key: "executive.quick.departments", icon: <PersonStar20Regular /> },
  { kind: "resources", key: "executive.quick.resources", icon: <Wrench20Regular /> },
  { kind: "decisions", key: "executive.quick.decisions", icon: <DataBarVertical20Regular /> },
];

export function QuickActions({ onReport, onAssign, canAssign, busy }: { onReport: (kind: ExecutiveReportKind) => void; onAssign: (() => void) | null; canAssign: boolean; busy: boolean }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <div className={s.quick} role="group" aria-label={t("executive.home.quickLabel")}>
      {REPORT_ACTIONS.slice(0, 2).map((a) => (
        <Button key={a.kind} size="small" shape="circular" icon={a.icon} disabled={busy} onClick={() => onReport(a.kind)}>
          {t(a.key)}
        </Button>
      ))}
      {onAssign !== null && (
        <Button size="small" shape="circular" icon={<Briefcase20Regular />} disabled={busy || !canAssign} onClick={onAssign}>
          {t("executive.quick.assign")}
        </Button>
      )}
      {REPORT_ACTIONS.slice(2).map((a) => (
        <Button key={a.kind} size="small" shape="circular" icon={a.icon} disabled={busy} onClick={() => onReport(a.kind)}>
          {t(a.key)}
        </Button>
      ))}
    </div>
  );
}

const linesOf = (v: string): string[] =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

// Work given to the CEO in the owner's own words: the same mission creation as a proposal's, held to who the owner saw.
export function AssignWorkCard({ onGive, onCancel }: { onGive: (body: { mission: ExecutiveMissionFields; expectedAssignee: ExpectedAssignee }, key: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [criteria, setCriteria] = useState("");
  const [preview, setPreview] = useState<MissionTargetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [key] = useState(() => newIdempotencyKey());
  const [round, setRound] = useState(0);
  // Read again when the office changes: a manager appointed meanwhile lets the work be given.
  useAppEvent("office.changed", (e) => {
    if (e.data.areas.includes("roster")) setRound((n) => n + 1);
  });
  useEffect(() => {
    let current = true;
    void office
      .targetPreview({ kind: "ceo" })
      .then((v) => current && setPreview(v))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [round]);
  const r = preview?.responsible ?? null;
  const give = async () => {
    if (r === null) return;
    const checked = checkMissionFields({ title: title.trim() || goal.trim().split("\n")[0]?.slice(0, 120), goal: goal.trim(), deliverables: linesOf(deliverables).map((name) => ({ name, required: true })), acceptanceCriteria: linesOf(criteria), deadline: null, priority: 5 });
    if (!checked.ok) {
      setProblem(checked.errors.join("; "));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onGive({ mission: checked.value, expectedAssignee: { employeeId: r.employeeId, appointmentId: r.appointmentId, appointmentRevision: r.appointmentRevision } }, key);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.card} aria-label={t("executive.assign.title")}>
      <Text weight="semibold">{t("executive.assign.title")}</Text>
      <Text size={200} className={s.muted}>
        {t("executive.assign.body")}
      </Text>
      <Field label={t("executive.proposal.fieldTitle")}>
        <Input value={title} onChange={(_, d) => setTitle(d.value)} />
      </Field>
      <Field label={t("executive.proposal.fieldGoal")} required>
        <Textarea value={goal} onChange={(_, d) => setGoal(d.value)} rows={3} resize="vertical" />
      </Field>
      <Field label={t("executive.proposal.fieldDeliverables")}>
        <Textarea value={deliverables} onChange={(_, d) => setDeliverables(d.value)} rows={2} />
      </Field>
      <Field label={t("executive.proposal.fieldCriteria")}>
        <Textarea value={criteria} onChange={(_, d) => setCriteria(d.value)} rows={2} />
      </Field>
      {preview === null ? (
        <Spinner size="tiny" label={t("executive.proposal.checking")} />
      ) : r !== null ? (
        <Text size={200} className={s.muted}>
          {t("executive.proposal.responsible", { who: r.employeeName })}
        </Text>
      ) : (
        <NobodyResponsible reason={preview.reason} />
      )}
      {problem !== null && (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>{problem}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.row}>
        <Button appearance="primary" disabled={busy || r === null || goal.trim() === ""} onClick={() => void give()}>
          {busy ? t("executive.proposal.giving") : t("executive.proposal.give")}
        </Button>
        <Button appearance="subtle" disabled={busy} onClick={onCancel}>
          {t("executive.assign.cancel")}
        </Button>
      </div>
    </section>
  );
}

// Who the CEO is, by which appointment, what its answers run on (and where each came from), and what the last answer
// stood on.
export function CeoDetails({ state, records }: { state: ExecutiveState; records: string[] }) {
  const { t } = useI18n();
  const s = useStyles();
  const c = state.ceo;
  if (c === null) return null;
  const x = c.execution;
  return (
    <div>
      <div className={s.section}>
        <Text weight="semibold">{c.name}</Text>
        {c.title !== "" && (
          <Text size={200} className={s.muted}>
            {c.title}
          </Text>
        )}
        <dl className={s.dl}>
          <dt className={s.muted}>{t("executive.panel.appointment")}</dt>
          <dd style={{ margin: 0 }}>{t("executive.ceo.since", { date: new Date(c.appointment.since).toLocaleDateString(), revision: c.appointment.revision })}</dd>
          <dt className={s.muted}>{t("executive.panel.execution")}</dt>
          <dd style={{ margin: 0 }}>{x.runtime}</dd>
          <dt className={s.muted}>{t("executive.panel.connection")}</dt>
          <dd style={{ margin: 0 }}>
            {x.connectionName ?? "—"} <span className={s.muted}>{t("executive.panel.source", { source: x.sources.connection })}</span>
          </dd>
          <dt className={s.muted}>{t("executive.panel.model")}</dt>
          <dd style={{ margin: 0 }}>
            {x.model ?? "—"} <span className={s.muted}>{t("executive.panel.source", { source: x.sources.model })}</span>
          </dd>
          <dt className={s.muted}>{t("executive.panel.effort")}</dt>
          <dd style={{ margin: 0 }}>
            {x.effort ?? "—"} <span className={s.muted}>{t("executive.panel.source", { source: x.sources.effort })}</span>
          </dd>
        </dl>
        <Text size={200} className={s.muted}>
          {t("executive.panel.authority")}
        </Text>
      </div>
      <div className={s.section}>
        <Text weight="semibold">{t("executive.panel.records")}</Text>
        {records.length === 0 ? (
          <Text size={200} className={s.muted}>
            {t("executive.panel.noRecords")}
          </Text>
        ) : (
          <ul className={s.records}>
            {records.map((r, i) => (
              <li key={i}>
                <Text size={200}>{r}</Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// A company without a CEO: said so, with the Office's own ways to hire one and appoint one; Orbit's records still answer.
export function CeoOnboarding({ onReport }: { state: ExecutiveState; onReport: (conversationId: string) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [hiring, setHiring] = useState(false);
  const [appointing, setAppointing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const roster = useResource<Roster>(hiring ? () => office.roster({ department: null, q: "", status: null }) : null, [hiring]);
  const report = async (kind: ExecutiveReportKind) => {
    setBusy(true);
    try {
      onReport((await executive.startWithReport(kind, newIdempotencyKey())).conversationId);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.center}>
      <EmptyState
        icon={<PersonAdd20Regular />}
        title={t("executive.onboarding.title")}
        body={t("executive.onboarding.body")}
        action={
          <div className={s.row}>
            <Button appearance="primary" icon={<PersonAdd20Regular />} onClick={() => setHiring(true)}>
              {t("executive.onboarding.hire")}
            </Button>
            <Button icon={<PersonStar20Regular />} onClick={() => setAppointing(true)}>
              {t("executive.onboarding.appoint")}
            </Button>
          </div>
        }
      />
      <QuickActions onReport={(k) => void report(k)} onAssign={null} canAssign={false} busy={busy} />
      {problem !== null && (
        <MessageBar intent="error">
          <MessageBarBody>{problem}</MessageBarBody>
        </MessageBar>
      )}
      {hiring && roster.data !== null && <HireWizard departments={roster.data.departments as Department[]} companyDefaults={(roster.data.office?.defaults ?? null) as ExecutionDefaults | null} onClose={() => setHiring(false)} onHired={() => setHiring(false)} />}
      {appointing && <AppointmentDialog edit={{ act: "appoint", slot: { role: "ceo", incumbent: null } }} onClose={() => setAppointing(false)} onDone={() => setAppointing(false)} />}
    </div>
  );
}
