import { Button, Caption1, Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Warning20Filled } from "@fluentui/react-icons";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { formatDateTime } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { Facts, type Asking } from "./components";
import type { ApprovalBrief, TaskRef } from "./mission.types";
import { taskPath } from "./missionWords";

const useStyles = makeStyles({
  head: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, color: tokens.colorPaletteMarigoldForeground1 },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
});

interface ApprovalCardProps {
  approval: ApprovalBrief;
  taskRef: TaskRef;
  /** The revision of the task the page shows: what the person's decision is made on. */
  revision: number;
  objective: string;
  projectName?: string;
  /** Opens the page's one confirmation dialog for this decision. */
  onAsk: (asking: Asking) => void;
  /** A link to the task's own page, where it is shown from the machine's queue. */
  review?: boolean;
}

// A governance event, shown in full BEFORE anybody is asked to decide it: which action, where, why,
// at what risk, for which task and attempt, asked when. Approve once allows that one action, once --
// never a standing permission -- and both buttons only ask; the dialog's button decides.
export function ApprovalCard({ approval, taskRef, revision, objective, projectName, onAsk, review }: ApprovalCardProps) {
  const styles = useStyles();
  const follow = useFollow();
  const to = taskPath(taskRef);
  const readOnly = !mutationToken();
  const where = approval.environment ?? "an unnamed environment";
  const approve: Asking = {
    request: { ref: taskRef, decision: { kind: "approve", approval: approval.id, expectedRevision: revision } },
    title: "Approve this action once?",
    confirmLabel: "Approve once",
    body: (
      <Text>
        This allows <span className={styles.mono}>{approval.action}</span> on {where}, once, for “{objective}”. It grants nothing else: an action with another
        environment, tool or parameter needs an approval of its own. Risk: {approval.risk ?? "not stated"}.
      </Text>
    ),
  };
  const reject: Asking = {
    request: { ref: taskRef, decision: { kind: "reject", approval: approval.id, expectedRevision: revision } },
    title: "Reject this action?",
    confirmLabel: "Reject",
    destructive: true,
    body: (
      <Text>
        The task will not run <span className={styles.mono}>{approval.action}</span> on {where}. The rejection stays in its history.
      </Text>
    ),
  };
  return (
    <Card
      title={`Requires approval${projectName ? ` · ${projectName}` : ""}`}
      subtitle={
        <span className={styles.head}>
          <Warning20Filled aria-hidden /> {approval.id} waits for a person
        </span>
      }
    >
      <Facts
        label={`Approval ${approval.id}`}
        rows={[
          ["Action", <span className={styles.mono}>{approval.action}</span>],
          ["Environment", where],
          ["Reason", approval.reason ?? "not stated"],
          ["Risk", approval.risk ?? "not stated"],
          ["Task", `${objective} (${taskRef.task})`],
          ["Attempt", approval.attempt ?? "none open"],
          ["Requested at", formatDateTime(approval.requestedAt)],
          ...(approval.expires ? [["Expires", formatDateTime(approval.expires)] as const] : []),
        ]}
      />
      <div className={styles.actions}>
        <Button disabled={readOnly} onClick={() => onAsk(reject)} aria-label={`Reject ${approval.id} of ${objective}`}>
          Reject
        </Button>
        <Button appearance="primary" disabled={readOnly} onClick={() => onAsk(approve)} aria-label={`Approve once ${approval.id} of ${objective}`}>
          Approve once
        </Button>
        {review && (
          <Link href={to} onClick={follow(to)}>
            Review the task
          </Link>
        )}
        {readOnly && <Caption1 className={styles.muted}>Open Control from the address it printed at start-up to decide.</Caption1>}
      </div>
    </Card>
  );
}
