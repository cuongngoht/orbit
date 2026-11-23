// ONE MISSION: what was wanted and who holds it (with the plan of its assignments), what happened in order, the results
// handed in -- each revision with its artifacts, its claims (supported by a source, or not) and what it is missing -- and
// the last attempt, its model, effort and resources as asked, resolved and observed. A review names the revision being
// read (its digest) and the assignment's version: if either moved on, nothing is done and the page offers the latest.
import { Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Link, MessageBar, MessageBarBody, Radio, RadioGroup, Spinner, Tab, TabList, Text, Textarea, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import { ArrowDownload16Regular } from "@fluentui/react-icons";
import { ASSIGNMENT_STATE_TEXT, DELIVERY_STATE_TEXT, type AssignmentView, type DeliveryView, type HandoffStatus, type HandoffView, type MissionDetail, type TeamRoomChange } from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useI18n, type MessageKey } from "../../i18n";
import { bytesText } from "../resources/format";
import { isNotServed, office, useOfficeRead, type AssignmentCommand } from "./api";
import { AsOf, EmployeeAvatar, ProblemBar, RUN_STATE_KEYS, StateBadge, short, useAction, useOfficeStyles, when } from "./parts";
import { RunDetails } from "./RunDetails";

const useStyles = makeStyles({
  nested: { borderLeftWidth: "3px", borderLeftColor: tokens.colorBrandStroke2 },
  timelineList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    listStyleType: "none",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: "6px",
    paddingLeft: "16px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.colorNeutralStroke2,
    minWidth: 0,
  },
  timelineItem: { position: "relative" },
  timelineDot: {
    position: "absolute",
    left: "-22px",
    top: "14px",
    width: "10px",
    height: "10px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorBrandBackground,
    ...shorthands.border("2px", "solid", "var(--orbit-card-bg)"),
  },
});

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

export const MISSION_TABS = ["overview", "timeline", "handoffs", "team", "run"] as const;
type MissionTab = (typeof MISSION_TABS)[number];
const TAB_KEYS: Record<MissionTab, MessageKey> = {
  overview: "office.mission.tab.overview",
  timeline: "office.mission.tab.timeline",
  handoffs: "office.mission.tab.handoffs",
  team: "office.mission.tab.team",
  run: "office.mission.tab.run",
};

const HANDOFF_KEYS: Record<HandoffStatus, MessageKey> = {
  submitted: "office.mission.handoff.submitted",
  revision_requested: "office.mission.handoff.revision_requested",
  accepted: "office.mission.handoff.accepted",
  superseded: "office.mission.handoff.superseded",
};

const ACTION_KEYS: Partial<Record<AssignmentCommand, MessageKey>> = {
  pause: "office.mission.action.pause",
  resume: "office.mission.action.resume",
  cancel: "office.mission.action.cancel",
  retry: "office.mission.action.retry",
};

// The commands of an assignment a person may give from its Overview (a review is given from its handoff).
const ROUTE_OF: Record<string, AssignmentCommand> = { pause: "pause", resume: "resume", cancel: "cancel", retry: "retry", answer: "answer", accept: "accept", request_revision: "request-revision" };

function AssignmentActions({ a, onDone, onLoadLatest }: { a: AssignmentView; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
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
              {ACTION_KEYS[c] ? t(ACTION_KEYS[c]!) : c}
            </Button>
          ))}
        </div>
      )}
      {a.actions.includes("answer") && (
        <form
          className={o.form}
          aria-label={t("office.mission.answerAria")}
          onSubmit={(e) => {
            e.preventDefault();
            void run("answer", { answer: answer.trim() });
          }}
        >
          <Field label={t("office.mission.yourAnswer")} hint={a.waitingOn ? t("office.mission.itAsked", { question: a.waitingOn }) : t("office.mission.waitsForInfo")}>
            <Textarea value={answer} resize="vertical" onChange={(_, d) => setAnswer(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || answer.trim() === ""}>
              {t("office.mission.sendAnswer")}
            </Button>
          </div>
        </form>
      )}
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </div>
  );
}

