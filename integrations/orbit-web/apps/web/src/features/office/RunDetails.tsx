// ONE ATTEMPT, as its records say it -- three records never merged: what was ASKED, what the backend RESOLVED (or the
// container runtime APPLIED), and what the runtime or the container itself OBSERVED. "unknown" is said as unknown, and a
// value nobody reported is "not reported": nothing is filled in from another column.
import { Badge, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ErrorCircle16Regular, ShieldCheckmark16Regular, Warning16Regular } from "@fluentui/react-icons";
import { effortLabel, type RunView, type UsageView } from "@orbit-web/contracts";
import type { ReactNode } from "react";
import { AREA_TEXT, LEVEL_TEXT, LEVEL_TONE, cpuText, sizeText } from "../resources/format";
import { Callout, RUN_STATE_TEXT, useOfficeStyles, when } from "./parts";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  usageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
    gap: "10px",
    minWidth: 0,
  },
  metaStrip: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
  },
  num: { fontVariantNumeric: "tabular-nums" },
});

const said = (v: string | null | undefined): string => (v === undefined || v === null ? "not reported" : v === "unknown" ? "unknown" : v);
const effortSaid = (v: string | null | undefined): string => (v === undefined ? "not asked" : v === null ? "none" : v === "unknown" ? "unknown" : effortLabel(v));
const onOff = (v: boolean | undefined): string => (v === undefined ? "not asked" : v ? "on" : "off");

