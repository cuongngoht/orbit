// Explains what is holding a queued assignment's assignee slot and links directly to its pending owner action when the
// viewer has access -- never revealing restricted assignment details when `accessible` is false.
import { Button, Link, Text } from "@fluentui/react-components";
import { Clock16Regular, LockClosed16Regular } from "@fluentui/react-icons";
import { ASSIGNMENT_STATE_TEXT, type QueuedBehind } from "@orbit-web/contracts";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { Callout, useOfficeStyles } from "./parts";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

export function QueuedBehindCallout({ employeeName, queuedBehind, go }: { employeeName: string; queuedBehind: QueuedBehind; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  if (!queuedBehind.accessible || queuedBehind.missionId === null || queuedBehind.title === null || queuedBehind.state === null) {
    return (
      <Callout tone="info" icon={<LockClosed16Regular />}>
        <Text size={200}>{t("office.work.queuedBehindRestricted", { name: employeeName })}</Text>
      </Callout>
    );
  }
  const blockingMissionId = queuedBehind.missionId;
  const action = queuedBehind.ownerAction;
  const actionLabel =
    action === null
      ? null
      : action.kind === "information"
        ? t("office.work.actionClarification")
        : action.kind === "acceptance"
          ? t("office.work.actionReview")
          : t("office.work.actionBlocker");
  return (
    <Callout tone={action !== null ? "warn" : "info"} icon={<Clock16Regular />}>
      <div className={o.between} style={{ gap: "8px", flexWrap: "wrap" }}>
        <div className={o.stack} style={{ gap: "2px", minWidth: 0 }}>
          <Text size={200} weight="semibold" className={o.wrap}>
            {t("office.work.queuedBehindLine", { title: queuedBehind.title, state: ASSIGNMENT_STATE_TEXT[queuedBehind.state] })}
            {queuedBehind.waitingOn === "information" ? ` — ${t("office.work.queuedBehindWaitingInfo")}` : ""}
          </Text>
          {action !== null && (
            <Text size={200} className={o.muted}>
              {action.title}
            </Text>
          )}
        </div>
        <div className={o.row} style={{ gap: "8px", flexShrink: 0 }}>
          {action !== null && actionLabel !== null && (
            <Button size="small" appearance="primary" onClick={() => go("mission", action.missionId, action.tab)}>
              {actionLabel}
            </Button>
          )}
          <Link as="button" onClick={() => go("mission", blockingMissionId)}>
            {t("office.work.openBlockingAssignment")}
          </Link>
        </div>
      </div>
    </Callout>
  );
}