function AssignmentRow({ a, go, depth }: { a: AssignmentView; go: Go; depth: number }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  return (
    <li className={mergeClasses(o.item, depth > 0 && s.nested)} style={{ marginLeft: `${Math.min(depth, 3) * 16}px` }}>
      <div className={o.row}>
        <StateBadge text={ASSIGNMENT_STATE_TEXT[a.state]} state={a.state} />
        <Text weight="semibold">{a.title}</Text>
      </div>
      <Text size={200}>
        {t("office.mission.heldByPrefix")}
        <Link as="button" onClick={() => go("employee", a.employeeId)}>
          {a.employeeName}
        </Link>
        {a.pinned.departmentName ? t("office.mission.deptWhenClaimed", { dept: a.pinned.departmentName }) : ""}
        {t("office.mission.attemptsAndRevision", { attempts: a.attempts, revision: a.handoffRevision })}
      </Text>
      {a.unitKey !== null && (
        <Text size={200} className={o.muted}>
          {t("office.mission.partOfPlan", { key: a.unitKey })}
          {a.brief.dependsOn.length > 0 ? t("office.mission.waitsForDeps", { deps: a.brief.dependsOn.map((k) => `“${k}”`).join(", ") }) : ""}
        </Text>
      )}
      {(a.reason || a.waitingOn) && (
        <Text size={200} className={o.warn}>
          {a.reason ?? ""}
          {a.waitingOn ? t("office.mission.waitingOn", { what: a.waitingOn }) : ""}
        </Text>
      )}
      {a.lastRun && (a.lastRun.state === "waiting_for_resources" || a.lastRun.state === "unschedulable") && (
        <Text size={200} className={a.lastRun.state === "unschedulable" ? o.danger : o.warn}>
          {t(RUN_STATE_KEYS[a.lastRun.state])}: {a.lastRun.waitingReason ?? t("office.run.noReasonGiven")}
        </Text>
      )}
    </li>
  );
}

// The plan: the root assignment and, under each, the assignments it delegated.
function Plan({ assignments, go }: { assignments: AssignmentView[]; go: Go }) {
  const { t } = useI18n();
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
    <ul className={o.list} aria-label={t("office.mission.assignmentsAria")}>
      {rows.map(({ a, depth }) => (
        <AssignmentRow key={a.id} a={a} go={go} depth={depth} />
      ))}
    </ul>
  );
}

// The mission's team room: every change its members' attempts made, in order -- which file, what it became, and whose
// attempt changed it. The room is a workbench shared by the mission's team; what was accepted is in the handoffs.
function TeamRoom({ missionId, go }: { missionId: string; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const changes = useOfficeRead<TeamRoomChange[]>(() => office.teamRoom(missionId), [missionId], ["missions"], missionId);
  if (changes.data === null)
    return changes.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{t("office.mission.teamRoomError", { error: changes.error })}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner size="tiny" label={t("office.mission.readingTeamRoom")} />
    );
  if (changes.data.length === 0)
    return (
      <Text className={o.muted}>
        {t("office.mission.teamRoomEmpty")}
      </Text>
    );
  return (
    <ol className={o.list} aria-label={t("office.mission.teamRoomChangesAria")}>
      {changes.data.map((c, i) => (
        <li key={`${i}:${c.path}`} className={o.item}>
          <div className={o.row}>
            <Text weight="semibold" size={200} className={o.mono}>
              {c.path}
            </Text>
            <Text size={200} className={o.muted}>
              {c.sha256 === null ? t("office.mission.removed") : `${bytesText(c.size)} · ${short(c.sha256)}`}
            </Text>
          </div>
          <Text size={200} className={o.muted}>
            {when(c.at)} ·{" "}
            {c.employeeId !== null && c.employeeName !== null ? (
              <Link as="button" onClick={() => go("employee", c.employeeId)}>
                {c.employeeName}
              </Link>
            ) : (
              t("office.mission.attemptNoLongerOnRecord")
            )}
          </Text>
        </li>
      ))}
    </ol>
  );
}

