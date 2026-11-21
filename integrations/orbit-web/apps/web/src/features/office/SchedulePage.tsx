// SCHEDULES: work the office makes by itself -- daily, weekly, monthly, quarterly, at a local time of a time zone -- each
// run due at an instant shown in the schedule's own zone and in UTC, and each period's occurrence with where its work
// stands and where its report went. A report is "Sent" only with the receiver's receipt; anything else is said as what it
// is. A new schedule shows its next runs, worked out by the API, as it is written.
import { Badge, Button, Field, Input, Link, MessageBar, MessageBarBody, Select, Spinner, Text, Textarea } from "@fluentui/react-components";
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
import { errorText } from "../../services/api";
import { NOT_SERVED, office, unlessNotServed, useOfficeRead } from "./api";
import { AsOf, ProblemBar, useAction, useOfficeStyles } from "./parts";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KIND_TEXT: Record<ScheduleKind, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };
const MISSED_TEXT: Record<MissedPolicy, string> = { catch_up_latest: "Run the newest missed period", catch_up_each: "Run each missed period (up to the limit)", skip: "Skip missed periods, and say so" };
const PERIOD_UNIT: Record<ScheduleKind, string> = { daily: "day", weekly: "week", monthly: "month", quarterly: "quarter" };

export function ruleText(r: ScheduleRule): string {
  const at = `at ${r.localTime} (${r.timezone})`;
  const when_ = r.kind === "daily" ? "Every day" : r.kind === "weekly" ? `Every ${DAYS[(r.dayOfWeek ?? 1) - 1]}` : r.kind === "monthly" ? `Monthly on day ${r.dayOfMonth ?? 1}` : `Quarterly on day ${r.dayOfMonth ?? 1} of the quarter's first month`;
  return `${when_} ${at}, about the ${PERIOD_UNIT[r.kind]} that ${r.period === "previous" ? "just ended" : "starts"}`;
}

const utc = (iso: string): string => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function RunLine({ run, timezone }: { run: ScheduleRun; timezone: string }) {
  return (
    <Text size={200}>
      {run.local} ({timezone}) · {utc(run.dueAt)} · period {run.periodKey}
    </Text>
  );
}

const deliveryText = (o: OccurrenceView): string => (o.delivery === "none" ? "No delivery" : DELIVERY_STATE_TEXT[o.delivery]);

