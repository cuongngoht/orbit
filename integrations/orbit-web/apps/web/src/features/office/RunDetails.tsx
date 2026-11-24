// ONE ATTEMPT, as its records say it -- why it was started, and three records never merged: what was ASKED, what the
// backend RESOLVED (or the container runtime APPLIED), and what the runtime or the container itself OBSERVED. "unknown"
// is said as unknown, and a value nobody reported is "not reported": nothing is filled in from another column.
import { Badge, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ErrorCircle16Regular, ShieldCheckmark16Regular, Warning16Regular } from "@fluentui/react-icons";
import { effortLabel, type RunView, type UsageView } from "@orbit-web/contracts";
import type { ReactNode } from "react";
import { t as tr, useI18n } from "../../i18n";
import { AREA_TEXT, LEVEL_TEXT, LEVEL_TONE, cpuText, sizeText } from "../resources/format";
import { Callout, RUN_STATE_KEYS, useOfficeStyles, when } from "./parts";

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

const said = (v: string | null | undefined): string => (v === undefined || v === null ? tr("office.run.notReported") : v === "unknown" ? tr("office.run.unknown") : v);
const effortSaid = (v: string | null | undefined): string => (v === undefined ? tr("office.run.notAsked") : v === null ? tr("office.run.none") : v === "unknown" ? tr("office.run.unknown") : effortLabel(v));
const onOff = (v: boolean | undefined): string => (v === undefined ? tr("office.run.notAsked") : v ? tr("office.run.on") : tr("office.run.off"));

