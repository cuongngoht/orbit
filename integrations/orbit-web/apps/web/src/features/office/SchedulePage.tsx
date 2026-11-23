// SCHEDULES: work the office makes by itself -- daily, weekly, monthly, quarterly, at a local time of a time zone -- each
// run due at an instant shown in the schedule's own zone and in UTC, and each period's occurrence with where its work
// stands and where its report went. A report is "Sent" only with the receiver's receipt; anything else is said as what it
// is. A new schedule shows its next runs, worked out by the API, as it is written.
import { Badge, Button, Field, Input, Link, MessageBar, MessageBarBody, Select, Spinner, Text, Textarea, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Add16Regular, CalendarClock20Regular, Pause16Regular, Play16Regular } from "@fluentui/react-icons";
import { ScheduleIcon } from "../../components/SectionIcons";
import {
  ASSIGNMENT_STATE_TEXT,
  DELIVERY_STATE_TEXT,
  MISSED_POLICIES,
  SCHEDULE_KINDS,
  checkCreateSchedule,
  checkScheduleRule,
  type AuthAccount,
  type CreateScheduleRequest,
  type DeliveryChannel,
  type MissedPolicy,
  type OccurrenceView,
  type Roster,
  type ScheduleKind,
  type ScheduleRule,
  type ScheduleRun,
  type ScheduleView,
} from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { browserTimeZone, TimeZoneSelect } from "../../components/TimeZoneSelect";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { errorText } from "../../services/api";
import { NOT_SERVED, office, unlessNotServed, useOfficeRead } from "./api";
import { AsOf, EmployeeAvatar, EmptyState, ProblemBar, useAction, useOfficeStyles } from "./parts";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const DAY_KEYS: MessageKey[] = [
  "office.schedule.day.1",
  "office.schedule.day.2",
  "office.schedule.day.3",
  "office.schedule.day.4",
  "office.schedule.day.5",
  "office.schedule.day.6",
  "office.schedule.day.7",
];
const KIND_KEYS: Record<ScheduleKind, MessageKey> = {
  daily: "office.schedule.kind.daily",
  weekly: "office.schedule.kind.weekly",
  monthly: "office.schedule.kind.monthly",
  quarterly: "office.schedule.kind.quarterly",
};
const MISSED_KEYS: Record<MissedPolicy, MessageKey> = {
  catch_up_latest: "office.schedule.missed.catch_up_latest",
  catch_up_each: "office.schedule.missed.catch_up_each",
  skip: "office.schedule.missed.skip",
};
const PERIOD_UNIT_KEYS: Record<ScheduleKind, MessageKey> = {
  daily: "office.schedule.unit.daily",
  weekly: "office.schedule.unit.weekly",
  monthly: "office.schedule.unit.monthly",
  quarterly: "office.schedule.unit.quarterly",
};

const useStyles = makeStyles({
  cardActive: { borderLeftWidth: "4px", borderLeftColor: tokens.colorBrandStroke1 },
  cardPaused: { borderLeftWidth: "4px", borderLeftColor: tokens.colorNeutralStroke1 },
  sectionLabel: { textTransform: "uppercase", letterSpacing: "0.04em", color: tokens.colorNeutralForeground3 },
  occurrencesWrap: { display: "flex", flexDirection: "column", gap: "8px", paddingTop: "8px" },
});

export function ruleText(r: ScheduleRule): string {
  const when_ =
    r.kind === "daily"
      ? tr("office.schedule.ruleDaily")
      : r.kind === "weekly"
        ? tr("office.schedule.ruleWeekly", { day: tr(DAY_KEYS[(r.dayOfWeek ?? 1) - 1]!) })
        : r.kind === "monthly"
          ? tr("office.schedule.ruleMonthly", { day: r.dayOfMonth ?? 1 })
          : tr("office.schedule.ruleQuarterly", { day: r.dayOfMonth ?? 1 });
  return tr("office.schedule.ruleText", {
    when: when_,
    time: r.localTime,
    tz: r.timezone,
    unit: tr(PERIOD_UNIT_KEYS[r.kind]),
    period: r.period === "previous" ? tr("office.schedule.periodJustEnded") : tr("office.schedule.periodStarts"),
  });
}

