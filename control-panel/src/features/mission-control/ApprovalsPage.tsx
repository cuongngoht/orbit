import { Breadcrumb, BreadcrumbButton, BreadcrumbDivider, BreadcrumbItem, Button, MessageBar, MessageBarBody, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { useFollow } from "../../shared/navigation/useFollow";
import { DecisionError, useDecisions } from "./components";
import { useMissionApprovals } from "./mission.api";
import { Queue } from "./MissionControlPage";
import { MISSION_PATH } from "./missionWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
});

export function MissionTrail({ current }: { current: string }) {
  const follow = useFollow();
  return (
    <Breadcrumb aria-label="Breadcrumb" size="small">
      <BreadcrumbItem>
        <BreadcrumbButton as="a" href={MISSION_PATH} onClick={follow(MISSION_PATH)}>
          Mission Control
        </BreadcrumbButton>
      </BreadcrumbItem>
      <BreadcrumbDivider />
      <BreadcrumbItem>
        <BreadcrumbButton current>{current}</BreadcrumbButton>
      </BreadcrumbItem>
    </Breadcrumb>
  );
}

// `/mission-control/approvals`: every action a task on this machine asked a person to approve, and
// nobody has answered yet -- a projection; each approval belongs to its task's journal.
export function ApprovalsPage() {
  const styles = useStyles();
  const queue = useMissionApprovals();
  const { ask, dialog, decide } = useDecisions();
  const items = queue.data?.approvals ?? [];
  return (
    <>
      <PageHeader
        title="Approvals"
        context={<MissionTrail current="Approvals" />}
        description="Each is one action of one task, waiting for a person. Approve once allows that action, once; it is never a standing permission."
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={queue.isFetching} onClick={() => queue.refetch()}>
            Refresh
          </Button>
        }
      />
      <div className={styles.stack}>
        {queue.isPending && <LoadingState label="Reading what waits for a person…" />}
        {queue.isError && <ErrorState error={queue.error} title="Could not read the approvals" onRetry={() => queue.refetch()} />}
        {decide.isError && <DecisionError error={decide.error} />}
        {queue.data && items.length === 0 && (
          <MessageBar intent="success">
            <MessageBarBody>Nothing waits for a person on this machine.</MessageBarBody>
          </MessageBar>
        )}
        {items.length > 0 && <Queue items={items} onAsk={ask} />}
      </div>
      {dialog}
    </>
  );
}