function Rows({ label, secondCol, rows }: { label: string; secondCol: string; rows: [string, ReactNode, ReactNode, ReactNode][] }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  return (
    <div className={o.tableWrap}>
      <Table size="small" aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell />
            <TableHeaderCell>{t("office.run.colRequested")}</TableHeaderCell>
            <TableHeaderCell>{secondCol}</TableHeaderCell>
            <TableHeaderCell>{t("office.run.colObserved")}</TableHeaderCell>
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
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  if (u === null)
    return (
      <div className={o.inset}>
        <Text weight="semibold" size={200}>
          {title}
        </Text>
        <Text size={200} className={o.muted}>
          {t("office.run.nothingMeasured", { title })}
        </Text>
      </div>
    );
  return (
    <div className={o.inset} aria-label={title}>
      <Text weight="semibold" size={200}>
        {title}
      </Text>
      <Text size={200} className={s.num}>
        {t("office.run.usageStats", {
          cpu: u.cpuSeconds === null ? t("office.run.unknown") : t("office.run.seconds", { count: u.cpuSeconds.toLocaleString("en-US") }),
          memNow: sizeText(u.memoryCurrentMiB),
          memPeak: sizeText(u.memoryPeakMiB),
          pids: u.pidsPeak ?? t("office.run.unknown"),
          disk: sizeText(u.diskUsedMiB),
        })}
      </Text>
      {(u.networkBytesIn !== null || u.networkBytesOut !== null) && (
        <Text size={200} className={s.num}>
          {t("office.run.networkStats", {
            inBytes: u.networkBytesIn === null ? t("office.run.unknown") : sizeText(u.networkBytesIn / 1048576),
            outBytes: u.networkBytesOut === null ? t("office.run.unknown") : sizeText(u.networkBytesOut / 1048576),
          })}
        </Text>
      )}
      {u.oomKilled && (
        <Callout tone="danger" icon={<ErrorCircle16Regular />}>
          {t("office.run.oomError")}
        </Callout>
      )}
      <Text size={200} className={o.muted}>
        {t("office.run.sampled", { at: when(u.sampledAt) })}
      </Text>
    </div>
  );
}

export function RunDetails({ run }: { run: RunView }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const r = run.resources;
  const waiting = run.state === "waiting_for_resources" || run.state === "unschedulable";
  return (
    <div className={s.root} aria-label={t("office.run.attemptTitle", { no: run.attemptNo })}>
      <div className={o.between}>
        <div className={o.row}>
          <Text weight="semibold">{t("office.run.attemptTitle", { no: run.attemptNo })}</Text>
          <Badge appearance="tint" color={run.state === "failed" || run.state === "unschedulable" ? "danger" : run.state === "waiting_for_resources" ? "warning" : run.state === "succeeded" ? "success" : "informative"} style={{ borderRadius: "9999px" }}>
            {t(RUN_STATE_KEYS[run.state])}
          </Badge>
        </div>
        <Text size={200} className={o.muted}>
          {t("office.run.started", { at: when(run.startedAt) })}
          {run.endedAt ? t("office.run.ended", { at: when(run.endedAt) }) : ""}
        </Text>
      </div>
      {run.wakeReason && (
        <Text size={200} className={o.wrap}>
          {t("office.run.wakeReason", { why: run.wakeReason })}
        </Text>
      )}
      {waiting && (
        <Callout tone={run.state === "unschedulable" ? "danger" : "warn"} icon={run.state === "unschedulable" ? <ErrorCircle16Regular /> : <Warning16Regular />}>
          {run.state === "unschedulable" ? t("office.run.unschedulablePrefix") : t("office.run.waitingPrefix")}: {run.waitingReason ?? t("office.run.noReasonGiven")}
        </Callout>
      )}
      {run.detail && (
        <Text size={200} className={o.wrap}>
          {run.detail}
        </Text>
      )}
      <Rows
        label={t("office.run.modelAndEffort")}
        secondCol={t("office.run.colResolved")}
        rows={[
          [t("office.run.rowModel"), said(run.requested.model), run.resolved ? said(run.resolved.model) : t("office.run.notResolved"), said(run.observed.model)],
          [t("office.run.rowEffort"), effortSaid(run.requested.effort), run.resolved ? effortSaid(run.resolved.effort) : t("office.run.notResolved"), effortSaid(run.observed.effort)],
          [t("office.run.rowWebSearch"), onOff(run.requested.webSearch), run.resolved ? onOff(run.resolved.webSearch) : t("office.run.notResolved"), t("office.run.notReported")],
          [
            t("office.run.rowPlugins"),
            onOff(run.requested.orbitPlugin),
            run.resolved ? onOff(run.resolved.orbitPlugin) : t("office.run.notResolved"),
            run.observed.plugins === "unknown" ? t("office.run.unknown") : run.observed.plugins.length === 0 ? t("office.run.none") : run.observed.plugins.join(", "),
          ],
        ]}
      />
      <div className={s.metaStrip}>
        <Text size={200} className={o.muted}>
          {t("office.run.metaLine", {
            version: run.observed.runtimeVersion ?? t("office.run.notReported"),
            cost: run.modelUsage.costUsd === null ? t("office.run.notReported") : `$${run.modelUsage.costUsd.toFixed(2)}`,
            turns: run.modelUsage.turns ?? t("office.run.notReported"),
          })}
        </Text>
      </div>
      {r && (
        <Rows
          label={t("office.run.resourcesLabel")}
          secondCol={t("office.run.colApplied")}
          rows={[
            [t("office.employee.tileCpu"), cpuText(r.requested.cpuMillis), r.applied ? cpuText(r.applied.cpuMillis) : t("office.run.notReadBack"), r.observed ? said(r.observed.cpuQuota) : t("office.run.notObserved")],
            [t("office.employee.tileMemory"), sizeText(r.requested.memoryMiB), r.applied ? sizeText(r.applied.memoryMiB) : t("office.run.notReadBack"), r.observed ? said(r.observed.memoryLimit) : t("office.run.notObserved")],
            [
              t("office.employee.tileProcesses"),
              String(r.requested.pidsLimit),
              r.applied ? (r.applied.pidsLimit === null ? t("office.run.unknown") : String(r.applied.pidsLimit)) : t("office.run.notReadBack"),
              r.observed ? said(r.observed.pidsMax) : t("office.run.notObserved"),
            ],
          ]}
        />
      )}
      {r?.observed && r.observed.storage.length > 0 && (
        <ul className={o.list} aria-label={t("office.run.storageObservedAria")}>
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
        <Usage title={t("office.run.cliContainer")} u={run.usage.modelPlane} />
        <Usage title={t("office.run.sandboxContainer")} u={run.usage.toolPlane} />
      </div>
      {run.sandbox && (
        <div className={o.inset} aria-label={t("office.run.isolationAria")}>
          <div className={o.between}>
            <div className={o.row}>
              <ShieldCheckmark16Regular aria-hidden />
              <Text weight="semibold" size={200}>
                {t("office.run.isolationTitle")}
              </Text>
              <Badge appearance="tint" color={run.sandbox.state === "attested" ? "success" : run.sandbox.state === "not_isolated" ? "warning" : "danger"} style={{ borderRadius: "9999px" }}>
                {run.sandbox.state === "attested"
                  ? t("office.run.isolationAttested")
                  : run.sandbox.state === "not_isolated"
                    ? t("office.run.isolationNotIsolated")
                    : run.sandbox.state === "failed"
                      ? t("office.run.isolationFailed")
                      : t("office.run.isolationExpired")}
              </Badge>
            </div>
            <Text size={200} className={o.muted}>
              {run.sandbox.shell ? t("office.run.shellGranted") : t("office.run.shellNotGranted")}
            </Text>
          </div>
          <Text size={200}>{run.sandbox.detail}</Text>
          <ul className={o.list} aria-label={t("office.run.checksAria")}>
            {run.sandbox.checks.map((c) => (
              <li key={c.name}>
                <Text size={200}>
                  {c.ok ? t("office.run.checkHeld") : t("office.run.checkFailed")}: {c.name}
                  {c.detail ? ` — ${c.detail}` : ""}
                </Text>
              </li>
            ))}
          </ul>
          <Text size={200} className={o.muted}>
            {t("office.run.checkedAt", { at: when(run.sandbox.checkedAt) })}
          </Text>
        </div>
      )}
    </div>
  );
}
