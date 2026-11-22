// NEEDS ME: what waits for the owner's decision, each with what it is about and what can be done -- review a result, give
// information, settle a run or a delivery, and work that cannot go on: BLOCKED (retry it, or cancel it) or UNSCHEDULABLE
// (it can never start as configured: the numbers are said, and the ways out -- the employee's resources, the operator's
// authorization, or cancelling it). A decision is pinned to the version it was shown with.
import { Badge, Button, Field, Link, MessageBar, MessageBarBody, Spinner, Tab, TabList, Text, Textarea, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Clock16Regular } from "@fluentui/react-icons";
import { ShieldClearIcon } from "../../components/SectionIcons";
import { INBOX_KIND_TEXT, type Inbox, type InboxItem } from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
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

function Item({ item, go, onDone }: { item: InboxItem; go: Go; onDone: () => void }) {
  const s = useStyles();
  const o = useOfficeStyles();
  const act = useAction();
  const [answer, setAnswer] = useState("");
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
          {item.deadline ? ` · decide by ${when(item.deadline)}` : ""}
        </Text>
      </div>
      <Text size={300} className={o.wrap}>
        {item.reason}
      </Text>
      {item.waiting && (
        <Callout tone="info" icon={<Clock16Regular />}>
          Waiting: {item.waiting}
        </Callout>
      )}
      {!open && (
        <div className={o.inset}>
          <Text size={200} className={o.muted}>
            {item.state === "resolved" ? "Resolved" : item.state === "expired" ? "Expired" : "Withdrawn"} {when(item.resolvedAt)}
            {item.resolution ? `: ${item.resolution}` : ""}
          </Text>
        </div>
      )}
      {open && item.kind === "unschedulable" && (
        <div className={o.inset}>
          <Text size={200}>
            As configured this work can never start. Lower what the employee asks for, have the operator raise the account's authorization (<code className={mergeClasses(o.mono, s.cmd)}>{OPERATOR_COMMAND}</code> on the server), or cancel the work and give it to somebody else.
          </Text>
        </div>
      )}
      {open && item.kind === "information" && canCommand && (
        <form
          className={mergeClasses(o.form, o.inset)}
          aria-label={`Answer: ${item.title}`}
          onSubmit={(e) => {
            e.preventDefault();
            command("answer", { answer: answer.trim() });
          }}
        >
          <Field label="Your answer" required>
            <Textarea value={answer} resize="vertical" onChange={(_, d) => setAnswer(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || answer.trim() === ""}>
              Send the answer
            </Button>
          </div>
        </form>
      )}
      <div className={o.divider} />
      <div className={o.between}>
        <div className={o.row}>
          {open && item.kind === "acceptance" && (
            <Button className={o.touch} appearance="primary" onClick={() => go("mission", item.missionId, "handoffs")}>
              Review the result
            </Button>
          )}
          {open && item.kind === "unschedulable" && (
            <Button className={o.touch} appearance="primary" disabled={act.busy} onClick={editResources}>
              Edit the employee's resources
            </Button>
          )}
          {open && item.kind === "blocked" && (
            <Button className={o.touch} appearance="primary" disabled={act.busy || !canCommand} onClick={() => command("retry")}>
              Retry
            </Button>
          )}
          {open && (item.kind === "unschedulable" || item.kind === "blocked") && (
            <Button className={o.touch} disabled={act.busy || !canCommand} onClick={() => command("cancel")}>
              Cancel the work
            </Button>
          )}
        </div>
        <Link className="orbit-target" as="button" onClick={() => go("mission", item.missionId)}>
          Open the work
        </Link>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onDone} />
    </li>
  );
}

function Items({ first, state, go, onDone }: { first: Inbox; state: "open" | "history"; go: Go; onDone: () => void }) {
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
          title={state === "open" ? "Nothing needs you now." : "Nothing decided yet."}
          body={state === "open" ? "Reviews, questions, and blocked assignments waiting on you will appear here." : "Resolved, expired, or withdrawn items are kept here."}
        />
      ) : (
        <ul className={o.list} aria-label={state === "open" ? "Needs you" : "Decided"}>
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
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}

export function InboxPage({ go }: { go: Go }) {
  const o = useOfficeStyles();
  const [state, setState] = useState<"open" | "history">("open");
  const inbox = useOfficeRead<Inbox>(() => office.inbox(state), [state], ["inbox", "missions"]);
  return (
    <div className={o.page}>
      <div className={o.between}>
        <div className={o.tabStrip}>
          <TabList selectedValue={state} onTabSelect={(_, d) => setState(d.value as "open" | "history")} aria-label="Which items">
            <Tab value="open">Open{inbox.data && state === "open" ? ` (${inbox.data.open})` : ""}</Tab>
            <Tab value="history">History</Tab>
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
          <Spinner label="Reading what needs you…" />
        )
      ) : (
        <Items key={`${state}:${inbox.data.asOf}:${inbox.data.version}`} first={inbox.data} state={state} go={go} onDone={() => void inbox.reload()} />
      )}
    </div>
  );
}
