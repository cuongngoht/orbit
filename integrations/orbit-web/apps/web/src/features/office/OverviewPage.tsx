// THE OFFICE, at a glance: its employees as cards grouped by department -- each with its work label in words, what it
// holds and how much waits behind it, why it is not ready, a warning about its connection -- filtered by department
// (or Unassigned), a search and a work label. From here a person assigns work, hires (once an AI CLI is connected) and
// shapes the departments. An account with no office yet is offered one, with example departments it may skip.
import { Button, Checkbox, Field, Input, Link, MessageBar, MessageBarBody, SearchBox, Select, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add16Regular, Dismiss16Regular, Filter20Regular, PersonAdd20Regular, PlugDisconnected16Regular, TaskListLtr20Regular } from "@fluentui/react-icons";
import { WORK_LABELS, WORK_LABEL_TEXT, type AuthAccount, type Department, type EmployeeCard, type Roster, type WorkLabel } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import {
  IconBadge,
  InboxActionIcon,
  NotReadyIcon,
  OfficeIcon,
  QueuedIcon,
  ReadyIcon,
  RosterIcon,
  WorkingIcon,
} from "../../components/SectionIcons";
import { settingsHref, type OfficePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { errorText } from "../../services/api";
import { useConnections } from "../connections/AiConnectionsSection";
import { office, useOfficeRead, type RosterQuery } from "./api";
import { AssignDialog } from "./AssignDialog";
import { DepartmentDialog, type DepartmentEdit } from "./DepartmentDialogs";
import { HireWizard } from "./HireWizard";
import { AsOf, Callout, EmptyState, useOfficeStyles } from "./parts";
import { OfficeFloorMap } from "./OfficeFloorMap";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const useStyles = makeStyles({
  setupWrap: { maxWidth: "600px", width: "100%", marginLeft: "auto", marginRight: "auto", marginTop: "8px" },
  setupEmblem: {
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  exampleTile: {
    paddingTop: "6px",
    paddingRight: "12px",
    paddingBottom: "6px",
    paddingLeft: "8px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statValue: { fontVariantNumeric: "tabular-nums", lineHeight: "1.15" },
  statReady: { color: tokens.colorPaletteGreenForeground1 },
  statBusy: { color: tokens.colorBrandForeground1 },
  statDanger: { color: tokens.colorPaletteRedForeground1 },
  statWarn: { color: tokens.colorPaletteDarkOrangeForeground1 },
  statInboxAlert: {
    backgroundColor: tokens.colorPaletteDarkOrangeBackground1,
    ...shorthands.borderColor(tokens.colorPaletteDarkOrangeBorder1),
  },
  filterBar: {
    display: "flex",
    alignItems: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
    minWidth: 0,
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "14px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  search: { flexGrow: 1, minWidth: "min(100%, 220px)", maxWidth: "380px" },
  // On a phone: the search takes the row, the Filters button keeps its own width.
  toolbarMobile: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" },
  searchMobile: { width: "100%", minWidth: 0, maxWidth: "100%" },
  select: { minWidth: "min(100%, 185px)" },
});

const EXAMPLES = ["Accounting", "Legal", "Sales"] as const;

function SetUpOffice({ account, onDone }: { account: AuthAccount | null; onDone: () => void }) {
  const s = useStyles();
  const o = useOfficeStyles();
  const [name, setName] = useState(account?.companyName || "Office");
  const [examples, setExamples] = useState<Record<string, boolean>>({ Accounting: true, Legal: true, Sales: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await office.setUp({ name: name.trim() || "Office", departments: EXAMPLES.filter((d) => examples[d]) });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.setupWrap}>
      <form
        className={o.heroCard}
        aria-label="Set up the office"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className={o.row}>
          <IconBadge icon={<OfficeIcon size={22} active />} tone="brand" size="lg" />
          <div className={o.stack}>
            <Text weight="semibold" size={500} as="h2">
              Set up your office
            </Text>
            <Text size={200} className={o.muted}>
              Your office holds departments and the AI employees you hire into them. Setting it up needs no AI connection; hiring does.
            </Text>
          </div>
        </div>
        <div className={o.divider} />
        <Field label="Office name">
          <Input value={name} maxLength={80} onChange={(_, d) => setName(d.value)} />
        </Field>
        <div role="group" aria-label="Start with example departments" className={o.stack}>
          <Text weight="semibold" size={300}>
            Start with example departments
          </Text>
          <div className={o.row}>
            {EXAMPLES.map((d) => (
              <span key={d} className={s.exampleTile}>
                <Checkbox label={d} checked={examples[d] === true} onChange={(_, c) => setExamples((x) => ({ ...x, [d]: c.checked === true }))} />
              </span>
            ))}
          </div>
          <Text size={200} className={o.muted}>
            Untick any you do not want; you can add, rename and archive departments later.
          </Text>
        </div>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <div className={o.row}>
          <Button appearance="primary" type="submit" disabled={busy}>
            {busy ? "Setting up…" : "Set up the office"}
          </Button>
        </div>
      </form>
    </div>
  );
}

interface Group {
  department: Department | null;
  employees: EmployeeCard[];
}

function groupsOf(roster: Roster, employees: EmployeeCard[], filter: string): Group[] {
  const live = [...roster.departments].filter((d) => !d.archived).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const groups: Group[] = live.map((d) => ({ department: d, employees: employees.filter((e) => e.departmentId === d.id) }));
  const known = new Set(live.map((d) => d.id));
  groups.push({ department: null, employees: employees.filter((e) => e.departmentId === null || !known.has(e.departmentId)) });
  if (filter === "none") return groups.filter((g) => g.department === null);
  if (filter !== "all") return groups.filter((g) => g.department?.id === filter);
  return groups.filter((g) => g.department !== null || g.employees.length > 0);
}

// The unified company floor for one read of the roster, and any extra pages brought by "Load more".
function RosterBody({ roster, filter, query, account, go, onAssign, onEdit }: { roster: Roster; filter: string; query: RosterQuery; account: AuthAccount | null; go: Go; onAssign: (id: string) => void; onEdit: (e: DepartmentEdit) => void }) {
  const [more, setMore] = useState<EmployeeCard[]>([]);
  const [cursor, setCursor] = useState(roster.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const employees = [...roster.employees, ...more.filter((m) => !roster.employees.some((e) => e.id === m.id))];
  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await office.roster({ ...query, cursor });
      setMore((m) => [...m, ...next.employees]);
      setCursor(next.nextCursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  const groups = groupsOf(roster, employees, filter);
  if (groups.length === 0) {
    return <EmptyState icon={<RosterIcon size={22} />} tone="brand" title="No departments or employees yet" body="Add a department or hire your first AI employee to organize the office." />;
  }
  return (
    <>
      <OfficeFloorMap
        groups={groups}
        filter={filter}
        account={account}
        onAssign={onAssign}
        onOpenEmployee={(id) => go("employee", id)}
        onOpenMission={(id) => go("mission", id)}
        onEditDepartment={onEdit}
      />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {cursor !== null && (
        <div>
          <Button disabled={loading} onClick={() => void loadMore()}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}

export function OverviewPage({ go, account }: { go: Go; account: AuthAccount | null }) {
  const s = useStyles();
  const o = useOfficeStyles();
  const { isMobile } = useViewport();
  const [department, setDepartment] = useState("all");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<WorkLabel | "all">("all");
  const [hiring, setHiring] = useState(false);
  const [assigning, setAssigning] = useState<{ employeeId: string | null } | null>(null);
  const [editing, setEditing] = useState<DepartmentEdit | null>(null);
  const [filters, setFilters] = useState(false);
  const restore = useRestoreFocusTarget();
  // A search is asked once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);
  const query: RosterQuery = { department: department === "all" ? null : department, q, status: status === "all" ? null : status };
  const roster = useOfficeRead<Roster>(() => office.roster(query), [department, q, status], ["roster", "connections", "inbox"]);
  const connections = useConnections();
  const canHire = connections.data?.canHire === true;

  if (roster.data === null)
    return roster.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{roster.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label="Reading the office…" />
    );
  const r = roster.data;
  if (r.office === null)
    return (
      <div className={o.page}>
        <SetUpOffice account={account} onDone={() => void roster.reload()} />
      </div>
    );
  const live = r.departments.filter((d) => !d.archived);
  const filtered = department !== "all" || status !== "all" || typed !== "";
  const clearFilters = () => {
    setDepartment("all");
    setStatus("all");
    setTyped("");
    setQ("");
  };
  const pickers = (
    <>
      <Field label="Department" className={s.select}>
        <Select value={department} onChange={(_, d) => setDepartment(d.value)}>
          <option value="all">All departments</option>
          {live.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value="none">Unassigned</option>
        </Select>
      </Field>
      <Field label="Status" className={s.select}>
        <Select value={status} onChange={(_, d) => setStatus(d.value as WorkLabel | "all")}>
          <option value="all">Any status</option>
          {WORK_LABELS.map((l) => (
            <option key={l} value={l}>
              {WORK_LABEL_TEXT[l]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
  const c = r.counts;
  return (
    <div className={o.page}>
      <section className={o.heroCard} aria-label={r.office.name}>
        <div className={o.between}>
          <div className={o.stack}>
            <Text weight="semibold" size={600} as="h2">
              {r.office.name}
            </Text>
            <Text size={200} className={o.muted}>
              {c.employees} {c.employees === 1 ? "employee" : "employees"} · {c.ready} ready · {c.busy} busy · {c.notReady} not ready · {c.queued} queued ·{" "}
              <Link as="button" onClick={() => go("inbox")}>
                {c.inbox} need you
              </Link>
            </Text>
            <AsOf at={r.asOf} />
          </div>
          <div className={o.row}>
            <Button className={o.touch} appearance="primary" icon={<PersonAdd20Regular />} disabled={!canHire} onClick={() => setHiring(true)} {...restore}>
              Hire employee
            </Button>
            <Button className={o.touch} icon={<TaskListLtr20Regular />} disabled={r.employees.length === 0} onClick={() => setAssigning({ employeeId: null })} {...restore}>
              Assign work
            </Button>
            <Button className={o.touch} icon={<Add16Regular />} onClick={() => setEditing({ kind: "new" })} {...restore}>
              New department
            </Button>
          </div>
        </div>
        <div className={o.statGrid}>
          <div className={o.statCard}>
            <div className={o.between} style={{ flexWrap: "nowrap" }}>
              <Text size={200} className={o.muted}>
                Total roster
              </Text>
              <IconBadge icon={<RosterIcon size={14} />} tone="brand" size="sm" />
            </div>
            <Text size={600} weight="semibold" className={s.statValue}>
              {c.employees}
            </Text>
          </div>
          <div className={o.statCard}>
            <div className={o.between} style={{ flexWrap: "nowrap" }}>
              <Text size={200} className={o.muted}>
                Ready
              </Text>
              <IconBadge icon={<ReadyIcon size={14} />} tone={c.ready > 0 ? "success" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.ready > 0 && s.statReady)}>
              {c.ready}
            </Text>
          </div>
          <div className={o.statCard}>
            <div className={o.between} style={{ flexWrap: "nowrap" }}>
              <Text size={200} className={o.muted}>
                Working
              </Text>
              <IconBadge icon={<WorkingIcon size={14} />} tone={c.busy > 0 ? "brand" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.busy > 0 && s.statBusy)}>
              {c.busy}
            </Text>
          </div>
          <div className={o.statCard}>
            <div className={o.between} style={{ flexWrap: "nowrap" }}>
              <Text size={200} className={o.muted}>
                Queued
              </Text>
              <IconBadge icon={<QueuedIcon size={14} />} tone="neutral" size="sm" />
            </div>
            <Text size={600} weight="semibold" className={s.statValue}>
              {c.queued}
            </Text>
          </div>
          <div className={o.statCard}>
            <div className={o.between} style={{ flexWrap: "nowrap" }}>
              <Text size={200} className={o.muted}>
                Not ready
              </Text>
              <IconBadge icon={<NotReadyIcon size={14} />} tone={c.notReady > 0 ? "danger" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.notReady > 0 && s.statDanger)}>
              {c.notReady}
            </Text>
          </div>
          <button type="button" className={mergeClasses(o.statCard, o.statCardAction, c.inbox > 0 && s.statInboxAlert)} onClick={() => go("inbox")} aria-label={`Open Needs me (${c.inbox})`}>
            <div className={o.between} style={{ flexWrap: "nowrap", width: "100%" }}>
              <Text size={200} className={c.inbox > 0 ? s.statWarn : o.muted}>
                Needs you
              </Text>
              <IconBadge icon={<InboxActionIcon size={14} />} tone={c.inbox > 0 ? "warning" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.inbox > 0 && s.statWarn)}>
              {c.inbox}
            </Text>
          </button>
        </div>
      </section>
      {!canHire && (
        <Callout tone={connections.data === null ? "info" : "warn"} icon={<PlugDisconnected16Regular />} role="status">
          {connections.data === null ? "Checking your AI connections…" : "Connect an AI CLI first: hiring needs one connected CLI whose models were read from your account. "}
          {connections.data !== null && <Link href={settingsHref("ai-connections")}>Open Settings → AI Connections</Link>}
        </Callout>
      )}
      <div className={mergeClasses(s.filterBar, isMobile && s.toolbarMobile)}>
        {isMobile ? (
          <>
            <SearchBox className={mergeClasses(s.search, s.searchMobile)} placeholder="Search employees" aria-label="Search employees" value={typed} onChange={(_, d) => setTyped(d.value)} />
            <Button className={o.touch} icon={<Filter20Regular />} onClick={() => setFilters(true)}>
              Filters{department !== "all" || status !== "all" ? " (on)" : ""}
            </Button>
          </>
        ) : (
          <>
            <Field label="Search" className={s.search}>
              <SearchBox style={{ width: "100%" }} placeholder="Search employees" aria-label="Search employees" value={typed} onChange={(_, d) => setTyped(d.value)} />
            </Field>
            {pickers}
            {filtered && (
              <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={clearFilters}>
                Clear
              </Button>
            )}
          </>
        )}
      </div>
      {isMobile && (
        <ResponsiveSheet open={filters} onOpenChange={setFilters} title="Filters">
          <div className={mergeClasses(o.form, "orbit-touch")}>
            {pickers}
            {filtered && (
              <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={() => { clearFilters(); setFilters(false); }}>
                Clear filters
              </Button>
            )}
          </div>
        </ResponsiveSheet>
      )}
      <RosterBody key={`${r.asOf}:${r.version}`} roster={r} filter={department} query={query} account={account} go={go} onAssign={(id) => setAssigning({ employeeId: id })} onEdit={setEditing} />
      {hiring && (
        <HireWizard
          departments={r.departments}
          onClose={() => setHiring(false)}
          onHired={(e) => {
            setHiring(false);
            go("employee", e.id);
          }}
        />
      )}
      {assigning && <AssignDialog employees={r.employees} employeeId={assigning.employeeId} onClose={() => setAssigning(null)} onOpenMission={(id) => go("mission", id)} />}
      {editing && (
        <DepartmentDialog
          edit={editing}
          departments={r.departments}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void roster.reload();
          }}
        />
      )}
    </div>
  );
}
