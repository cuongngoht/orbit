// ONE EMPLOYEE: its profile (each change a revision, any revision restorable), its work (what it holds, what waits behind
// it, what it did), its Personal Sandbox and resources (the areas and how each limit is enforced, the attempt running now
// and what its containers use, the resource revisions, and an edit that applies to future attempts), and its employment
// -- each move with its reason. Every change names the version read; a stale one offers the latest.
import { Badge, Button, Field, Input, Link, MessageBar, MessageBarBody, Radio, RadioGroup, Select, Spinner, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import { ASSIGNMENT_STATE_TEXT, DEFAULT_PRESETS, RUNTIME_LABELS, effortLabel, type AssignmentSummary, type EmployeeDetail, type Employment, type EmploymentCommand, type ResourcePreset, type ResourceProfile, type Roster, type SandboxState } from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useResourceSummary } from "../resources/ComputeStorageSection";
import { AREA_TEXT, LEVEL_TEXT, LEVEL_TONE, cpuText, sizeText } from "../resources/format";
import { office, useOfficeRead } from "./api";
import { AssignDialog } from "./AssignDialog";
import { AsOf, ProblemBar, StateBadge, WorkLabelBadge, useAction, useOfficeStyles, when } from "./parts";
import { ResourceFields, resourceProblems, storageProblem } from "./ResourceFields";
import { RunDetails } from "./RunDetails";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

export const EMPLOYEE_TABS = ["profile", "work", "resources", "employment"] as const;
type EmployeeTab = (typeof EMPLOYEE_TABS)[number];
const TAB_TEXT: Record<EmployeeTab, string> = { profile: "Profile", work: "Work", resources: "Sandbox & resources", employment: "Employment" };

const EMPLOYMENT_TEXT: Record<Employment, string> = { candidate: "Candidate", probation: "On probation", active: "Active", suspended: "Suspended", archived: "Archived" };

const SANDBOX_TEXT: Record<SandboxState, string> = { PROVISIONING: "Being prepared", READY: "Ready", FAILED: "Failed", ARCHIVED: "Archived" };

// What may be done next with an employment, and what each move means.
const MOVES: Record<Employment, EmploymentCommand[]> = { candidate: ["start_probation", "activate", "reject"], probation: ["activate", "reject"], active: ["suspend", "archive"], suspended: ["reinstate", "archive"], archived: [] };
const MOVE_TEXT: Record<EmploymentCommand, { label: string; means: string }> = {
  start_probation: { label: "Start the trial", means: "It works trial assignments you review before it is active." },
  activate: { label: "Activate", means: "It takes work as a member of the office." },
  reject: { label: "Reject", means: "It is not hired; its sandbox is archived." },
  suspend: { label: "Suspend", means: "It takes no new work until you reinstate it." },
  reinstate: { label: "Reinstate", means: "It takes work again." },
  archive: { label: "Archive", means: "It leaves the office; its desk and toolbox are kept, read only." },
};