function Occurrences({ schedule, go }: { schedule: ScheduleView; go: Go }) {
  const o = useOfficeStyles();
  const list = useOfficeRead<OccurrenceView[] | typeof NOT_SERVED>(() => office.occurrences(schedule.id).catch(unlessNotServed), [schedule.id], ["schedules", "missions"]);
  if (list.data === null) return list.error ? <Text className={o.danger}>{list.error}</Text> : <Spinner size="tiny" label="Reading its occurrences…" />;
  if (list.data === NOT_SERVED) return <Text className={o.muted}>Its occurrences are not available on this Orbit Web yet.</Text>;
  if (list.data.length === 0) return <Text className={o.muted}>No period has come yet.</Text>;
  return (
    <ul className={o.list} aria-label={`Occurrences of ${schedule.name}`}>
      {list.data.map((x) => (
        <li key={x.id} className={o.item}>
          <div className={o.row}>
            <Text weight="semibold" size={200}>
              Period {x.periodKey}
            </Text>
            <Badge appearance="tint" color={x.state === "skipped" ? "subtle" : "informative"}>
              {x.state === "skipped" ? "Skipped" : "Work made"}
            </Badge>
            <Badge appearance="tint" color={x.delivery === "SENT" ? "success" : x.delivery === "FAILED" || x.delivery === "NEEDS_RECONCILIATION" ? "danger" : "subtle"}>
              {deliveryText(x)}
            </Badge>
          </div>
          <Text size={200} className={o.muted}>
            Due {utc(x.dueAt)} · schedule revision {x.scheduleRevision}
            {x.assignmentState ? ` · the work: ${ASSIGNMENT_STATE_TEXT[x.assignmentState]}` : ""}
          </Text>
          {x.missionId && (
            <Link as="button" onClick={() => go("mission", x.missionId)}>
              Open the work
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function ScheduleItem({ s: schedule, go, onChanged, onLoadLatest }: { s: ScheduleView; go: Go; onChanged: (s: ScheduleView) => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const act = useAction();
  const [showing, setShowing] = useState(false);
  const next = schedule.next[0] ?? null;
  const paused = schedule.state === "paused";
  return (
    <li className={o.card} aria-label={schedule.name}>
      <div className={o.between}>
        <div className={o.row}>
          <Text weight="semibold">{schedule.name}</Text>
          <Badge appearance="tint" color={paused ? "subtle" : "success"}>
            {paused ? "Paused" : "Active"}
          </Badge>
        </div>
        <div className={o.row}>
          <Button className={o.touch} size="small" disabled={act.busy} onClick={() => void act.run(async () => onChanged(await office.updateSchedule(schedule, { state: paused ? "active" : "paused" })))}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button className={o.touch} size="small" appearance="subtle" onClick={() => setShowing(!showing)} aria-expanded={showing}>
            {showing ? "Hide occurrences" : "Occurrences"}
          </Button>
        </div>
      </div>
      <Text size={200}>{ruleText(schedule.rule)}</Text>
      <Text size={200} className={o.muted}>
        Done by {schedule.employeeName} · {schedule.recipients.length} recipient(s) · {MISSED_TEXT[schedule.missedPolicy]} · revision {schedule.revision}
      </Text>
      {next ? (
        <div className={o.stack}>
          <Text size={200} weight="semibold">
            Next run
          </Text>
          <RunLine run={next} timezone={schedule.rule.timezone} />
        </div>
      ) : (
        <Text size={200} className={o.muted}>
          {paused ? "Paused: no run is due." : "No run is due."}
        </Text>
      )}
      {schedule.lastOccurrence && (
        <Text size={200} className={o.muted}>
          Last: period {schedule.lastOccurrence.periodKey} · {deliveryText(schedule.lastOccurrence)}
        </Text>
      )}
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
      {showing && <Occurrences schedule={schedule} go={go} />}
    </li>
  );
}

function NewSchedule({ account, onCreated, onCancel }: { account: AuthAccount | null; onCreated: () => void; onCancel: () => void }) {
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
      className={o.card}
      aria-label="New schedule"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <Text weight="semibold" size={400}>
        New schedule
      </Text>
      <div className={o.formGrid}>
        <Field label="Name" required>
          <Input value={name} maxLength={80} onChange={(_, d) => setName(d.value)} />
        </Field>
        <Field label="Employee" required>
          <Select value={target} onChange={(_, d) => setEmployeeId(d.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How often">
          <Select value={kind} onChange={(_, d) => setKind(d.value as ScheduleKind)}>
            {SCHEDULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_TEXT[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Time zone">
          <TimeZoneSelect value={timezone} onChange={setTimezone} />
        </Field>
        <Field label="Local time" hint="HH:MM in that time zone.">
          <Input type="time" value={localTime} onChange={(_, d) => setLocalTime(d.value)} />
        </Field>
        {kind === "weekly" && (
          <Field label="Day of the week">
            <Select value={String(dayOfWeek)} onChange={(_, d) => setDayOfWeek(Number(d.value))}>
              {DAYS.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(kind === "monthly" || kind === "quarterly") && (
          <Field label="Day of the month" hint="1 to 28.">
            <Input type="number" min={1} max={28} value={String(dayOfMonth)} onChange={(_, d) => setDayOfMonth(Number(d.value))} />
          </Field>
        )}
        <Field label="The work covers">
          <Select value={period} onChange={(_, d) => setPeriod(d.value as "previous" | "current")}>
            <option value="previous">The {PERIOD_UNIT[kind]} that just ended</option>
            <option value="current">The {PERIOD_UNIT[kind]} that starts</option>
          </Select>
        </Field>
      </div>
      <section aria-label="Next runs" className={o.inset}>
        <Text weight="semibold" size={200}>
          Next runs
        </Text>
        {ruleProblems.length > 0 ? (
          <Text size={200} className={o.danger}>
            {ruleProblems.join("; ")}
          </Text>
        ) : shown === null ? (
          <Spinner size="tiny" label="Working out the next runs…" />
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
      <Field label="What each period's work is" required>
        <Textarea value={goal} resize="vertical" onChange={(_, d) => setGoal(d.value)} />
      </Field>
      <div className={o.formGrid}>
        <Field label="Deliverables" hint="File names, separated by commas.">
          <Input value={deliverables} onChange={(_, d) => setDeliverables(d.value)} />
        </Field>
        <Field label="Acceptance criteria" hint="One per line.">
          <Textarea value={criteria} resize="vertical" onChange={(_, d) => setCriteria(d.value)} />
        </Field>
        <Field label="Recipients" hint="Email addresses, separated by commas.">
          <Input value={recipients} onChange={(_, d) => setRecipients(d.value)} />
        </Field>
        <Field label="Delivered to">
          <Select value={channel} onChange={(_, d) => setChannel(d.value as DeliveryChannel)}>
            <option value="inbox">Their Orbit inbox</option>
            <option value="external">Outside Orbit (needs a delivery channel)</option>
          </Select>
        </Field>
        <Field label="A period nobody ran">
          <Select value={missed} onChange={(_, d) => setMissed(d.value as MissedPolicy)}>
            {MISSED_POLICIES.map((m) => (
              <option key={m} value={m}>
                {MISSED_TEXT[m]}
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
      <div className={o.row}>
        <Button type="submit" appearance="primary" disabled={busy || name.trim() === "" || goal.trim() === "" || target === ""}>
          Create the schedule
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function SchedulePage({ go, account }: { go: Go; account: AuthAccount | null }) {
  const o = useOfficeStyles();
  const list = useOfficeRead<ScheduleView[] | typeof NOT_SERVED>(() => office.schedules().catch(unlessNotServed), [], ["schedules"]);
  const [creating, setCreating] = useState(false);
  if (list.data === NOT_SERVED)
    return (
      <div className={o.page}>
        <MessageBar intent="info" layout="multiline">
          <MessageBarBody>Schedules are not available on this Orbit Web yet: it does not serve them. Work you assign by hand is not affected.</MessageBarBody>
        </MessageBar>
      </div>
    );
  return (
    <div className={o.page}>
      <div className={o.between}>
        <AsOf at={list.loadedAt} />
        {!creating && (
          <Button className={o.touch} appearance="primary" onClick={() => setCreating(true)}>
            New schedule
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
          <Spinner label="Reading the schedules…" />
        )
      ) : list.data.length === 0 ? (
        <Text className={o.muted}>No schedule yet.</Text>
      ) : (
        <ul className={o.list} aria-label="Schedules">
          {list.data.map((s) => (
            <ScheduleItem key={`${s.id}:${s.version}`} s={s} go={go} onChanged={() => void list.reload()} onLoadLatest={() => void list.reload()} />
          ))}
        </ul>
      )}
    </div>
  );
}
