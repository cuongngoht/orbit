import { Button, Caption1, MessageBar, MessageBarBody, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { formatRelative } from "../../../shared/format";
import { StateBadge } from "../StateBadge";
import { runtimeApi, useRuntimeOperation } from "../runtime.api";
import type { CheckoutRef, DiscoverResult, RuntimeStatus } from "../runtime.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  head: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "center", flexWrap: "wrap" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

const when = (u: RuntimeStatus["understanding"]) => `${u.facts} fact(s)${u.at ? `, read ${formatRelative(u.at)}` : ""}${u.branch ? ` on ${u.branch}` : ""}${u.commit ? ` @ ${u.commit}` : ""}`;

// What the checkout's own files say it needs -- manifests, version files, container files,
// pipelines, build files -- read ONCE and kept. Reading it again costs a listing when nothing
// moved, and says so. Nothing here runs a file, and nothing writes the repository.
export function UnderstandingCard({ at, status }: { at: CheckoutRef; status: RuntimeStatus }) {
  const styles = useStyles();
  const u = status.understanding;
  const discover = useRuntimeOperation<{ rescan?: boolean }, DiscoverResult>(at, runtimeApi.discover);
  const moved = [...u.stale.map((p) => `${p} changed`), ...u.added.map((p) => `${p} appeared`), ...u.removed.map((p) => `${p} went away`), ...u.dirty.map((p) => `${p} has uncommitted edits`)];
  const disabled = !mutationToken() || discover.isPending;
  return (
    <Card title="Understanding" subtitle="What this checkout's own files say it needs, read once and kept. Nothing is run.">
      <div className={styles.stack}>
        <div className={styles.head}>
          <StateBadge word={u.state} />
          <Caption1 className={styles.muted}>{u.state === "NOT_DISCOVERED" ? "nothing has read this checkout yet" : when(u)}</Caption1>
        </div>
        {moved.length > 0 && (
          <ul className={styles.list} aria-label="What moved">
            {moved.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        {u.gaps.length > 0 && (
          <MessageBar intent="warning" layout="multiline">
            <MessageBarBody>
              Could not be read:
              <ul className={styles.list}>{u.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </MessageBarBody>
          </MessageBar>
        )}
        {u.unknowns.length > 0 && <Caption1 className={styles.muted}>{u.unknowns.length} thing(s) were seen and could not be settled from files alone.</Caption1>}
        <div className={styles.actions}>
          <Button appearance="primary" disabled={disabled} onClick={() => discover.mutate({})}>{discover.isPending ? "Reading…" : u.state === "NOT_DISCOVERED" ? "Read this checkout" : "Read it again"}</Button>
          <Button disabled={disabled} onClick={() => discover.mutate({ rescan: true })}>Read everything from scratch</Button>
        </div>
        {discover.isError && <ErrorState error={discover.error} title="The checkout was not read" />}
        {discover.data && (
          <MessageBar intent="success">
            <MessageBarBody>{discover.data.decision.name}: {discover.data.decision.say}</MessageBarBody>
          </MessageBar>
        )}
      </div>
    </Card>
  );
}
