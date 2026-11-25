// CEO CHAT's cards: a report of Orbit's records (never the CEO's words), a mission the CEO proposed (inert until the
// owner gives it: the existing mission creation, held to who the owner saw responsible), and a mission given from the
// conversation, followed live from its own record.
import { Badge, Button, Field, Input, Link, MessageBar, MessageBarBody, Spinner, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { Briefcase20Regular, Checkmark16Regular, DataBarVertical20Regular } from "@fluentui/react-icons";
import { checkMissionFields, type ExecutiveMessage, type ExecutiveReport, type ExpectedAssignee, type MissionDetail, type MissionTargetPreview } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { ApiError, errorCode, errorText, newIdempotencyKey } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { office, useOfficeRead } from "../office/api";
import { StateBadge } from "../office/parts";
import { executive } from "./api";

const useStyles = makeStyles({
  card: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px", borderRadius: "12px", border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground2, maxWidth: "720px" },
  head: { display: "flex", alignItems: "center", gap: "8px" },
  muted: { color: tokens.colorNeutralForeground3 },
  facts: { display: "grid", gridTemplateColumns: "minmax(120px, max-content) 1fr", columnGap: "12px", rowGap: "4px" },
  items: { display: "flex", flexDirection: "column", gap: "6px", margin: 0, paddingLeft: "18px" },
  row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  grid: { display: "grid", gap: "8px" },
});

export function SystemReportCard({ report }: { report: ExecutiveReport }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <section className={s.card} aria-label={report.title}>
      <div className={s.head}>
        <DataBarVertical20Regular />
        <Text weight="semibold">{report.title}</Text>
      </div>
      <Text size={200} className={s.muted}>
        {t("executive.report.from", { time: new Date(report.at).toLocaleString() })}
      </Text>
      <div className={s.facts}>
        {report.facts.map((f) => (
          <div key={f.label} style={{ display: "contents" }}>
            <Text size={200} className={s.muted}>
              {f.label}
            </Text>
            <Text size={200}>{f.value}</Text>
          </div>
        ))}
      </div>
      {report.items.length > 0 && (
        <ul className={s.items}>
          {report.items.map((i, n) => (
            <li key={`${i.title}-${n}`}>
              {i.href !== null ? <Link href={i.href}>{i.title}</Link> : <Text weight="semibold">{i.title}</Text>}
              {i.detail !== "" && (
                <Text size={200} className={s.muted}>
                  {" "}
                  — {i.detail}
                </Text>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const linesOf = (v: string): string[] =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

// A mission the CEO proposed: edited, then given in one click -- held to who the owner saw responsible (the API refuses
// target_changed when that moved, and the card reads who is responsible now).
export function MissionProposalCard({ conversationId, message, canAssign, onGiven }: { conversationId: string; message: ExecutiveMessage; canAssign: boolean; onGiven?: (missionId: string) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const p = message.proposal;
  const [title, setTitle] = useState(p?.title ?? "");
  const [goal, setGoal] = useState(p?.goal ?? "");
  const [deliverables, setDeliverables] = useState((p?.deliverables ?? []).map((d) => d.name).join("\n"));
  const [criteria, setCriteria] = useState((p?.acceptanceCriteria ?? []).join("\n"));
  const [preview, setPreview] = useState<MissionTargetPreview | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sent = useRef<{ body: string; key: string } | null>(null);
  const open = message.proposalState === "open";
  // Who is responsible is read again when the office changes (a manager appointed, the CEO replaced): a proposal that
  // could not be given becomes givable without a reload.
  useAppEvent("office.changed", (e) => {
    if (e.data.areas.includes("roster")) setRound((n) => n + 1);
  });

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    office
      .targetPreview({ kind: "ceo" })
      .then((v) => current && setPreview(v))
      .catch(() => current && setPreview(null));
    return () => {
      current = false;
    };
  }, [open, round]);

  if (p === null) return null;
  if (!open)
    return (
      <div className={s.row}>
        <Badge appearance="tint" color={message.proposalState === "given" ? "success" : "informative"} icon={message.proposalState === "given" ? <Checkmark16Regular /> : undefined}>
          {message.proposalState === "given" ? t("executive.proposal.given") : t("executive.proposal.dismissedState")}
        </Badge>
        <Text size={200} className={s.muted}>
          {p.title}
        </Text>
      </div>
    );

  const responsible = preview?.responsible ?? null;
  const expected: ExpectedAssignee | null = responsible === null ? null : { employeeId: responsible.employeeId, appointmentId: responsible.appointmentId, appointmentRevision: responsible.appointmentRevision };
  const give = async () => {
    if (expected === null) return;
    const mission = { title: title.trim(), goal: goal.trim(), deliverables: linesOf(deliverables).map((name) => ({ name, required: true })), acceptanceCriteria: linesOf(criteria), deadline: p.deadline, priority: p.priority };
    const checked = checkMissionFields(mission);
    if (!checked.ok) {
      setProblem(checked.errors.join("; "));
      return;
    }
    const body = { proposalMessageId: message.id, mission: checked.value, expectedAssignee: expected };
    const text = JSON.stringify(body);
    const key = sent.current?.body === text ? sent.current.key : newIdempotencyKey();
    sent.current = { body: text, key };
    setBusy(true);
    setProblem(null);
    try {
      const made = await executive.give(conversationId, body, key);
      onGiven?.(made.missionId);
    } catch (err) {
      if (err instanceof ApiError && errorCode(err) === "target_changed") {
        sent.current = null;
        const now = (err.details as { current?: { employeeName?: string } } | null)?.current?.employeeName ?? "";
        setProblem(t("executive.proposal.changed", { who: now }));
        setRound((n) => n + 1);
      } else setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    setBusy(true);
    try {
      await executive.dismiss(conversationId, message.id);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.card} aria-label={t("executive.proposal.title")}>
      <div className={s.head}>
        <Briefcase20Regular />
        <Text weight="semibold">{t("executive.proposal.title")}</Text>
      </div>
      <div className={s.grid}>
        <Field label={t("executive.proposal.fieldTitle")}>
          <Input value={title} onChange={(_, d) => setTitle(d.value)} />
        </Field>
        <Field label={t("executive.proposal.fieldGoal")}>
          <Textarea value={goal} onChange={(_, d) => setGoal(d.value)} resize="vertical" rows={3} />
        </Field>
        <Field label={t("executive.proposal.fieldDeliverables")}>
          <Textarea value={deliverables} onChange={(_, d) => setDeliverables(d.value)} rows={2} />
        </Field>
        <Field label={t("executive.proposal.fieldCriteria")}>
          <Textarea value={criteria} onChange={(_, d) => setCriteria(d.value)} rows={2} />
        </Field>
      </div>
      {p.deadline !== null && (
        <Text size={200} className={s.muted}>
          {t("executive.proposal.deadlineInfo", { at: new Date(p.deadline).toLocaleString() })}
        </Text>
      )}
      {preview === null && open && <Spinner size="tiny" label={t("executive.proposal.checking")} />}
      {preview !== null && responsible !== null && (
        <Text size={200} className={s.muted}>
          {t("executive.proposal.responsible", { who: responsible.employeeName })} {t("executive.proposal.inert")}
        </Text>
      )}
      {preview !== null && responsible === null && <NobodyResponsible reason={preview.reason} />}
      {problem !== null && (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>{problem}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.row}>
        <Button appearance="primary" disabled={busy || expected === null || !canAssign} onClick={() => void give()}>
          {busy ? t("executive.proposal.giving") : t("executive.proposal.give")}
        </Button>
        <Button appearance="subtle" disabled={busy} onClick={() => void dismiss()}>
          {t("executive.proposal.dismiss")}
        </Button>
      </div>
    </section>
  );
}

// Why work cannot be given to the CEO now (no CEO, no department with a manager, a suspended appointment), and where a
// person changes that: the Office.
export function NobodyResponsible({ reason }: { reason: string | null }) {
  const { t } = useI18n();
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        {reason} <Link href="#/office">{t("executive.proposal.openOffice")}</Link>
      </MessageBarBody>
    </MessageBar>
  );
}

// A mission given from this conversation, as its own record says now (read again when the office says it moved).
export function MissionLinkCard({ missionId, title }: { missionId: string; title: string }) {
  const { t } = useI18n();
  const s = useStyles();
  const m = useOfficeRead<MissionDetail>(() => office.mission(missionId), [missionId], ["missions"], missionId);
  const root = m.data?.assignments.find((a) => a.parentId === null) ?? null;
  return (
    <section className={s.card} aria-label={title}>
      <div className={s.head}>
        <Briefcase20Regular />
        <Link href={`#/office/mission/${encodeURIComponent(missionId)}`}>{title}</Link>
      </div>
      {m.data === null ? (
        <Spinner size="tiny" />
      ) : (
        <div className={s.row}>
          {root ? (
            <StateBadge text={t("executive.mission.state", { state: root.state.toLowerCase().replace(/_/g, " ") })} state={root.state} />
          ) : (
            <Badge appearance="tint">{t("executive.mission.state", { state: m.data.state.toLowerCase().replace(/_/g, " ") })}</Badge>
          )}
          {root !== null && (
            <Text size={200} className={s.muted}>
              {root.employeeName}
              {root.reason !== null && root.reason !== "" ? ` — ${root.reason}` : ""}
            </Text>
          )}
        </div>
      )}
    </section>
  );
}