function AssignmentList({ items, go, label, empty }: { items: AssignmentSummary[]; go: Go; label: string; empty: string }) {
  const o = useOfficeStyles();
  if (items.length === 0) return <Text className={o.muted}>{empty}</Text>;
  return (
    <ul className={o.list} aria-label={label}>
      {items.map((a) => (
        <li key={a.id} className={o.item}>
          <div className={o.row}>
            <StateBadge text={ASSIGNMENT_STATE_TEXT[a.state]} state={a.state} />
            <Link className="orbit-target" as="button" onClick={() => go("mission", a.missionId)}>
              {a.title}
            </Link>
          </div>
          <Text size={200} className={o.muted}>
            Updated {when(a.updatedAt)}
            {a.reason ? ` · ${a.reason}` : ""}
            {a.waitingOn ? ` · waiting on ${a.waitingOn}` : ""}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function ProfileTab({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const act = useAction();
  const p = e.profile;
  const [title, setTitle] = useState(p.title);
  const [duties, setDuties] = useState(p.duties);
  const [instructions, setInstructions] = useState(p.instructions);
  const [note, setNote] = useState("");
  const changed = title.trim() !== p.title || duties.trim() !== p.duties || instructions.trim() !== p.instructions;
  const save = () => act.run(async () => onSaved(await office.updateEmployee(e, { profile: { ...p, title: title.trim(), duties: duties.trim(), instructions: instructions.trim() }, note: note.trim() })));
  const restore = (revision: number) =>
    act.run(async () => {
      const old = await office.profileRevision(e.id, revision);
      onSaved(await office.updateEmployee(e, { profile: old.profile, basedOn: revision, note: `Restored revision ${revision}` }));
    });
  const x = p.execution;
  return (
    <>
      <section className={o.card} aria-label="How it runs">
        <Text weight="semibold">How it runs</Text>
        <dl className={o.dl}>
          <dt className={o.dt}>Runtime</dt>
          <dd className={o.dd}>{RUNTIME_LABELS[x.runtime]}</dd>
          <dt className={o.dt}>Connection</dt>
          <dd className={o.dd}>{x.connectionId ? <span className={o.mono}>{x.connectionId}</span> : "The account's default"}</dd>
          <dt className={o.dt}>Model</dt>
          <dd className={o.dd}>{x.model}</dd>
          <dt className={o.dt}>Effort</dt>
          <dd className={o.dd}>{x.effort ? effortLabel(x.effort) : "None"}</dd>
          <dt className={o.dt}>Web search</dt>
          <dd className={o.dd}>{x.webSearch ? "On" : "Off"}</dd>
          <dt className={o.dt}>Orbit plugin</dt>
          <dd className={o.dd}>{x.orbitPlugin ? "On (skills only)" : "Off"}</dd>
          <dt className={o.dt}>Desk</dt>
          <dd className={o.dd}>
            version {e.desk.version} · {e.desk.files} file(s)
          </dd>
        </dl>
      </section>
      <form
        className={o.card}
        aria-label="Role"
        onSubmit={(ev) => {
          ev.preventDefault();
          void save();
        }}
      >
        <Text weight="semibold">Role — profile revision {e.profileRevision}</Text>
        <Field label="Role title" required>
          <Input value={title} onChange={(_, d) => setTitle(d.value)} />
        </Field>
        <Field label="Duties">
          <Textarea value={duties} resize="vertical" onChange={(_, d) => setDuties(d.value)} />
        </Field>
        <Field label="Instructions">
          <Textarea value={instructions} resize="vertical" onChange={(_, d) => setInstructions(d.value)} />
        </Field>
        <Field label="Why it changes" hint="Optional: kept with the revision.">
          <Input value={note} onChange={(_, d) => setNote(d.value)} />
        </Field>
        <Text size={200} className={o.muted}>
          Skills: {p.skills.join(", ") || "none named"} · languages: {p.languages.join(", ") || "none named"}
        </Text>
        <div>
          <Button type="submit" appearance="primary" disabled={act.busy || !changed || title.trim() === ""}>
            Save as a new revision
          </Button>
        </div>
      </form>
      <section className={o.card} aria-label="Profile history">
        <Text weight="semibold">Profile history</Text>
        <ul className={o.list}>
          {[...e.revisions]
            .sort((a, b) => b.revision - a.revision)
            .map((r) => (
              <li key={r.revision} className={o.item}>
                <div className={o.between}>
                  <Text weight="semibold" size={200}>
                    Revision {r.revision}
                    {r.revision === e.profileRevision ? " (current)" : ""}
                  </Text>
                  {r.revision !== e.profileRevision && (
                    <Button className={o.touch} size="small" disabled={act.busy} onClick={() => void restore(r.revision)}>
                      Restore revision {r.revision}
                    </Button>
                  )}
                </div>
                <Text size={200} className={o.muted}>
                  {when(r.createdAt)} by {r.createdBy}
                  {r.basedOn ? ` · copied from revision ${r.basedOn}` : ""}
                  {r.note ? ` · ${r.note}` : ""}
                </Text>
              </li>
            ))}
        </ul>
      </section>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </>
  );
}

function WorkTab({ e, go }: { e: EmployeeDetail; go: Go }) {
  const o = useOfficeStyles();
  return (
    <>
      <section className={o.card} aria-label="Working on">
        <Text weight="semibold">Working on</Text>
        {e.holding ? (
          <div className={o.stack}>
            <div className={o.row}>
              <StateBadge text={ASSIGNMENT_STATE_TEXT[e.holding.state]} state={e.holding.state} />
              <Link className="orbit-target" as="button" onClick={() => go("mission", e.holding?.missionId ?? null)}>
                {e.holding.title}
              </Link>
            </div>
            <Text size={200} className={o.muted}>
              Since {when(e.holding.since)}
            </Text>
            {e.workLabel.startsWith("waiting") && (
              <Text size={200} className={o.warn}>
                Waiting: <WorkLabelBadge label={e.workLabel} />
              </Text>
            )}
          </div>
        ) : (
          <Text className={o.muted}>Nothing: it is free for work.</Text>
        )}
      </section>
      <section className={o.card} aria-label="Queue">
        <Text weight="semibold">Queued behind it ({e.queue.length})</Text>
        <AssignmentList items={e.queue} go={go} label="Queued work" empty="Nothing waits for it." />
      </section>
      <section className={o.card} aria-label="History">
        <Text weight="semibold">History</Text>
        <AssignmentList items={e.history} go={go} label="Past work" empty="No work finished yet." />
      </section>
    </>
  );
}

function EditResources({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const act = useAction();
  const summary = useResourceSummary();
  const presetsRead = useResource<ResourcePreset[]>(() => office.presets(), []);
  const presets = presetsRead.data ?? (presetsRead.error ? DEFAULT_PRESETS : []);
  const current = e.sandbox.resources;
  const [value, setValue] = useState<ResourceProfile>(current);
  const [note, setNote] = useState("");
  const committed = current.deskStorageMiB + current.cacheStorageMiB;
  const problems = [...resourceProblems(value, summary.data?.budget.perEmployee ?? null), ...(storageProblem(value, summary.data, committed) ? ["storage"] : [])];
  const changed = JSON.stringify(value) !== JSON.stringify(current);
  return (
    <form
      className={o.card}
      aria-label="Edit resources"
      onSubmit={(ev) => {
        ev.preventDefault();
        void act.run(async () => onSaved(await office.updateResources(e, { resources: value, note: note.trim() })));
      }}
    >
      <Text weight="semibold">Edit resources</Text>
      <Text size={200}>Applies to future attempts: an attempt already admitted keeps the resources it was admitted under.</Text>
      <ResourceFields value={value} onChange={setValue} presets={presets} summary={summary.data} runtime={e.execution.runtime} committed={committed} />
      <Field label="Why it changes" hint="Optional: kept with the revision.">
        <Input value={note} onChange={(_, d) => setNote(d.value)} />
      </Field>
      <div>
        <Button type="submit" appearance="primary" disabled={act.busy || !changed || problems.length > 0}>
          Save resources
        </Button>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </form>
  );
}

function ResourcesTab({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const [editing, setEditing] = useState(false);
  const sb = e.sandbox;
  const r = sb.resources;
  const run = e.activeRun;
  return (
    <>
      <section className={o.card} aria-label="Personal Sandbox">
        <div className={o.between}>
          <div className={o.row}>
            <Text weight="semibold">Personal Sandbox</Text>
            <Badge appearance="tint" color={sb.state === "READY" ? "success" : sb.state === "FAILED" ? "danger" : sb.state === "PROVISIONING" ? "warning" : "subtle"}>
              {SANDBOX_TEXT[sb.state]}
            </Badge>
            {sb.provider === "process" && (
              <Badge appearance="outline" color="warning">
                Development only: no isolation, no shell
              </Badge>
            )}
          </div>
          <Button className={o.touch} disabled={editing || sb.state === "ARCHIVED"} onClick={() => setEditing(true)}>
            Edit resources
          </Button>
        </div>
        {sb.reason && <Text size={200}>{sb.reason}</Text>}
        <Text size={200}>
          Resources (revision {sb.resourceRevision}): {cpuText(r.cpuMillis)} · {sizeText(r.memoryMiB)} memory · {sizeText(r.deskStorageMiB)} desk · {sizeText(r.scratchStorageMiB)} scratch · {sizeText(r.cacheStorageMiB)} cache · {r.pidsLimit} processes · {r.timeoutMinutes} minutes per attempt
        </Text>
        <div className={o.tableWrap}>
          <Table size="small" aria-label="Storage areas">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Area</TableHeaderCell>
                <TableHeaderCell>Quota</TableHeaderCell>
                <TableHeaderCell>Used</TableHeaderCell>
                <TableHeaderCell>Enforcement</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sb.areas.map((a) => (
                <TableRow key={a.area}>
                  <TableCell>{AREA_TEXT[a.area]}</TableCell>
                  <TableCell>{sizeText(a.quotaMiB)}</TableCell>
                  <TableCell>{a.usedMiB === null ? "not measured" : sizeText(a.usedMiB)}</TableCell>
                  <TableCell>
                    <Badge appearance="tint" color={LEVEL_TONE[a.level]}>
                      {LEVEL_TEXT[a.level]}
                    </Badge>
                    <Text size={200} className={o.muted} block>
                      {a.evidence}
                    </Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      {editing && (
        <EditResources
          e={e}
          onSaved={(d) => {
            setEditing(false);
            onSaved(d);
          }}
          onLoadLatest={onLoadLatest}
        />
      )}
      <section className={o.card} aria-label="Attempt now">
        <Text weight="semibold">Attempt now</Text>
        {run ? <RunDetails run={run} /> : <Text className={o.muted}>No attempt runs now: it holds no CPU or memory.</Text>}
      </section>
      <section className={o.card} aria-label="Resource history">
        <Text weight="semibold">Resource history</Text>
        <ul className={o.list}>
          {[...e.resourceRevisions]
            .sort((a, b) => b.revision - a.revision)
            .map((rv) => (
              <li key={rv.revision} className={o.item}>
                <Text weight="semibold" size={200}>
                  Revision {rv.revision}
                  {rv.revision === sb.resourceRevision ? " (current)" : ""}
                </Text>
                <Text size={200}>
                  {cpuText(rv.profile.cpuMillis)} · {sizeText(rv.profile.memoryMiB)} memory · {sizeText(rv.profile.deskStorageMiB)} desk
                  {rv.profile.presetId ? ` · ${rv.profile.presetId} preset` : " · custom"}
                </Text>
                <Text size={200} className={o.muted}>
                  {when(rv.createdAt)} by {rv.createdBy}
                  {rv.note ? ` · ${rv.note}` : ""}
                </Text>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}

function EmploymentTab({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const act = useAction();
  const roster = useOfficeRead<Roster>(() => office.roster({ department: null, q: "", status: null }), [], ["roster"]);
  const [command, setCommand] = useState<EmploymentCommand | null>(null);
  const [reason, setReason] = useState("");
  const [held, setHeld] = useState<"keep_paused" | "cancel">("keep_paused");
  const [departmentId, setDepartmentId] = useState(e.departmentId ?? "");
  const moves = MOVES[e.employment];
  const departments = (roster.data?.departments ?? []).filter((d) => !d.archived);
  return (
    <>
      <section className={o.card} aria-label="Employment">
        <div className={o.row}>
          <Text weight="semibold">Employment</Text>
          <Badge appearance="tint">{EMPLOYMENT_TEXT[e.employment]}</Badge>
        </div>
        {moves.length === 0 ? (
          <Text className={o.muted}>Nothing more can change: it is archived.</Text>
        ) : (
          <form
            className={o.form}
            onSubmit={(ev) => {
              ev.preventDefault();
              if (command === null) return;
              void act.run(async () => onSaved(await office.employment(e, { command, reason: reason.trim(), ...(command === "suspend" ? { held } : {}) })));
            }}
          >
            <RadioGroup value={command ?? ""} onChange={(_, d) => setCommand(d.value as EmploymentCommand)} aria-label="What to do">
              {moves.map((m) => (
                <Radio key={m} value={m} label={`${MOVE_TEXT[m].label} — ${MOVE_TEXT[m].means}`} />
              ))}
            </RadioGroup>
            {command === "suspend" && e.holding && (
              <Field label={`What happens to “${e.holding.title}”`}>
                <RadioGroup value={held} onChange={(_, d) => setHeld(d.value as "keep_paused" | "cancel")}>
                  <Radio value="keep_paused" label="Keep it, paused" />
                  <Radio value="cancel" label="Cancel it" />
                </RadioGroup>
              </Field>
            )}
            <Field label="Reason" hint="Recorded with the decision.">
              <Input value={reason} onChange={(_, d) => setReason(d.value)} />
            </Field>
            <div>
              <Button type="submit" appearance="primary" disabled={act.busy || command === null}>
                {command ? MOVE_TEXT[command].label : "Choose what to do"}
              </Button>
            </div>
          </form>
        )}
      </section>
      <section className={o.card} aria-label="Department">
        <Text weight="semibold">Department</Text>
        <div className={o.row}>
          <Field label="Move to">
            <Select value={departmentId} onChange={(_, d) => setDepartmentId(d.value)}>
              <option value="">Unassigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button className={o.touch} disabled={act.busy || departmentId === (e.departmentId ?? "")} onClick={() => void act.run(async () => onSaved(await office.moveEmployee(e, departmentId === "" ? null : departmentId)))}>
            Move
          </Button>
        </div>
        <Text size={200} className={o.muted}>
          Work it already holds keeps the department it was claimed under.
        </Text>
      </section>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </>
  );
}

export function EmployeePage({ id, tab, go }: { id: string; tab: string | null; go: Go }) {
  const o = useOfficeStyles();
  const employee = useOfficeRead<EmployeeDetail>(() => office.employee(id), [id], ["roster", "missions", "connections"]);
  const [assigning, setAssigning] = useState(false);
  const restore = useRestoreFocusTarget();
  const current: EmployeeTab = (EMPLOYEE_TABS as readonly string[]).includes(tab ?? "") ? (tab as EmployeeTab) : "profile";
  if (employee.data === null)
    return employee.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{employee.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label="Reading the employee…" />
    );
  const e = employee.data;
  const reload = () => void employee.reload();
  const saved = (d: EmployeeDetail) => employee.set(d);
  return (
    <div className={o.page}>
      <div className={o.between}>
        <div className={o.stack}>
          <div className={o.row}>
            <Text as="h2" weight="semibold" size={500} className={o.wrap}>
              {e.name}
            </Text>
            <WorkLabelBadge label={e.workLabel} />
            <Badge appearance="outline">{EMPLOYMENT_TEXT[e.employment]}</Badge>
          </div>
          <Text size={200} className={o.muted}>
            {e.title} · {RUNTIME_LABELS[e.execution.runtime]} · {e.execution.model}
            {e.execution.effort ? ` · ${effortLabel(e.execution.effort)}` : ""}
          </Text>
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
          <AsOf at={employee.loadedAt} />
        </div>
        <Button className={o.touch} appearance="primary" disabled={e.employment === "archived"} onClick={() => setAssigning(true)} {...restore}>
          Assign work
        </Button>
      </div>
      <div className={`${o.tabStrip} orbit-hscroll`}>
        <TabList selectedValue={current} onTabSelect={(_, d) => go("employee", id, d.value as string)} aria-label="Employee">
          {EMPLOYEE_TABS.map((t) => (
            <Tab key={t} value={t}>
              {TAB_TEXT[t]}
            </Tab>
          ))}
        </TabList>
      </div>
      {current === "profile" && <ProfileTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {current === "work" && <WorkTab e={e} go={go} />}
      {current === "resources" && <ResourcesTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {current === "employment" && <EmploymentTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {assigning && <AssignDialog employees={[e]} employeeId={e.id} onClose={() => setAssigning(false)} onOpenMission={(m) => go("mission", m)} />}
    </div>
  );
}
