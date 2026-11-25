// ACTIONABLE REVIEW & Q&A LOUNGE DRAWER: lets the owner answer employee questions, jump straight into handoff reviews,
// or retry/cancel blocked work directly from the Virtual Workplace floor without leaving context.
import { Badge, Button, Field, Link, MessageBar, MessageBarBody, Spinner, Text, Textarea, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { INBOX_KIND_TEXT, type Inbox, type InboxItem } from "@orbit-web/contracts";
import { useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import { ShieldClearIcon } from "../../components/SectionIcons";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { office, useOfficeRead } from "./api";
import { EmptyState, ProblemBar, useAction, useOfficeStyles, when } from "./parts";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const useStyles = makeStyles({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  cardFocused: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 2px ${tokens.colorBrandBackground2}`,
  },
});

function QuickInboxCard({
  item,
  focused,
  go,
  onDone,
}: {
  item: InboxItem;
  focused: boolean;
  go: Go;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const act = useAction();
  const [answer, setAnswer] = useState("");
  const version = item.pin.assignmentVersion;
  const canCommand = item.assignmentId !== null && version !== null;

  const runCmd = (c: "answer" | "retry" | "cancel", body?: unknown) => {
    if (item.assignmentId === null || version === null) return;
    const aid = item.assignmentId;
    void act.run(() => office.command(aid, version, c, body)).then((ok) => ok && onDone());
  };

  return (
    <li className={`${s.card} ${focused ? s.cardFocused : ""}`} aria-label={item.title}>
      <div className={o.between}>
        <div className={o.row} style={{ gap: "6px" }}>
          <Badge
            appearance="tint"
            color={item.kind === "blocked" || item.kind === "unschedulable" ? "danger" : item.kind === "acceptance" ? "important" : "warning"}
            style={{ borderRadius: "9999px" }}
          >
            {INBOX_KIND_TEXT[item.kind]}
          </Badge>
          <Text weight="semibold" size={300} className={o.wrap}>
            {item.title}
          </Text>
        </div>
        <Text size={100} className={o.muted}>
          {when(item.createdAt)}
        </Text>
      </div>
      <Text size={200} className={o.wrap} style={{ whiteSpace: "pre-wrap" }}>
        {item.reason}
      </Text>
      {item.kind === "information" && canCommand && (
        <form
          className={o.form}
          onSubmit={(ev) => {
            ev.preventDefault();
            if (answer.trim()) runCmd("answer", { answer: answer.trim() });
          }}
        >
          <Field label={t("office.mission.yourAnswer")} required>
            <Textarea value={answer} resize="vertical" onChange={(_, d) => setAnswer(d.value)} />
          </Field>
          <div>
            <Button type="submit" size="small" appearance="primary" disabled={act.busy || answer.trim() === ""}>
              {t("office.mission.sendAnswer")}
            </Button>
          </div>
        </form>
      )}
      <div className={o.between}>
        <div className={o.row} style={{ gap: "6px" }}>
          {item.kind === "acceptance" && (
            <Button size="small" appearance="primary" onClick={() => go("mission", item.missionId, "handoffs")}>
              {t("office.inbox.reviewResult")}
            </Button>
          )}
          {item.kind === "blocked" && (
            <Button size="small" appearance="primary" disabled={act.busy || !canCommand} onClick={() => runCmd("retry")}>
              {t("office.mission.action.retry")}
            </Button>
          )}
          {(item.kind === "blocked" || item.kind === "unschedulable") && (
            <Button size="small" disabled={act.busy || !canCommand} onClick={() => runCmd("cancel")}>
              {t("office.inbox.cancelWork")}
            </Button>
          )}
        </div>
        <Link as="button" style={{ fontSize: tokens.fontSizeBase200 }} onClick={() => go("mission", item.missionId)}>
          {t("office.assign.openWork")}
        </Link>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onDone} />
    </li>
  );
}

export function QuickReviewSheet({
  open,
  focusMissionId = null,
  go,
  onClose,
  onChanged,
}: {
  open: boolean;
  focusMissionId?: string | null;
  go: Go;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const inbox = useOfficeRead<Inbox>(open ? () => office.inbox("open") : null, [open], ["inbox", "missions"]);

  const items = inbox.data?.items ?? [];
  const sorted = focusMissionId
    ? [...items].sort((a, b) => (a.missionId === focusMissionId ? -1 : b.missionId === focusMissionId ? 1 : 0))
    : items;

  return (
    <ResponsiveSheet open={open} onOpenChange={(next) => !next && onClose()} title={t("office.floor.reviewSheetTitle")}>
      <div className={o.stack} style={{ gap: "12px" }}>
        {inbox.data === null ? (
          inbox.error ? (
            <MessageBar intent="error">
              <MessageBarBody>{inbox.error}</MessageBarBody>
            </MessageBar>
          ) : (
            <Spinner size="small" label={t("office.inbox.reading")} />
          )
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<ShieldClearIcon size={22} />}
            tone="success"
            title={t("office.inbox.emptyOpenTitle")}
            body={t("office.floor.reviewSheetEmpty")}
          />
        ) : (
          <ul className={o.list}>
            {sorted.map((item) => (
              <QuickInboxCard
                key={item.id}
                item={item}
                focused={focusMissionId !== null && item.missionId === focusMissionId}
                go={(p, id, tab) => {
                  onClose();
                  go(p, id, tab);
                }}
                onDone={() => {
                  void inbox.reload();
                  onChanged();
                }}
              />
            ))}
          </ul>
        )}
        <div className={o.row} style={{ justifyContent: "flex-end" }}>
          <Button
            size="small"
            appearance="subtle"
            onClick={() => {
              onClose();
              go("inbox");
            }}
          >
            {t("office.floor.reviewSheetOpenAll")}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
