// ONE MISSION: what was wanted and who holds it (with the plan of its assignments), what happened in order, the results
// handed in -- each revision with its artifacts, its claims (supported by a source, or not) and what it is missing -- and
// the last attempt, its model, effort and resources as asked, resolved and observed. A review names the revision being
// read (its digest) and the assignment's version: if either moved on, nothing is done and the page offers the latest.
import { Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Link, MessageBar, MessageBarBody, Radio, RadioGroup, Spinner, Tab, TabList, Text, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import { ArrowDownload16Regular } from "@fluentui/react-icons";
import { ASSIGNMENT_STATE_TEXT, DELIVERY_STATE_TEXT, type AssignmentView, type DeliveryView, type HandoffStatus, type HandoffView, type MissionDetail, type TeamRoomChange } from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { bytesText } from "../resources/format";
import { isNotServed, office, useOfficeRead, type AssignmentCommand } from "./api";
import { AsOf, ProblemBar, RUN_STATE_TEXT, StateBadge, short, useAction, useOfficeStyles, when } from "./parts";
import { RunDetails } from "./RunDetails";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

export const MISSION_TABS = ["overview", "timeline", "handoffs", "team", "run"] as const;
type MissionTab = (typeof MISSION_TABS)[number];
const TAB_TEXT: Record<MissionTab, string> = { overview: "Overview", timeline: "Timeline", handoffs: "Handoffs", team: "Team room", run: "Last run" };

const HANDOFF_TEXT: Record<HandoffStatus, string> = { submitted: "Submitted", revision_requested: "Revision requested", accepted: "Accepted", superseded: "Superseded" };

const ACTION_TEXT: Partial<Record<AssignmentCommand, string>> = { pause: "Pause", resume: "Resume", cancel: "Cancel the work", retry: "Retry" };

// The commands of an assignment a person may give from its Overview (a review is given from its handoff).
const ROUTE_OF: Record<string, AssignmentCommand> = { pause: "pause", resume: "resume", cancel: "cancel", retry: "retry", answer: "answer", accept: "accept", request_revision: "request-revision" };

function AssignmentActions({ a, onDone, onLoadLatest }: { a: AssignmentView; onDone: () => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const act = useAction();
  const [answer, setAnswer] = useState("");
  const commands = a.actions.map((x) => ROUTE_OF[x]).filter((c): c is AssignmentCommand => c !== undefined && c !== "accept" && c !== "request-revision" && c !== "answer");
  const run = async (command: AssignmentCommand, body?: unknown) => {
    if (await act.run(() => office.command(a.id, a.version, command, body))) onDone();
  };
  return (
    <div className={o.stack}>
      {commands.length > 0 && (
        <div className={o.row}>
          {commands.map((c) => (
            <Button key={c} className={o.touch} size="small" disabled={act.busy} onClick={() => void run(c)}>
              {ACTION_TEXT[c] ?? c}
            </Button>
          ))}
        </div>
      )}
      {a.actions.includes("answer") && (
        <form
          className={o.form}
          aria-label="Answer the employee"
          onSubmit={(e) => {
            e.preventDefault();
            void run("answer", { answer: answer.trim() });
          }}
        >
          <Field label="Your answer" hint={a.waitingOn ? `It asked: ${a.waitingOn}` : "It waits for information from you."}>
            <Textarea value={answer} resize="vertical" onChange={(_, d) => setAnswer(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || answer.trim() === ""}>
              Send the answer
            </Button>
          </div>
        </form>
      )}
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </div>
  );
}

function AssignmentRow({ a, go, depth }: { a: AssignmentView; go: Go; depth: number }) {
  const o = useOfficeStyles();
  return (
    <li className={o.item} style={{ marginLeft: `${Math.min(depth, 3) * 16}px` }}>
      <div className={o.row}>
        <StateBadge text={ASSIGNMENT_STATE_TEXT[a.state]} state={a.state} />
        <Text weight="semibold">{a.title}</Text>
      </div>
      <Text size={200}>
        Held by{" "}
        <Link as="button" onClick={() => go("employee", a.employeeId)}>
          {a.employeeName}
        </Link>
        {a.pinned.departmentName ? ` (${a.pinned.departmentName} when claimed)` : ""} · {a.attempts} attempt(s) · revision {a.handoffRevision}
      </Text>
      {a.unitKey !== null && (
        <Text size={200} className={o.muted}>
          Part “{a.unitKey}” of its manager's plan{a.brief.dependsOn.length > 0 ? ` · waits for ${a.brief.dependsOn.map((k) => `“${k}”`).join(", ")}` : ""}
        </Text>
      )}
      {(a.reason || a.waitingOn) && (
        <Text size={200} className={o.warn}>
          {a.reason ?? ""}
          {a.waitingOn ? ` Waiting on: ${a.waitingOn}` : ""}
        </Text>
      )}
      {a.lastRun && (a.lastRun.state === "waiting_for_resources" || a.lastRun.state === "unschedulable") && (
        <Text size={200} className={a.lastRun.state === "unschedulable" ? o.danger : o.warn}>
          {RUN_STATE_TEXT[a.lastRun.state]}: {a.lastRun.waitingReason ?? "no reason given"}
        </Text>
      )}
    </li>
  );
}

// The plan: the root assignment and, under each, the assignments it delegated.
function Plan({ assignments, go }: { assignments: AssignmentView[]; go: Go }) {
  const o = useOfficeStyles();
  const rows: { a: AssignmentView; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of assignments.filter((x) => x.parentId === parent)) {
      rows.push({ a, depth });
      if (depth < 8) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything whose parent is not in the list is shown at the top, never hidden.
  for (const a of assignments) if (!rows.some((r) => r.a.id === a.id)) rows.push({ a, depth: 0 });
  return (
    <ul className={o.list} aria-label="Assignments">
      {rows.map(({ a, depth }) => (
        <AssignmentRow key={a.id} a={a} go={go} depth={depth} />
      ))}
    </ul>
  );
}

// The mission's team room: every change its members' attempts made, in order -- which file, what it became, and whose
// attempt changed it. The room is a workbench shared by the mission's team; what was accepted is in the handoffs.
function TeamRoom({ missionId, go }: { missionId: string; go: Go }) {
  const o = useOfficeStyles();
  const changes = useOfficeRead<TeamRoomChange[]>(() => office.teamRoom(missionId), [missionId], ["missions"], missionId);
  if (changes.data === null)
    return changes.error ? (
      <MessageBar intent="error">
        <MessageBarBody>The team room could not be read: {changes.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner size="tiny" label="Reading the team room…" />
    );
  if (changes.data.length === 0)
    return (
      <Text className={o.muted}>
        Nothing was written in a team room for this mission. A team lead's mission has one: its members share it while they work, and each change is kept here with whose attempt made it.
      </Text>
    );
  return (
    <ol className={o.list} aria-label="Team room changes">
      {changes.data.map((c, i) => (
        <li key={`${i}:${c.path}`} className={o.item}>
          <div className={o.row}>
            <Text weight="semibold" size={200} className={o.mono}>
              {c.path}
            </Text>
            <Text size={200} className={o.muted}>
              {c.sha256 === null ? "removed" : `${bytesText(c.size)} · ${short(c.sha256)}`}
            </Text>
          </div>
          <Text size={200} className={o.muted}>
            {when(c.at)} ·{" "}
            {c.employeeId !== null && c.employeeName !== null ? (
              <Link as="button" onClick={() => go("employee", c.employeeId)}>
                {c.employeeName}
              </Link>
            ) : (
              "an attempt no longer on record"
            )}
          </Text>
        </li>
      ))}
    </ol>
  );
}

function Delivery({ d, onDone }: { d: DeliveryView; onDone: () => void }) {
  const o = useOfficeStyles();
  const act = useAction();
  const [outcome, setOutcome] = useState<"delivered" | "resend">("delivered");
  const [reason, setReason] = useState("");
  return (
    <li className={o.item}>
      <div className={o.row}>
        <Text weight="semibold" size={200}>
          {d.recipient.address}
        </Text>
        <Badge appearance="tint" color={d.state === "SENT" ? "success" : d.state === "FAILED" || d.state === "NEEDS_RECONCILIATION" ? "danger" : "informative"}>
          {DELIVERY_STATE_TEXT[d.state]}
        </Badge>
        <Text size={200} className={o.muted}>
          {d.attempts} attempt(s){d.receipt ? ` · receipt ${d.receipt}` : ""}
        </Text>
      </div>
      {d.detail && <Text size={200}>{d.detail}</Text>}
      {d.state === "NEEDS_RECONCILIATION" && (
        <form
          className={o.form}
          aria-label={`Settle the delivery to ${d.recipient.address}`}
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => office.resolveDelivery(d.id, { outcome, reason: reason.trim() }).catch((err: unknown) => Promise.reject(isNotServed(err) ? new Error("Deliveries are not served by this Orbit Web yet: nothing was recorded.") : err))).then((ok) => ok && onDone());
          }}
        >
          <RadioGroup value={outcome} onChange={(_, v) => setOutcome(v.value as "delivered" | "resend")}>
            <Radio value="delivered" label="It reached the receiver" />
            <Radio value="resend" label="Send it again" />
          </RadioGroup>
          <Field label="How you know" required>
            <Input value={reason} onChange={(_, v) => setReason(v.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={act.busy || reason.trim() === ""}>
              Record it
            </Button>
          </div>
          <ProblemBar problem={act.problem} />
        </form>
      )}
    </li>
  );
}

function AcceptDialog({ h, onClose, onConfirm, busy }: { h: HandoffView; onClose: () => void; onConfirm: (note: string) => void; busy: boolean }) {
  const o = useOfficeStyles();
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <DialogBody>
          <DialogTitle>
            Accept revision {h.revision}?
          </DialogTitle>
          <DialogContent className={o.form}>
            <Text>
              You accept exactly revision {h.revision} (digest <span className={o.mono}>{short(h.digest)}</span>) as the result. The employee is then free for its next work.
            </Text>
            {h.missing.length > 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>It is missing required deliverables: {h.missing.join(", ")}.</MessageBarBody>
              </MessageBar>
            )}
            <Field label="Note" hint="Optional: kept with the acceptance.">
              <Input value={note} onChange={(_, d) => setNote(d.value)} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" disabled={busy} onClick={() => onConfirm(note.trim())}>
              Accept revision {h.revision}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function Handoff({ h, a, onDone, onLoadLatest }: { h: HandoffView; a: AssignmentView | null; onDone: () => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const act = useAction();
  const restore = useRestoreFocusTarget();
  const [revising, setRevising] = useState(false);
  const [criteria, setCriteria] = useState("");
  const [accepting, setAccepting] = useState(false);
  const reviewable = h.status === "submitted" && a !== null;
  const review = async (command: AssignmentCommand, body: object) => {
    if (a === null) return;
    const ok = await act.run(() => office.command(a.id, a.version, command, { handoffDigest: h.digest, ...body }));
    setAccepting(false);
    if (ok) {
      setRevising(false);
      onDone();
    }
  };
  return (
    <article className={o.card} aria-label={`Revision ${h.revision}`}>
      <div className={o.between}>
        <div className={o.row}>
          <Text weight="semibold">Revision {h.revision}</Text>
          <Badge appearance="tint" color={h.status === "accepted" ? "success" : h.status === "submitted" ? "important" : "subtle"}>
            {HANDOFF_TEXT[h.status]}
          </Badge>
        </div>
        <Text size={200} className={o.muted}>
          digest <span className={o.mono}>{short(h.digest)}</span> · handed in {when(h.submittedAt)} by {h.submittedBy}
        </Text>
      </div>
      <Text className={o.wrap}>{h.summary}</Text>
      {h.artifacts.length > 0 && (
        <ul className={o.list} aria-label={`Artifacts of revision ${h.revision}`}>
          {h.artifacts.map((x) => (
            <li key={x.id} className={o.row}>
              <Link className="orbit-target" href={office.artifactHref(x.id)} download={x.name} target="_blank" rel="noopener noreferrer">
                <ArrowDownload16Regular aria-hidden /> {x.name}
              </Link>
              <Text size={200} className={o.muted}>
                {x.kind} · {x.mediaType} · {bytesText(x.size)} · sha256 {short(x.sha256)}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {h.claims.length > 0 && (
        <ul className={o.list} aria-label={`Claims of revision ${h.revision}`}>
          {h.claims.map((c, i) => (
            <li key={`${i}:${c.text}`} className={o.item}>
              <div className={o.row}>
                <Badge appearance="tint" color={c.supported ? "success" : "warning"}>
                  {c.supported ? "Supported by a source" : "Not supported"}
                </Badge>
              </div>
              <Text size={200} className={o.wrap}>
                {c.text}
              </Text>
              {c.sources.map((src) => (
                <Text key={`${src.label}:${src.revisionId}`} size={200} className={o.muted}>
                  [{src.label}] {src.locator}: “{src.excerpt}”
                </Text>
              ))}
            </li>
          ))}
        </ul>
      )}
      {h.missing.length > 0 && (
        <Text size={200} className={o.danger}>
          Missing deliverables: {h.missing.join(", ")}
        </Text>
      )}
      {h.review && (
        <Text size={200} className={o.muted}>
          Reviewed by {h.review.by} on {when(h.review.at)}
          {h.review.note ? `: ${h.review.note}` : ""}
        </Text>
      )}
      {reviewable && (
        <div className={o.row}>
          {a.actions.includes("request_revision") && (
            <Button className={o.touch} disabled={act.busy} onClick={() => setRevising(!revising)}>
              Request revision
            </Button>
          )}
          {a.actions.includes("accept") && (
            <Button className={o.touch} appearance="primary" disabled={act.busy} onClick={() => setAccepting(true)} {...restore}>
              Accept…
            </Button>
          )}
        </div>
      )}
      {revising && (
        <form
          className={o.form}
          aria-label={`Request a revision of revision ${h.revision}`}
          onSubmit={(e) => {
            e.preventDefault();
            void review("request-revision", { criteria: criteria.trim() });
          }}
        >
          <Field label="What must change" required hint={`About revision ${h.revision}, digest ${short(h.digest)}: the same employee works on it again.`}>
            <Textarea value={criteria} resize="vertical" onChange={(_, d) => setCriteria(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || criteria.trim() === ""}>
              Send the request
            </Button>
          </div>
        </form>
      )}
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
      {accepting && <AcceptDialog h={h} busy={act.busy} onClose={() => setAccepting(false)} onConfirm={(note) => void review("accept", { note })} />}
    </article>
  );
}

export function MissionPage({ id, tab, go }: { id: string; tab: string | null; go: Go }) {
  const o = useOfficeStyles();
  const mission = useOfficeRead<MissionDetail>(() => office.mission(id), [id], ["missions", "inbox"], id);
  const current: MissionTab = (MISSION_TABS as readonly string[]).includes(tab ?? "") ? (tab as MissionTab) : "overview";
  if (mission.data === null)
    return mission.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{mission.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label="Reading the mission…" />
    );
  const m = mission.data;
  const root = m.assignments.find((a) => a.id === m.assignment.id) ?? m.assignments.find((a) => a.parentId === null) ?? null;
  const reload = () => void mission.reload();
  const handoffs = [...m.handoffs].sort((a, b) => b.revision - a.revision);
  // A mission whose work was split into parts has a team room (the tab shows when asked for by its address too).
  const hasTeam = m.assignments.some((a) => a.parentId !== null) || current === "team";
  return (
    <div className={o.page}>
      <div className={o.stack}>
        <Text as="h2" weight="semibold" size={500} className={o.wrap}>
          {m.title}
        </Text>
        <div className={o.row}>
          <StateBadge text={ASSIGNMENT_STATE_TEXT[m.assignment.state]} state={m.assignment.state} />
          <Text size={200}>
            Held by{" "}
            <Link as="button" onClick={() => go("employee", m.assignment.employeeId)}>
              {m.assignment.employeeName}
            </Link>
            {m.deadline ? ` · due ${when(m.deadline)}` : ""}
            {m.nextAction ? ` · next: ${m.nextAction}` : ""}
          </Text>
        </div>
        <AsOf at={mission.loadedAt} />
      </div>
      <div className={`${o.tabStrip} orbit-hscroll`}>
        <TabList selectedValue={current} onTabSelect={(_, d) => go("mission", id, d.value as string)} aria-label="Mission">
          {MISSION_TABS.filter((t) => t !== "team" || hasTeam).map((t) => (
            <Tab key={t} value={t}>
              {TAB_TEXT[t]}
              {t === "handoffs" && m.handoffs.length > 0 ? ` (${m.handoffs.length})` : ""}
            </Tab>
          ))}
        </TabList>
      </div>

      {current === "overview" && (
        <>
          <section className={o.card} aria-label="What is wanted">
            <Text weight="semibold">What is wanted</Text>
            <Text className={o.wrap} style={{ whiteSpace: "pre-wrap" }}>
              {m.goal}
            </Text>
            <dl className={o.dl}>
              <dt className={o.dt}>Deliverables</dt>
              <dd className={o.dd}>{m.deliverables.length === 0 ? "None named" : m.deliverables.map((d) => `${d.name}${d.required ? "" : " (optional)"}`).join(", ")}</dd>
              <dt className={o.dt}>Accepted when</dt>
              <dd className={o.dd}>{m.acceptanceCriteria.length === 0 ? "No criteria named" : m.acceptanceCriteria.join("; ")}</dd>
              <dt className={o.dt}>Accepted by</dt>
              <dd className={o.dd}>{m.acceptanceMode === "owner_review" ? "You" : "Its manager"}</dd>
              <dt className={o.dt}>Research sources</dt>
              <dd className={o.dd}>{m.sourceRevisionIds.length === 0 ? "None pinned" : `${m.sourceRevisionIds.length} source revision(s) pinned, read-only`}</dd>
              <dt className={o.dt}>Created</dt>
              <dd className={o.dd}>
                {when(m.createdAt)} by {m.createdBy}
              </dd>
            </dl>
          </section>
          <section className={o.card} aria-label="Plan">
            <Text weight="semibold">Plan</Text>
            <Plan assignments={m.assignments} go={go} />
            {root && <AssignmentActions a={root} onDone={reload} onLoadLatest={reload} />}
          </section>
          {m.deliveries.length > 0 && (
            <section className={o.card} aria-label="Deliveries">
              <Text weight="semibold">Deliveries</Text>
              <ul className={o.list}>
                {m.deliveries.map((d) => (
                  <Delivery key={d.id} d={d} onDone={reload} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {current === "timeline" && (
        <section className={o.card} aria-label="Timeline">
          {m.timeline.length === 0 ? (
            <Text className={o.muted}>Nothing happened yet.</Text>
          ) : (
            <ol className={o.list}>
              {m.timeline.map((t) => (
                <li key={t.seq} className={o.item}>
                  <Text size={200} className={o.muted}>
                    {when(t.at)} · {t.actor}
                  </Text>
                  <Text size={200}>{t.summary}</Text>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {current === "handoffs" &&
        (handoffs.length === 0 ? (
          <Text className={o.muted}>Nothing has been handed in yet.</Text>
        ) : (
          handoffs.map((h) => <Handoff key={`${h.id}:${h.status}`} h={h} a={m.assignments.find((a) => a.id === h.assignmentId) ?? null} onDone={reload} onLoadLatest={reload} />)
        ))}

      {current === "team" && (
        <section className={o.card} aria-label="Team room">
          <TeamRoom missionId={m.id} go={go} />
        </section>
      )}

      {current === "run" && (
        <section className={o.card} aria-label="Last run">
          {root?.lastRun ? <RunDetails run={root.lastRun} /> : <Text className={o.muted}>No attempt has run yet.</Text>}
        </section>
      )}
    </div>
  );
}
