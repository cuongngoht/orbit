// NEEDS ME: what waits for the owner's decision, each with what it is about and what can be done -- review a result, give
// information, settle a run or a delivery, and work that cannot go on: BLOCKED (retry it, or cancel it) or UNSCHEDULABLE
// (it can never start as configured: the numbers are said, and the ways out -- the employee's resources, the operator's
// authorization, or cancelling it). A decision is pinned to the version it was shown with.
//
// A question says who asked it -- read from its mission -- and, when it came from a part of a team, that its lead moved
// it up: what reaches the person from below is only what is theirs to decide. Its words are the server's, plain text.
import { Badge, Button, Field, Link, MessageBar, MessageBarBody, Spinner, Tab, TabList, Text, Textarea, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Clock16Regular } from "@fluentui/react-icons";
import { ShieldClearIcon } from "../../components/SectionIcons";
import { INBOX_KIND_TEXT, type Inbox, type InboxItem, type MissionDetail } from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText } from "../../services/api";
import { office, useOfficeRead } from "./api";
import { AsOf, Callout, EmptyState, ProblemBar, useAction, useOfficeStyles, when } from "./parts";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const OPERATOR_COMMAND = "node dist/cli/governance.js budget set";

const useStyles = makeStyles({
  cardAccent: { borderLeftWidth: "4px" },
  accentDanger: { borderLeftColor: tokens.colorPaletteRedBorder2 },
  accentImportant: { borderLeftColor: tokens.colorBrandStroke1 },
  accentWarning: { borderLeftColor: tokens.colorPaletteDarkOrangeBorder2 },
  accentClosed: { borderLeftColor: tokens.colorNeutralStroke1 },
  cmd: {
    paddingTop: "1px",
    paddingRight: "6px",
    paddingBottom: "1px",
    paddingLeft: "6px",
    borderRadius: "6px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
});

// What an open question's mission says of it: who asked, the lead who moved it up to the person (if one did), and the
// names of the assignments it refers to (an item's `waiting` may name one: `assignment:<id>`).
function useQuestion(item: InboxItem): { askedBy: string | null; movedUpBy: string | null; names: Map<string, string> } | null {
  const asks = item.state === "open" && item.kind === "information" && item.assignmentId !== null;
  const mission = useResource<MissionDetail>(asks ? () => office.mission(item.missionId) : null, [asks, item.missionId]);
  const m = asks ? mission.data : null;
  if (m === null) return null;
  const asked = m.clarifications.filter((c) => c.askerAssignmentId === item.assignmentId);
  const c = asked.find((q) => q.state === "open") ?? asked.at(-1) ?? null;
  // The hop that brought it to the person, and the lead that had it just before.
  const up = c === null ? -1 : c.route.findIndex((h) => h.addressee === "owner");
  const lead = c !== null && up > 0 ? c.route[up - 1] : undefined;
  return {
    askedBy: c?.askerName ?? m.assignments.find((a) => a.id === item.assignmentId)?.employeeName ?? null,
    movedUpBy: lead === undefined ? null : (lead.addresseeName ?? ""),
    names: new Map(m.assignments.map((a) => [a.id, a.employeeName])),
  };
}

const ASSIGNMENT_REF = "assignment:";

function Item({ item, go, onDone }: { item: InboxItem; go: Go; onDone: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const act = useAction();
  const [answer, setAnswer] = useState("");
  const question = useQuestion(item);
  // Who waits, by name: a reference to an assignment is said as its employee, or not at all.
  const waiting = item.waiting?.startsWith(ASSIGNMENT_REF) ? (question?.names.get(item.waiting.slice(ASSIGNMENT_REF.length)) ?? null) : item.waiting;
  const version = item.pin.assignmentVersion;
  const command = (c: "cancel" | "retry" | "answer", body?: unknown) => {
    if (item.assignmentId === null || version === null) return;
    const assignment = item.assignmentId;
    void act.run(() => office.command(assignment, version, c, body)).then((ok) => ok && onDone());
  };
  // The employee who holds the work, found through the mission (an inbox item names the mission and the assignment).
  const editResources = () =>
    void act.run(async () => {
      const m = await office.mission(item.missionId);
      const a = m.assignments.find((x) => x.id === item.assignmentId) ?? m.assignments.find((x) => x.id === m.assignment.id);
      if (a) go("employee", a.employeeId, "resources");
    });
  const open = item.state === "open";
  const canCommand = item.assignmentId !== null && version !== null;
  const accent = !open ? s.accentClosed : item.kind === "unschedulable" || item.kind === "blocked" ? s.accentDanger : item.kind === "acceptance" ? s.accentImportant : s.accentWarning;
  return (
    <li className={mergeClasses(o.card, s.cardAccent, accent)} aria-label={item.title}>
      <div className={o.between}>
        <div className={o.row}>
          <Badge appearance="tint" color={item.kind === "unschedulable" || item.kind === "blocked" ? "danger" : item.kind === "acceptance" ? "important" : "warning"} style={{ borderRadius: "9999px" }}>
            {INBOX_KIND_TEXT[item.kind]}
          </Badge>
          <Text weight="semibold" size={300} className={o.wrap}>
            {item.title}
          </Text>
        </div>
        <Text size={200} className={o.muted}>
          {when(item.createdAt)}
          {item.deadline ? t("office.inbox.decideBy", { at: when(item.deadline) }) : ""}
        </Text>
      </div>
      {question?.askedBy && (
        <Text size={200} className={o.wrap}>
          {t("office.inbox.askedBy", { name: question.askedBy })}
          {question.movedUpBy !== null ? ` · ${question.movedUpBy === "" ? t("office.inbox.movedUpByItsLead") : t("office.inbox.movedUpBy", { lead: question.movedUpBy })}` : ""}
        </Text>
      )}
      <Text size={300} className={o.wrap} style={{ whiteSpace: "pre-wrap" }}>
        {item.reason}
      </Text>
      {waiting && (
        <Callout tone="info" icon={<Clock16Regular />}>
          {t("office.inbox.waiting", { what: waiting })}
        </Callout>
      )}
      {!open && (
        <div className={o.inset}>
          <Text size={200} className={o.muted}>
            {item.state === "resolved" ? t("office.inbox.stateResolved") : item.state === "expired" ? t("office.inbox.stateExpired") : t("office.inbox.stateWithdrawn")} {when(item.resolvedAt)}
            {item.resolution ? `: ${item.resolution}` : ""}
          </Text>
        </div>
      )}
      {open && item.kind === "unschedulable" && (
        <div className={o.inset}>
          <Text size={200}>
            {t("office.inbox.unschedulableAdviceBefore")}
            <code className={mergeClasses(o.mono, s.cmd)}>{OPERATOR_COMMAND}</code>
            {t("office.inbox.unschedulableAdviceAfter")}
          </Text>
        </div>
      )}
      {open && item.kind === "information" && canCommand && (
        <form
          className={mergeClasses(o.form, o.inset)}
          aria-label={t("office.inbox.answerFormAria", { title: item.title })}
          onSubmit={(e) => {
            e.preventDefault();
            command("answer", { answer: answer.trim() });
          }}
        >
          <Field label={t("office.mission.yourAnswer")} required>
            <Textarea value={answer} resize="vertical" onChange={(_, d) => setAnswer(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || answer.trim() === ""}>
              {t("office.mission.sendAnswer")}
            </Button>
          </div>
        </form>
      )}
      <div className={o.divider} />
      <div className={o.between}>
        <div className={o.row}>
          {open && item.kind === "acceptance" && (
            <Button className={o.touch} appearance="primary" onClick={() => go("mission", item.missionId, "handoffs")}>
              {t("office.inbox.reviewResult")}
            </Button>
          )}
          {open && item.kind === "unschedulable" && (
            <Button className={o.touch} appearance="primary" disabled={act.busy} onClick={editResources}>
              {t("office.inbox.editResources")}
            </Button>
          )}
          {open && item.kind === "blocked" && (
            <Button className={o.touch} appearance="primary" disabled={act.busy || !canCommand} onClick={() => command("retry")}>
              {t("office.mission.action.retry")}
            </Button>
          )}
          {open && (item.kind === "unschedulable" || item.kind === "blocked") && (
            <Button className={o.touch} disabled={act.busy || !canCommand} onClick={() => command("cancel")}>
              {t("office.inbox.cancelWork")}
            </Button>
          )}
        </div>
        <Link className="orbit-target" as="button" onClick={() => go("mission", item.missionId)}>
          {t("office.assign.openWork")}
        </Link>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onDone} />
    </li>
  );
}

function Items({ first, state, go, onDone }: { first: Inbox; state: "open" | "history"; go: Go; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [more, setMore] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [...first.items, ...more.filter((m) => !first.items.some((x) => x.id === m.id))];
  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await office.inbox(state, cursor);
      setMore((x) => [...x, ...next.items]);
      setCursor(next.nextCursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      {items.length === 0 ? (
        <EmptyState
          icon={<ShieldClearIcon size={22} />}
          tone="success"
          title={state === "open" ? t("office.inbox.emptyOpenTitle") : t("office.inbox.emptyHistoryTitle")}
          body={state === "open" ? t("office.inbox.emptyOpenBody") : t("office.inbox.emptyHistoryBody")}
        />
      ) : (
        <ul className={o.list} aria-label={state === "open" ? t("office.inbox.listOpenAria") : t("office.inbox.listHistoryAria")}>
          {items.map((i) => (
            <Item key={i.id} item={i} go={go} onDone={onDone} />
          ))}
        </ul>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {cursor !== null && (
        <div>
          <Button disabled={loading} onClick={() => void loadMore()}>
            {loading ? t("office.overview.loading") : t("office.overview.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

export function InboxPage({ go }: { go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [state, setState] = useState<"open" | "history">("open");
  const inbox = useOfficeRead<Inbox>(() => office.inbox(state), [state], ["inbox", "missions"]);
  return (
    <div className={o.page}>
      <div className={o.between}>
        <div className={o.tabStrip}>
          <TabList selectedValue={state} onTabSelect={(_, d) => setState(d.value as "open" | "history")} aria-label={t("office.inbox.whichItemsAria")}>
            <Tab value="open">
              {t("office.inbox.tabOpen")}
              {inbox.data && state === "open" ? ` (${inbox.data.open})` : ""}
            </Tab>
            <Tab value="history">{t("office.inbox.tabHistory")}</Tab>
          </TabList>
        </div>
        <AsOf at={inbox.data?.asOf ?? null} />
      </div>
      {inbox.data === null ? (
        inbox.error ? (
          <MessageBar intent="error">
            <MessageBarBody>{inbox.error}</MessageBarBody>
          </MessageBar>
        ) : (
          <Spinner label={t("office.inbox.reading")} />
        )
      ) : (
        <Items key={`${state}:${inbox.data.asOf}:${inbox.data.version}`} first={inbox.data} state={state} go={go} onDone={() => void inbox.reload()} />
      )}
    </div>
  );
}