const utc = (iso: string): string => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function RunLine({ run, timezone }: { run: ScheduleRun; timezone: string }) {
  const { t } = useI18n();
  return (
    <Text size={200}>
      {t("office.schedule.runLine", { local: run.local, tz: timezone, utc: utc(run.dueAt), period: run.periodKey })}
    </Text>
  );
}

const deliveryText = (o: OccurrenceView): string => (o.delivery === "none" ? tr("office.schedule.noDelivery") : DELIVERY_STATE_TEXT[o.delivery]);

function Occurrences({ schedule, go }: { schedule: ScheduleView; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const list = useOfficeRead<OccurrenceView[] | typeof NOT_SERVED>(() => office.occurrences(schedule.id).catch(unlessNotServed), [schedule.id], ["schedules", "missions"]);
  if (list.data === null) return list.error ? <Text className={o.danger}>{list.error}</Text> : <Spinner size="tiny" label={t("office.schedule.readingOccurrences")} />;
  if (list.data === NOT_SERVED) return <Text className={o.muted}>{t("office.schedule.occurrencesUnavailable")}</Text>;
  if (list.data.length === 0) return <Text className={o.muted}>{t("office.schedule.noPeriodsYet")}</Text>;
  return (
    <ul className={o.list} aria-label={t("office.schedule.occurrencesAria", { name: schedule.name })}>
      {list.data.map((x) => (
        <li key={x.id} className={o.item}>
          <div className={o.between}>
            <div className={o.row}>
              <Text weight="semibold" size={200}>
                {t("office.schedule.periodTitle", { key: x.periodKey })}
              </Text>
              <Badge appearance="tint" color={x.state === "skipped" ? "subtle" : "informative"} style={{ borderRadius: "9999px" }}>
                {x.state === "skipped" ? t("office.schedule.skipped") : t("office.schedule.workMade")}
              </Badge>
              <Badge appearance="tint" color={x.delivery === "SENT" ? "success" : x.delivery === "FAILED" || x.delivery === "NEEDS_RECONCILIATION" ? "danger" : "subtle"} style={{ borderRadius: "9999px" }}>
                {deliveryText(x)}
              </Badge>
            </div>
            {x.missionId && (
              <Link className="orbit-target" as="button" onClick={() => go("mission", x.missionId)}>
                {t("office.assign.openWork")}
              </Link>
            )}
          </div>
          <Text size={200} className={o.muted}>
            {t("office.schedule.occurrenceMeta", { due: utc(x.dueAt), revision: x.scheduleRevision })}
            {x.assignmentState ? t("office.schedule.occurrenceWorkState", { state: ASSIGNMENT_STATE_TEXT[x.assignmentState] }) : ""}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function ScheduleItem({ s: schedule, go, onChanged, onLoadLatest }: { s: ScheduleView; go: Go; onChanged: (s: ScheduleView) => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const st = useStyles();
  const o = useOfficeStyles();
  const act = useAction();
  const [showing, setShowing] = useState(false);
  const next = schedule.next[0] ?? null;
  const paused = schedule.state === "paused";
  return (
    <li className={mergeClasses(o.card, paused ? st.cardPaused : st.cardActive)} aria-label={schedule.name}>
      <div className={o.between}>
        <div className={o.row}>
          <Text weight="semibold" size={400}>
            {schedule.name}
          </Text>
          <Badge appearance="tint" color={paused ? "subtle" : "success"} style={{ borderRadius: "9999px" }}>
            {paused ? t("office.schedule.pausedBadge") : t("office.schedule.activeBadge")}
          </Badge>
        </div>
        <div className={o.row}>
          <Button
            className={o.touch}
            size="small"
            icon={paused ? <Play16Regular /> : <Pause16Regular />}
            disabled={act.busy}
            onClick={() => void act.run(async () => onChanged(await office.updateSchedule(schedule, { state: paused ? "active" : "paused" })))}
          >
            {paused ? t("office.schedule.resume") : t("office.schedule.pause")}
          </Button>
          <Button className={o.touch} size="small" appearance="subtle" onClick={() => setShowing(!showing)} aria-expanded={showing}>
            {showing ? t("office.schedule.hideOccurrences") : t("office.schedule.occurrencesBtn")}
          </Button>
        </div>
      </div>
      <div className={o.row}>
        <CalendarClock20Regular aria-hidden className={o.muted} />
        <Text size={200}>{ruleText(schedule.rule)}</Text>
      </div>
      <div className={o.row}>
        <EmployeeAvatar name={schedule.employeeName} size="sm" />
        <Text size={200} className={o.muted}>
          {t("office.schedule.metaLine", { name: schedule.employeeName, count: schedule.recipients.length, missed: t(MISSED_KEYS[schedule.missedPolicy]), revision: schedule.revision })}
        </Text>
      </div>
      <div className={o.inset}>
        <Text size={200} weight="semibold">
          {t("office.schedule.nextRun")}
        </Text>
        {next ? (
          <RunLine run={next} timezone={schedule.rule.timezone} />
        ) : (
          <Text size={200} className={o.muted}>
            {paused ? t("office.schedule.pausedNoRun") : t("office.schedule.noRunDue")}
          </Text>
        )}
      </div>
      {schedule.lastOccurrence && (
        <Text size={200} className={o.muted}>
          {t("office.schedule.lastPeriod", { key: schedule.lastOccurrence.periodKey, delivery: deliveryText(schedule.lastOccurrence) })}
        </Text>
      )}
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
      {showing && (
        <div className={st.occurrencesWrap}>
          <div className={o.divider} />
          <Occurrences schedule={schedule} go={go} />
        </div>
      )}
    </li>
  );
}

function NewSchedule({ account, onCreated, onCancel }: { account: AuthAccount | null; onCreated: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const st = useStyles();
  const o = useOfficeStyles();
  const roster = useResource<Roster>(() => office.roster({ department: null, q: "", status: null }), []);
  const employees = (roster.data?.employees ?? []).filter((e) => e.employment !== "archived");
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("monthly");
  const [timezone, setTimezone] = useState(account?.timezone ?? browserTimeZone());
  const [localTime, setLocalTime] = useState("08:00");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [period, setPeriod] = useState<"previous" | "current">("previous");
  const [goal, setGoal] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [criteria, setCriteria] = useState("");
  const [recipients, setRecipients] = useState("");
  const [channel, setChannel] = useState<DeliveryChannel>("inbox");
  const [missed, setMissed] = useState<MissedPolicy>("catch_up_each");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; runs: ScheduleRun[] | null; error: string | null } | null>(null);
  const rule: ScheduleRule = { kind, timezone, localTime, ...(kind === "weekly" ? { dayOfWeek } : {}), ...(kind === "monthly" || kind === "quarterly" ? { dayOfMonth } : {}), period };
  const ruleKey = JSON.stringify(rule);
  const target = employeeId || employees[0]?.id || "";

  // The next runs of the rule as written, asked of the API once typing pauses.
  useEffect(() => {
    const checked = checkScheduleRule(JSON.parse(ruleKey) as unknown);
    if (!checked.ok) return undefined;
    const t = setTimeout(() => {
      office
        .previewSchedule(checked.value)
        .then((runs) => setPreview({ key: ruleKey, runs, error: null }))
        .catch((err: unknown) => setPreview({ key: ruleKey, runs: null, error: errorText(err) }));
    }, 300);
    return () => clearTimeout(t);
  }, [ruleKey]);
  const ruleProblems = (() => {
    const c = checkScheduleRule(rule);
    return c.ok ? [] : c.errors;
  })();
  const shown = preview !== null && preview.key === ruleKey ? preview : null;

  const body: CreateScheduleRequest = {
    name: name.trim(),
    rule,
    employeeId: target,
    mission: {
      goal: goal.trim(),
      deliverables: deliverables
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
        .map((d) => ({ name: d, required: true })),
      acceptanceCriteria: criteria
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    },
    recipients: recipients
      .split(/[\s,]+/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
      .map((address) => ({ address, channel })),
    missedPolicy: missed,
  };
  const create = async () => {
    const checked = checkCreateSchedule(body);
    if (!checked.ok) return setError(checked.errors.join("; "));
    setBusy(true);
    setError(null);
    try {
      await office.createSchedule(body);
      onCreated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={o.heroCard}
      aria-label={t("office.schedule.newTitle")}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className={o.between}>
        <Text weight="semibold" size={500}>
          {t("office.schedule.newTitle")}
        </Text>
        <Text size={100} weight="semibold" className={st.sectionLabel}>
          {t("office.schedule.cadenceTimezone")}
        </Text>
      </div>
      <div className={o.formGrid}>
        <Field label={t("office.department.nameLabel")} required>
          <Input value={name} maxLength={80} onChange={(_, d) => setName(d.value)} />
        </Field>
        <Field label={t("office.assign.employeeLabel")} required>
          <Select value={target} onChange={(_, d) => setEmployeeId(d.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("office.schedule.howOften")}>
          <Select value={kind} onChange={(_, d) => setKind(d.value as ScheduleKind)}>
            {SCHEDULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_KEYS[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("office.schedule.timeZone")}>
          <TimeZoneSelect value={timezone} onChange={setTimezone} />
        </Field>
        <Field label={t("office.schedule.localTime")} hint={t("office.schedule.localTimeHint")}>
          <Input type="time" value={localTime} onChange={(_, d) => setLocalTime(d.value)} />
        </Field>
        {kind === "weekly" && (
          <Field label={t("office.schedule.dayOfWeek")}>
            <Select value={String(dayOfWeek)} onChange={(_, d) => setDayOfWeek(Number(d.value))}>
              {DAY_KEYS.map((dayKey, i) => (
                <option key={dayKey} value={i + 1}>
                  {t(dayKey)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(kind === "monthly" || kind === "quarterly") && (
          <Field label={t("office.schedule.dayOfMonth")} hint={t("office.schedule.dayOfMonthHint")}>
            <Input type="number" min={1} max={28} value={String(dayOfMonth)} onChange={(_, d) => setDayOfMonth(Number(d.value))} />
          </Field>
        )}
        <Field label={t("office.schedule.workCovers")}>
          <Select value={period} onChange={(_, d) => setPeriod(d.value as "previous" | "current")}>
            <option value="previous">{t("office.schedule.coverPrev", { unit: t(PERIOD_UNIT_KEYS[kind]) })}</option>
            <option value="current">{t("office.schedule.coverCurr", { unit: t(PERIOD_UNIT_KEYS[kind]) })}</option>
          </Select>
        </Field>
      </div>
      <section aria-label={t("office.schedule.nextRuns")} className={o.inset}>
        <Text weight="semibold" size={200}>
          {t("office.schedule.nextRuns")}
        </Text>
        {ruleProblems.length > 0 ? (
          <Text size={200} className={o.danger}>
            {ruleProblems.join("; ")}
          </Text>
        ) : shown === null ? (
          <Spinner size="tiny" label={t("office.schedule.workingOutNextRuns")} />
        ) : shown.error ? (
          <Text size={200} className={o.danger}>
            {shown.error}
          </Text>
        ) : (
          <ul className={o.list}>
            {(shown.runs ?? []).map((r) => (
              <li key={r.dueAt}>
                <RunLine run={r} timezone={timezone} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className={o.divider} />
      <Text size={100} weight="semibold" className={st.sectionLabel}>
        {t("office.schedule.missionDelivery")}
      </Text>
      <Field label={t("office.schedule.periodWorkLabel")} required>
        <Textarea value={goal} resize="vertical" onChange={(_, d) => setGoal(d.value)} />
      </Field>
      <div className={o.formGrid}>
        <Field label={t("office.assign.deliverables")} hint={t("office.schedule.deliverablesHint")}>
          <Input value={deliverables} onChange={(_, d) => setDeliverables(d.value)} />
        </Field>
        <Field label={t("office.assign.criteriaLabel")} hint={t("office.schedule.criteriaHint")}>
          <Textarea value={criteria} resize="vertical" onChange={(_, d) => setCriteria(d.value)} />
        </Field>
        <Field label={t("office.schedule.recipientsLabel")} hint={t("office.schedule.recipientsHint")}>
          <Input value={recipients} onChange={(_, d) => setRecipients(d.value)} />
        </Field>
        <Field label={t("office.schedule.deliveredTo")}>
          <Select value={channel} onChange={(_, d) => setChannel(d.value as DeliveryChannel)}>
            <option value="inbox">{t("office.schedule.channelInbox")}</option>
            <option value="external">{t("office.schedule.channelExternal")}</option>
          </Select>
        </Field>
        <Field label={t("office.schedule.missedLabel")}>
          <Select value={missed} onChange={(_, d) => setMissed(d.value as MissedPolicy)}>
            {MISSED_POLICIES.map((m) => (
              <option key={m} value={m}>
                {t(MISSED_KEYS[m])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={o.divider} />
      <div className={o.row}>
        <Button type="submit" appearance="primary" disabled={busy || name.trim() === "" || goal.trim() === "" || target === ""}>
          {t("office.schedule.createSchedule")}
        </Button>
        <Button onClick={onCancel}>{t("office.assign.cancel")}</Button>
      </div>
    </form>
  );
}

export function SchedulePage({ go, account }: { go: Go; account: AuthAccount | null }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const list = useOfficeRead<ScheduleView[] | typeof NOT_SERVED>(() => office.schedules().catch(unlessNotServed), [], ["schedules"]);
  const [creating, setCreating] = useState(false);
  if (list.data === NOT_SERVED)
    return (
      <div className={o.page}>
        <MessageBar intent="info" layout="multiline">
          <MessageBarBody>{t("office.schedule.notServed")}</MessageBarBody>
        </MessageBar>
      </div>
    );
  return (
    <div className={o.page}>
      <div className={o.between}>
        <AsOf at={list.loadedAt} />
        {!creating && (
          <Button className={o.touch} appearance="primary" icon={<Add16Regular />} onClick={() => setCreating(true)}>
            {t("office.schedule.newTitle")}
          </Button>
        )}
      </div>
      {creating && (
        <NewSchedule
          account={account}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void list.reload();
          }}
        />
      )}
      {list.data === null ? (
        list.error ? (
          <MessageBar intent="error">
            <MessageBarBody>{list.error}</MessageBarBody>
          </MessageBar>
        ) : (
          <Spinner label={t("office.schedule.reading")} />
        )
      ) : list.data.length === 0 ? (
        <EmptyState icon={<ScheduleIcon size={22} />} tone="teal" title={t("office.schedule.emptyTitle")} body={t("office.schedule.emptyBody")} />
      ) : (
        <ul className={o.list} aria-label={t("office.schedule.listAria")}>
          {list.data.map((s) => (
            <ScheduleItem key={`${s.id}:${s.version}`} s={s} go={go} onChanged={() => void list.reload()} onLoadLatest={() => void list.reload()} />
          ))}
        </ul>
      )}
    </div>
  );
}
