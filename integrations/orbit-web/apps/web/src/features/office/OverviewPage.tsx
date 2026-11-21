// THE OFFICE, at a glance: its employees as cards grouped by department -- each with its work label in words, what it
// holds and how much waits behind it, why it is not ready, a warning about its connection -- filtered by department
// (or Unassigned), a search and a work label. From here a person assigns work, hires (once an AI CLI is connected) and
// shapes the departments. An account with no office yet is offered one, with example departments it may skip.
import { Button, Checkbox, Field, Input, Link, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody, SearchBox, Select, Spinner, Text, makeStyles, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add16Regular, Filter20Regular, MoreHorizontal16Regular, PersonAdd20Regular, TaskListLtr20Regular } from "@fluentui/react-icons";
import { WORK_LABELS, WORK_LABEL_TEXT, type AuthAccount, type Department, type EmployeeCard, type Roster, type WorkLabel } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import { settingsHref, type OfficePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { errorText } from "../../services/api";
import { useConnections } from "../connections/AiConnectionsSection";
import { office, useOfficeRead, type RosterQuery } from "./api";
import { AssignDialog } from "./AssignDialog";
import { DepartmentDialog, type DepartmentEdit } from "./DepartmentDialogs";
import { HireWizard } from "./HireWizard";
import { AsOf, WorkLabelBadge, useOfficeStyles, when } from "./parts";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const useStyles = makeStyles({
  toolbar: { display: "flex", alignItems: "flex-end", gap: "8px", flexWrap: "wrap", minWidth: 0 },
  search: { flexGrow: 1, minWidth: "min(100%, 200px)", maxWidth: "360px" },
  select: { minWidth: "min(100%, 180px)" },
  name: { paddingLeft: 0, paddingRight: 0, minWidth: 0, justifyContent: "flex-start", fontWeight: 600, textAlign: "left", overflowWrap: "anywhere", height: "auto" },
  group: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 },
});

const EXAMPLES = ["Accounting", "Legal", "Sales"] as const;

function SetUpOffice({ account, onDone }: { account: AuthAccount | null; onDone: () => void }) {
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
    <form
      className={o.card}
      aria-label="Set up the office"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Text weight="semibold" size={500} as="h2">
        Set up your office
      </Text>
      <Text>Your office holds departments and the AI employees you hire into them. Setting it up needs no AI connection; hiring does.</Text>
      <Field label="Office name">
        <Input value={name} maxLength={80} onChange={(_, d) => setName(d.value)} />
      </Field>
      <Field label="Start with example departments" hint="Untick any you do not want; you can add, rename and archive departments later.">
        <div className={o.row}>
          {EXAMPLES.map((d) => (
            <Checkbox key={d} label={d} checked={examples[d] === true} onChange={(_, c) => setExamples((x) => ({ ...x, [d]: c.checked === true }))} />
          ))}
        </div>
      </Field>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div>
        <Button appearance="primary" type="submit" disabled={busy}>
          {busy ? "Setting up…" : "Set up the office"}
        </Button>
      </div>
    </form>
  );
}