function Rows({ label, rows }: { label: string; rows: [string, ReactNode, ReactNode, ReactNode][] }) {
  const o = useOfficeStyles();
  return (
    <div className={o.tableWrap}>
      <Table size="small" aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell />
            <TableHeaderCell>Requested</TableHeaderCell>
            <TableHeaderCell>{label === "Resources" ? "Applied" : "Resolved"}</TableHeaderCell>
            <TableHeaderCell>Observed</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([name, a, b, c]) => (
            <TableRow key={name}>
              <TableCell style={{ fontWeight: 600 }}>{name}</TableCell>
              <TableCell>{a}</TableCell>
              <TableCell>{b}</TableCell>
              <TableCell>{c}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Usage({ title, u }: { title: string; u: UsageView | null }) {
  const o = useOfficeStyles();
  const s = useStyles();
  if (u === null)
    return (
      <div className={o.inset}>
        <Text weight="semibold" size={200}>
          {title}
        </Text>
        <Text size={200} className={o.muted}>
          {title}: nothing measured.
        </Text>
      </div>
    );
  return (
    <div className={o.inset} aria-label={title}>
      <Text weight="semibold" size={200}>
        {title}
      </Text>
      <Text size={200} className={s.num}>
        CPU time {u.cpuSeconds === null ? "unknown" : `${u.cpuSeconds.toLocaleString("en-US")} s`} · memory {sizeText(u.memoryCurrentMiB)} now, {sizeText(u.memoryPeakMiB)} at peak · processes at peak {u.pidsPeak ?? "unknown"} · disk {sizeText(u.diskUsedMiB)}
      </Text>
      {(u.networkBytesIn !== null || u.networkBytesOut !== null) && (
        <Text size={200} className={s.num}>
          Network {u.networkBytesIn === null ? "unknown" : sizeText(u.networkBytesIn / 1048576)} in, {u.networkBytesOut === null ? "unknown" : sizeText(u.networkBytesOut / 1048576)} out
        </Text>
      )}
      {u.oomKilled && (
        <Callout tone="danger" icon={<ErrorCircle16Regular />}>
          Out of memory: the container was stopped at its memory limit — raise the limit or retry.
        </Callout>
      )}
      <Text size={200} className={o.muted}>
        Sampled {when(u.sampledAt)}
      </Text>
    </div>
  );
}

export function RunDetails({ run }: { run: RunView }) {
  const o = useOfficeStyles();
  const s = useStyles();
  const r = run.resources;
  const waiting = run.state === "waiting_for_resources" || run.state === "unschedulable";
  return (
    <div className={s.root} aria-label={`Attempt ${run.attemptNo}`}>
      <div className={o.between}>
        <div className={o.row}>
          <Text weight="semibold">Attempt {run.attemptNo}</Text>
          <Badge appearance="tint" color={run.state === "failed" || run.state === "unschedulable" ? "danger" : run.state === "waiting_for_resources" ? "warning" : run.state === "succeeded" ? "success" : "informative"} style={{ borderRadius: "9999px" }}>
            {RUN_STATE_TEXT[run.state]}
          </Badge>
        </div>
        <Text size={200} className={o.muted}>
          started {when(run.startedAt)}
          {run.endedAt ? ` · ended ${when(run.endedAt)}` : ""}
        </Text>
      </div>
      {waiting && (
        <Callout tone={run.state === "unschedulable" ? "danger" : "warn"} icon={run.state === "unschedulable" ? <ErrorCircle16Regular /> : <Warning16Regular />}>
          {run.state === "unschedulable" ? "It can never start as configured" : "It waits for resources"}: {run.waitingReason ?? "no reason given"}
        </Callout>
      )}
      {run.detail && (
        <Text size={200} className={o.wrap}>
          {run.detail}
        </Text>
      )}
      <Rows
        label="Model and effort"
        rows={[
          ["Model", said(run.requested.model), run.resolved ? said(run.resolved.model) : "not resolved", said(run.observed.model)],
          ["Effort", effortSaid(run.requested.effort), run.resolved ? effortSaid(run.resolved.effort) : "not resolved", effortSaid(run.observed.effort)],
          ["Web search", onOff(run.requested.webSearch), run.resolved ? onOff(run.resolved.webSearch) : "not resolved", "not reported"],
          ["Plugins", onOff(run.requested.orbitPlugin), run.resolved ? onOff(run.resolved.orbitPlugin) : "not resolved", run.observed.plugins === "unknown" ? "unknown" : run.observed.plugins.length === 0 ? "none" : run.observed.plugins.join(", ")],
        ]}
      />
      <div className={s.metaStrip}>
        <Text size={200} className={o.muted}>
          Runtime version {run.observed.runtimeVersion ?? "not reported"} · cost {run.modelUsage.costUsd === null ? "not reported" : `$${run.modelUsage.costUsd.toFixed(2)}`} · turns {run.modelUsage.turns ?? "not reported"}
        </Text>
      </div>
      {r && (
        <Rows
          label="Resources"
          rows={[
            ["CPU", cpuText(r.requested.cpuMillis), r.applied ? cpuText(r.applied.cpuMillis) : "not read back", r.observed ? said(r.observed.cpuQuota) : "not observed"],
            ["Memory", sizeText(r.requested.memoryMiB), r.applied ? sizeText(r.applied.memoryMiB) : "not read back", r.observed ? said(r.observed.memoryLimit) : "not observed"],
            ["Processes", String(r.requested.pidsLimit), r.applied ? (r.applied.pidsLimit === null ? "unknown" : String(r.applied.pidsLimit)) : "not read back", r.observed ? said(r.observed.pidsMax) : "not observed"],
          ]}
        />
      )}
      {r?.observed && r.observed.storage.length > 0 && (
        <ul className={o.list} aria-label="Storage enforcement observed">
          {r.observed.storage.map((a) => (
            <li key={a.area} className={o.item}>
              <div className={o.row}>
                <Text size={200} weight="semibold">
                  {AREA_TEXT[a.area]}
                </Text>
                <Badge appearance="tint" color={LEVEL_TONE[a.level]} style={{ borderRadius: "9999px" }}>
                  {LEVEL_TEXT[a.level]}
                </Badge>
              </div>
              <Text size={200} className={o.muted}>
                {a.evidence}
              </Text>
            </li>
          ))}
        </ul>
      )}
      <div className={s.usageGrid}>
        <Usage title="The CLI's container (model plane)" u={run.usage.modelPlane} />
        <Usage title="The sandbox container (tool plane)" u={run.usage.toolPlane} />
      </div>
      {run.sandbox && (
        <div className={o.inset} aria-label="Isolation attestation">
          <div className={o.between}>
            <div className={o.row}>
              <ShieldCheckmark16Regular aria-hidden />
              <Text weight="semibold" size={200}>
                Isolation
              </Text>
              <Badge appearance="tint" color={run.sandbox.state === "attested" ? "success" : run.sandbox.state === "not_isolated" ? "warning" : "danger"} style={{ borderRadius: "9999px" }}>
                {run.sandbox.state === "attested" ? "Attested" : run.sandbox.state === "not_isolated" ? "Not isolated (development)" : run.sandbox.state === "failed" ? "Failed" : "Expired"}
              </Badge>
            </div>
            <Text size={200} className={o.muted}>
              Shell {run.sandbox.shell ? "granted" : "not granted"}
            </Text>
          </div>
          <Text size={200}>{run.sandbox.detail}</Text>
          <ul className={o.list} aria-label="Attestation checks">
            {run.sandbox.checks.map((c) => (
              <li key={c.name}>
                <Text size={200}>
                  {c.ok ? "Held" : "Failed"}: {c.name}
                  {c.detail ? ` — ${c.detail}` : ""}
                </Text>
              </li>
            ))}
          </ul>
          <Text size={200} className={o.muted}>
            Checked {when(run.sandbox.checkedAt)}
          </Text>
        </div>
      )}
    </div>
  );
}