function Delivery({ d, onDone }: { d: DeliveryView; onDone: () => void }) {
  const { t } = useI18n();
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
          {t("office.mission.attemptsCount", { count: d.attempts, receipt: d.receipt ? t("office.mission.receiptSuffix", { receipt: d.receipt }) : "" })}
        </Text>
      </div>
      {d.detail && <Text size={200}>{d.detail}</Text>}
      {d.state === "NEEDS_RECONCILIATION" && (
        <form
          className={o.form}
          aria-label={t("office.mission.settleDeliveryAria", { address: d.recipient.address })}
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => office.resolveDelivery(d.id, { outcome, reason: reason.trim() }).catch((err: unknown) => Promise.reject(isNotServed(err) ? new Error(t("office.mission.deliveriesNotServed")) : err))).then((ok) => ok && onDone());
          }}
        >
          <RadioGroup value={outcome} onChange={(_, v) => setOutcome(v.value as "delivered" | "resend")}>
            <Radio value="delivered" label={t("office.mission.deliveryReached")} />
            <Radio value="resend" label={t("office.mission.deliveryResend")} />
          </RadioGroup>
          <Field label={t("office.mission.howYouKnow")} required>
            <Input value={reason} onChange={(_, v) => setReason(v.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={act.busy || reason.trim() === ""}>
              {t("office.mission.recordIt")}
            </Button>
          </div>
          <ProblemBar problem={act.problem} />
        </form>
      )}
    </li>
  );
}