function Card({ e, go, onAssign }: { e: EmployeeCard; go: Go; onAssign: (id: string) => void }) {
  const s = useStyles();
  const o = useOfficeStyles();
  const restore = useRestoreFocusTarget();
  return (
    <article className={o.card} aria-label={e.name}>
      <div className={o.between}>
        <Button className={s.name} appearance="transparent" onClick={() => go("employee", e.id)}>
          {e.name}
        </Button>
        <WorkLabelBadge label={e.workLabel} />
      </div>
      <Text size={200} className={o.muted}>
        {e.title}
        {e.kind === "assistant" ? ` · temporary assistant${e.expiresAt ? ` until ${when(e.expiresAt)}` : ""}` : ""}
      </Text>
      {e.holding && (
        <Text size={200} className={o.wrap}>
          Holding:{" "}
          <Link as="button" onClick={() => go("mission", e.holding?.missionId ?? null)}>
            {e.holding.title}
          </Link>{" "}
          since {when(e.holding.since)}
        </Text>
      )}
      {e.queued > 0 && <Text size={200}>{e.queued} queued behind it</Text>}
      {e.notReadyReason && (
        <Text size={200} className={o.danger}>
          Not ready: {e.notReadyReason}
        </Text>
      )}
      {e.connectionWarning && (
        <Text size={200} className={o.warn}>
          Connection: {e.connectionWarning}
        </Text>
      )}
      <div className={o.between}>
        <Text size={200} className={o.muted}>
          Updated {when(e.updatedAt)}
        </Text>
        <Button className={o.touch} size="small" icon={<TaskListLtr20Regular />} disabled={e.employment === "archived"} onClick={() => onAssign(e.id)} aria-label={`Assign work to ${e.name}`} {...restore}>
          Assign work
        </Button>
      </div>
    </article>
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

// The cards of one read of the roster, and the pages after it that "Load more" brings.
function RosterBody({ roster, filter, query, go, onAssign, onEdit }: { roster: Roster; filter: string; query: RosterQuery; go: Go; onAssign: (id: string) => void; onEdit: (e: DepartmentEdit) => void }) {
  const s = useStyles();
  const o = useOfficeStyles();
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
  return (
    <>
      {groups.map((g) => (
        <section key={g.department?.id ?? "unassigned"} className={s.group} aria-label={g.department?.name ?? "Unassigned"}>
          <div className={o.between}>
            <Text as="h3" weight="semibold" size={400}>
              {g.department?.name ?? "Unassigned"}{" "}
              <Text size={200} className={o.muted}>
                ({g.department ? `${g.department.members} ${g.department.members === 1 ? "member" : "members"}` : `${g.employees.length} shown`})
              </Text>
            </Text>
            {g.department && (
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button className={o.touch} appearance="subtle" size="small" icon={<MoreHorizontal16Regular />} aria-label={`Actions for ${g.department.name}`} />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => g.department && onEdit({ kind: "rename", department: g.department })}>Rename</MenuItem>
                    <MenuItem onClick={() => g.department && onEdit({ kind: "archive", department: g.department })}>Archive</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            )}
          </div>
          {g.employees.length === 0 ? (
            <Text size={200} className={o.muted}>
              No employee here{filter === "all" ? " yet" : " matches"}.
            </Text>
          ) : (
            <div className={o.grid}>
              {g.employees.map((e) => (
                <Card key={e.id} e={e} go={go} onAssign={onAssign} />
              ))}
            </div>
          )}
        </section>
      ))}
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
      <div className={o.between}>
        <div className={o.stack}>
          <Text weight="semibold" size={500} as="h2">
            {r.office.name}
          </Text>
          <Text size={200} className={o.muted}>
            {c.employees} employees · {c.ready} ready · {c.busy} busy · {c.notReady} not ready · {c.queued} queued ·{" "}
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
      {!canHire && (
        <Text size={200} role="status">
          {connections.data === null ? "Checking your AI connections…" : "Connect an AI CLI first: hiring needs one connected CLI whose models were read from your account. "}
          {connections.data !== null && <Link href={settingsHref("ai-connections")}>Open Settings → AI Connections</Link>}
        </Text>
      )}
      <div className={s.toolbar}>
        <SearchBox className={s.search} placeholder="Search employees" aria-label="Search employees" value={typed} onChange={(_, d) => setTyped(d.value)} />
        {isMobile ? (
          <Button className={o.touch} icon={<Filter20Regular />} onClick={() => setFilters(true)}>
            Filters{department !== "all" || status !== "all" ? " (on)" : ""}
          </Button>
        ) : (
          pickers
        )}
      </div>
      {isMobile && (
        <ResponsiveSheet open={filters} onOpenChange={setFilters} title="Filters">
          {pickers}
        </ResponsiveSheet>
      )}
      <RosterBody key={`${r.asOf}:${r.version}`} roster={r} filter={department} query={query} go={go} onAssign={(id) => setAssigning({ employeeId: id })} onEdit={setEditing} />
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
