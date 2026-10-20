import { useState } from "react";
import { Badge, Button, Caption1, Dropdown, MessageBar, MessageBarBody, Option, Switch, Text, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { formatRelative } from "../../../shared/format";
import { reportsApi, useReportChange, useReportParts } from "../reports.api";
import type { PartRow, PartsView, StorePartRow } from "../reports.types";
import { isAvailable } from "../reportWords";
import { NotHere } from "./OverviewTab";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  rows: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  row: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, paddingBlock: tokens.spacingVerticalS, borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`, ":first-child": { borderTop: "none" } },
  line: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
});

export function ExtensionsTab() {
  const parts = useReportParts();
  if (parts.isPending) return <LoadingState label="Loading the report's parts…" />;
  if (parts.isError) return <ErrorState error={parts.error} title="Could not list the report's parts" onRetry={() => parts.refetch()} />;
  if (!isAvailable(parts.data)) return <NotHere why={parts.data.why} />;
  return <Parts view={parts.data} />;
}

// Standard parts ship with the plugin; a project's own live in its store, made
// for a need somebody had, and run BESIDE the standard ones unless a person
// approved one replacing a standard part.
function Parts({ view }: { view: PartsView }) {
  const styles = useStyles();
  return (
    <div className={styles.stack}>
      <Card title="This project's parts" subtitle="Made for this project and kept in its machine store; a plugin update never touches them.">
        {view.project.length ? (
          <ul className={styles.rows}>
            {view.project.map((p) => (
              <StorePart key={p.id} part={p} revision={view.revision} />
            ))}
          </ul>
        ) : (
          <Caption1>None yet. When a report needs something the standard parts do not compute, Orbit makes the smallest part for it here.</Caption1>
        )}
      </Card>
      {(view.refused.length > 0 || view.contested.length > 0) && (
        <Card title="Not loaded">
          <ul className={styles.rows}>
            {view.refused.map((r) => (
              <li key={r.id} className={styles.row}>
                <Text weight="semibold">{r.id}</Text>
                <Caption1 className={styles.muted}>{r.why}</Caption1>
              </li>
            ))}
            {view.contested.map((c) => (
              <li key={c.id} className={styles.row}>
                <Text weight="semibold">{c.id}</Text>
                <Caption1 className={styles.muted}>declared by {c.owners.join(" and ")}, so neither runs</Caption1>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Standard parts" subtitle="Shipped with the plugin.">
        <ul className={styles.rows}>
          {view.standard.map((p) => (
            <li key={p.id} className={styles.row}>
              <PartLine part={p} revision={view.revision} />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="The next run" subtitle="What would run, and what would be left out and why — decided before anything runs.">
        <Caption1 className={styles.mono}>{view.would.run.join(" · ")}</Caption1>
        {view.would.skipped.map((s) => (
          <Caption1 key={s.id}>
            <Text weight="semibold">{s.id}</Text> — {s.why}
          </Caption1>
        ))}
      </Card>
    </div>
  );
}

function PartLine({ part, revision }: { part: PartRow; revision: string | null }) {
  const styles = useStyles();
  const toggle = useReportChange((on: boolean) => reportsApi.switchPart(on ? "enable" : "disable", part.id, revision));
  return (
    <>
      <div className={styles.line}>
        <Text weight="semibold">{part.id}</Text>
        <Badge appearance="outline">{part.kind}</Badge>
        <Caption1 className={styles.muted}>{part.version}{part.provider ? ` · reads ${part.provider}` : ""}</Caption1>
        {part.last && <LastRun last={part.last} />}
        <Switch label={part.enabled ? "On" : "Off"} checked={part.enabled} disabled={!mutationToken() || toggle.isPending} onChange={(_, d) => toggle.mutate(d.checked)} aria-label={`${part.id} on`} />
      </div>
      <Caption1 className={styles.muted}>{part.doc}</Caption1>
      {toggle.isError && <ErrorState error={toggle.error} title="Not changed" />}
    </>
  );
}

function LastRun({ last }: { last: NonNullable<PartRow["last"]> }) {
  return (
    <Badge appearance="tint" color={last.status === "ok" ? "success" : last.errorKind === "extension" ? "danger" : "warning"}>
      {`last run ${last.status} ${formatRelative(last.at)}`}
    </Badge>
  );
}

const FINGERPRINT: Record<StorePartRow["extension"]["fingerprint"], string> = { ok: "files as verified", changed: "files changed since verified — it will not run", absent: "no registration record" };

function StorePart({ part, revision }: { part: StorePartRow; revision: string | null }) {
  const styles = useStyles();
  const verify = useReportChange(() => reportsApi.verify(part.extension.id));
  const approve = useReportChange((yes: boolean) => reportsApi.switchPart(yes ? "approve" : "unapprove", part.id, revision));
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={styles.row}>
      <ConfirmDialog open={confirming} title={`Let ${part.id} replace ${part.replaces ?? ""}?`} confirmLabel="Approve" busy={approve.isPending} onCancel={() => setConfirming(false)} onConfirm={() => approve.mutate(true, { onSettled: () => setConfirming(false) })}>
        The standard part stops running for this project and {part.id} runs instead. It must provide everything the standard one did; if two parts replace the same one, neither does.
      </ConfirmDialog>
      <PartLine part={part} revision={revision} />
      <div className={styles.line}>
        <Badge appearance="tint" color="brand">extension {part.extension.id} {part.extension.version ?? ""}</Badge>
        <Caption1>{part.extension.status ?? "not loaded"} · {FINGERPRINT[part.extension.fingerprint]}</Caption1>
        {part.replaces && <Caption1>replaces {part.replaces} — {part.approved ? "approved" : "not approved"}</Caption1>}
      </div>
      {part.extension.createdFor && <Caption1 className={styles.muted}>Made for: {part.extension.createdFor}</Caption1>}
      <Caption1 className={styles.muted}>needs {part.needs.join(", ") || "nothing"} · provides {part.provides.join(", ") || "nothing"}</Caption1>
      {part.last?.error && <Caption1>Last error: {part.last.error}</Caption1>}
      <div className={styles.line}>
        <Button disabled={!mutationToken() || verify.isPending} onClick={() => verify.mutate(undefined)}>{verify.isPending ? "Verifying…" : "Re-verify"}</Button>
        {part.replaces && !part.approved && <Button disabled={!mutationToken()} onClick={() => setConfirming(true)}>Approve replacement</Button>}
        {part.replaces && part.approved && <Button disabled={!mutationToken() || approve.isPending} onClick={() => approve.mutate(false)}>Withdraw approval</Button>}
        {part.extension.versions.length > 0 && <Rollback part={part} />}
      </div>
      {verify.data && (
        <MessageBar intent={verify.data.ok ? "success" : "error"} layout="multiline">
          <MessageBarBody>{verify.data.ok ? "Verified: it loads, passes the static checks and computes on a snapshot." : verify.data.findings.join(" · ")}</MessageBarBody>
        </MessageBar>
      )}
      {verify.isError && <ErrorState error={verify.error} title="Not verified" />}
      {approve.isError && <ErrorState error={approve.error} title="Not changed" />}
    </li>
  );
}

function Rollback({ part }: { part: StorePartRow }) {
  const [to, setTo] = useState(part.extension.versions[0]?.name ?? "");
  const back = useReportChange(() => reportsApi.rollback(part.extension.id, to || null));
  return (
    <>
      <Dropdown aria-label="Version to roll back to" value={to} selectedOptions={to ? [to] : []} onOptionSelect={(_, d) => setTo(d.optionValue ?? "")}>
        {part.extension.versions.map((v) => (
          <Option key={v.name} value={v.name}>
            {v.name}
          </Option>
        ))}
      </Dropdown>
      <Button disabled={!mutationToken() || !to || back.isPending} onClick={() => back.mutate(undefined)}>{back.isPending ? "Rolling back…" : "Roll back"}</Button>
      {back.isError && <ErrorState error={back.error} title="Not rolled back" />}
    </>
  );
}