function AcceptDialog({ h, onClose, onConfirm, busy }: { h: HandoffView; onClose: () => void; onConfirm: (note: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <DialogBody>
          <DialogTitle>
            {t("office.mission.acceptTitle", { revision: h.revision })}
          </DialogTitle>
          <DialogContent className={o.form}>
            <Text>
              {t("office.mission.acceptConfirmBefore", { revision: h.revision })}
              <span className={o.mono}>{short(h.digest)}</span>
              {t("office.mission.acceptConfirmAfter")}
            </Text>
            {h.missing.length > 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>{t("office.mission.missingRequired", { missing: h.missing.join(", ") })}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={t("office.mission.noteLabel")} hint={t("office.mission.noteHint")}>
              <Input value={note} onChange={(_, d) => setNote(d.value)} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("office.assign.cancel")}</Button>
            <Button appearance="primary" disabled={busy} onClick={() => onConfirm(note.trim())}>
              {t("office.mission.acceptBtn", { revision: h.revision })}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function Handoff({ h, a, onDone, onLoadLatest }: { h: HandoffView; a: AssignmentView | null; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
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
    <article className={o.card} aria-label={t("office.mission.revisionAria", { revision: h.revision })}>
      <div className={o.between}>
        <div className={o.row}>
          <Text weight="semibold">{t("office.mission.revisionTitle", { revision: h.revision })}</Text>
          <Badge appearance="tint" color={h.status === "accepted" ? "success" : h.status === "submitted" ? "important" : "subtle"}>
            {t(HANDOFF_KEYS[h.status])}
          </Badge>
        </div>
        <Text size={200} className={o.muted}>
          {t("office.mission.digestPrefix")}
          <span className={o.mono}>{short(h.digest)}</span>
          {t("office.mission.handedIn", { at: when(h.submittedAt), by: h.submittedBy })}
        </Text>
      </div>
      <Text className={o.wrap}>{h.summary}</Text>
      {h.artifacts.length > 0 && (
        <ul className={o.list} aria-label={t("office.mission.artifactsAria", { revision: h.revision })}>
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
        <ul className={o.list} aria-label={t("office.mission.claimsAria", { revision: h.revision })}>
          {h.claims.map((c, i) => (
            <li key={`${i}:${c.text}`} className={o.item}>
              <div className={o.row}>
                <Badge appearance="tint" color={c.supported ? "success" : "warning"}>
                  {c.supported ? t("office.mission.supported") : t("office.mission.notSupported")}
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
          {t("office.mission.missingDeliverables", { missing: h.missing.join(", ") })}
        </Text>
      )}
      {h.review && (
        <Text size={200} className={o.muted}>
          {t("office.mission.reviewedBy", { by: h.review.by, at: when(h.review.at) })}
          {h.review.note ? `: ${h.review.note}` : ""}
        </Text>
      )}
      {reviewable && (
        <div className={o.row}>
          {a.actions.includes("request_revision") && (
            <Button className={o.touch} disabled={act.busy} onClick={() => setRevising(!revising)}>
              {t("office.mission.requestRevision")}
            </Button>
          )}
          {a.actions.includes("accept") && (
            <Button className={o.touch} appearance="primary" disabled={act.busy} onClick={() => setAccepting(true)} {...restore}>
              {t("office.mission.acceptEllipsis")}
            </Button>
          )}
        </div>
      )}
      {revising && (
        <form
          className={o.form}
          aria-label={t("office.mission.requestRevisionAria", { revision: h.revision })}
          onSubmit={(e) => {
            e.preventDefault();
            void review("request-revision", { criteria: criteria.trim() });
          }}
        >
          <Field label={t("office.mission.whatMustChange")} required hint={t("office.mission.whatMustChangeHint", { revision: h.revision, digest: short(h.digest) })}>
            <Textarea value={criteria} resize="vertical" onChange={(_, d) => setCriteria(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || criteria.trim() === ""}>
              {t("office.mission.sendRequest")}
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
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const mission = useOfficeRead<MissionDetail>(() => office.mission(id), [id], ["missions", "inbox"], id);
  const current: MissionTab = (MISSION_TABS as readonly string[]).includes(tab ?? "") ? (tab as MissionTab) : "overview";
  if (mission.data === null)
    return mission.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{mission.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label={t("office.mission.reading")} />
    );
  const m = mission.data;
  const root = m.assignments.find((a) => a.id === m.assignment.id) ?? m.assignments.find((a) => a.parentId === null) ?? null;
  const reload = () => void mission.reload();
  const handoffs = [...m.handoffs].sort((a, b) => b.revision - a.revision);
  // A mission whose work was split into parts has a team room (the tab shows when asked for by its address too).
  const hasTeam = m.assignments.some((a) => a.parentId !== null) || current === "team";
  return (
    <div className={o.page}>
      <section className={o.heroCard} aria-label={m.title}>
        <Text as="h2" weight="semibold" size={600} className={o.wrap}>
          {m.title}
        </Text>
        <div className={o.row}>
          <StateBadge text={ASSIGNMENT_STATE_TEXT[m.assignment.state]} state={m.assignment.state} />
          <EmployeeAvatar name={m.assignment.employeeName} size="sm" />
          <Text size={200}>
            {t("office.mission.heldByPrefix")}
            <Link as="button" onClick={() => go("employee", m.assignment.employeeId)}>
              {m.assignment.employeeName}
            </Link>
            {m.deadline ? t("office.work.due", { at: when(m.deadline) }) : ""}
            {m.nextAction ? t("office.work.next", { next: m.nextAction }) : ""}
          </Text>
        </div>
        <AsOf at={mission.loadedAt} />
      </section>
      <div className={`${o.tabStrip} orbit-hscroll`}>
        <TabList selectedValue={current} onTabSelect={(_, d) => go("mission", id, d.value as string)} aria-label={t("office.mission.tabsAria")}>
          {MISSION_TABS.filter((tabKey) => tabKey !== "team" || hasTeam).map((tabKey) => (
            <Tab key={tabKey} value={tabKey}>
              {t(TAB_KEYS[tabKey])}
              {tabKey === "handoffs" && m.handoffs.length > 0 ? ` (${m.handoffs.length})` : ""}
            </Tab>
          ))}
        </TabList>
      </div>

      {current === "overview" && (
        <>
          <section className={o.card} aria-label={t("office.mission.whatIsWanted")}>
            <Text weight="semibold" size={400}>
              {t("office.mission.whatIsWanted")}
            </Text>
            <Text className={o.wrap} style={{ whiteSpace: "pre-wrap" }}>
              {m.goal}
            </Text>
            <div className={o.divider} />
            <dl className={o.dl}>
              <dt className={o.dt}>{t("office.assign.deliverables")}</dt>
              <dd className={o.dd}>{m.deliverables.length === 0 ? t("office.mission.noneNamed") : m.deliverables.map((d) => `${d.name}${d.required ? "" : ` (${t("office.assign.optionalTag")})`}`).join(", ")}</dd>
              <dt className={o.dt}>{t("office.mission.acceptedWhen")}</dt>
              <dd className={o.dd}>{m.acceptanceCriteria.length === 0 ? t("office.mission.noCriteriaNamed") : m.acceptanceCriteria.join("; ")}</dd>
              <dt className={o.dt}>{t("office.mission.acceptedBy")}</dt>
              <dd className={o.dd}>{m.acceptanceMode === "owner_review" ? t("office.mission.ownerYou") : t("office.mission.itsManager")}</dd>
              <dt className={o.dt}>{t("office.sources.title")}</dt>
              <dd className={o.dd}>{m.sourceRevisionIds.length === 0 ? t("office.mission.nonePinned") : t("office.mission.sourcesPinned", { count: m.sourceRevisionIds.length })}</dd>
              <dt className={o.dt}>{t("office.repos.title")}</dt>
              <dd className={o.dd}>{(m.repositories ?? []).length === 0 ? t("office.mission.none") : (m.repositories ?? []).map((r) => `${r.fullName}${r.branch === null ? "" : ` (${r.branch})`}`).join(", ")}</dd>
              <dt className={o.dt}>{t("office.mission.created")}</dt>
              <dd className={o.dd}>
                {t("office.mission.createdBy", { at: when(m.createdAt), by: m.createdBy })}
              </dd>
            </dl>
          </section>
          <section className={o.card} aria-label={t("office.mission.plan")}>
            <Text weight="semibold">{t("office.mission.plan")}</Text>
            <Plan assignments={m.assignments} go={go} />
            {root && <AssignmentActions a={root} onDone={reload} onLoadLatest={reload} />}
          </section>
          {m.deliveries.length > 0 && (
            <section className={o.card} aria-label={t("office.mission.deliveries")}>
              <Text weight="semibold">{t("office.mission.deliveries")}</Text>
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
        <section className={o.card} aria-label={t("office.mission.tab.timeline")}>
          {m.timeline.length === 0 ? (
            <Text className={o.muted}>{t("office.mission.timelineEmpty")}</Text>
          ) : (
            <ol className={s.timelineList}>
              {m.timeline.map((item) => (
                <li key={item.seq} className={mergeClasses(o.item, s.timelineItem)}>
                  <span className={s.timelineDot} aria-hidden />
                  <Text size={200} className={o.muted}>
                    {when(item.at)} · {item.actor}
                  </Text>
                  <Text size={200}>{item.summary}</Text>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {current === "handoffs" &&
        (handoffs.length === 0 ? (
          <Text className={o.muted}>{t("office.mission.handoffsEmpty")}</Text>
        ) : (
          handoffs.map((h) => <Handoff key={`${h.id}:${h.status}`} h={h} a={m.assignments.find((a) => a.id === h.assignmentId) ?? null} onDone={reload} onLoadLatest={reload} />)
        ))}

      {current === "team" && (
        <section className={o.card} aria-label={t("office.mission.tab.team")}>
          <TeamRoom missionId={m.id} go={go} />
        </section>
      )}

      {current === "run" && (
        <section className={o.card} aria-label={t("office.mission.tab.run")}>
          {root?.lastRun ? <RunDetails run={root.lastRun} /> : <Text className={o.muted}>{t("office.mission.runEmpty")}</Text>}
        </section>
      )}
    </div>
  );
}
