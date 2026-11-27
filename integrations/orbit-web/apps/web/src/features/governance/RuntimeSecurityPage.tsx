// RUNTIME SECURITY (ADR 0063): what the account's employee attempts are held to while their programs run, what this
// host has PROVEN it can observe and prevent, what holds each running attempt now, what the sensor reported -- each
// event saying whether it was only OBSERVED, DETECTED (a rule matched and nothing was refused) or PREVENTED (refused by
// the kernel under an enforcing policy) -- and the incidents a person reviews. Nothing here is green without proof that
// is still fresh, an unknown is never shown as healthy, and nothing on this page can lower the policy: the mode is the
// policy's, changed through Governance → Policy.
import { Button, MessageBar, MessageBarBody, Spinner, Text, Textarea } from "@fluentui/react-components";
import { protectionBadge, type CapabilityResult, type IncidentDecision, type IncidentView, type RuntimeEventView, type WorkloadProtectionView } from "@orbit-web/contracts";
import { RUNTIME_CONTROLS } from "@orbit-web/governance-core";
import { useState } from "react";
import { FindingsIcon, ShieldClearIcon } from "../../components/SectionIcons";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, CleanSelect, EmptyState, ErrorBar, Stat, Word, short, useParts, when } from "./parts";
import { reviewIncident, runtimeEvents, runtimeIncident, runtimeIncidents, runtimeOverview, runtimeWorkloads } from "./runtimeSecurityApi";

const OUTCOME_WORD: Record<string, string> = { OBSERVED: "observed", VIOLATION_DETECTED: "detected", OPERATION_PREVENTED: "prevented", PROCESS_TERMINATED: "terminated", WORKLOAD_CONTAINED: "contained" };

function Capability({ c }: { c: CapabilityResult }) {
  const s = useParts();
  return (
    <div className={s.row}>
      <Word value={c.state === "SUPPORTED" ? "supported" : c.state === "UNSUPPORTED" ? "unsupported" : c.state.toLowerCase()} />
      <Text weight="semibold">{c.capability}</Text>
      <Text size={200} className={s.muted}>
        {c.detail}
      </Text>
    </div>
  );
}

// `asOf`: when the list was read -- the proof is judged fresh or stale at that moment, never at a render's.
export function WorkloadRow({ w, asOf }: { w: WorkloadProtectionView; asOf: string | null }) {
  const s = useParts();
  const badge = asOf === null ? "unknown" : protectionBadge(w, Date.parse(asOf));
  return (
    <div className={s.row} data-testid={`workload-${w.runId}`}>
      <Word value={`protection_${badge}`} label={badge} />
      <Text weight="semibold">{w.employeeName}</Text>
      <Text size={200} className={s.muted}>
        {w.mode} · {w.state} · attempt {w.attempt} · {w.runState} · {w.controls.join(", ") || "no control"} · {when(w.updatedAt)}
      </Text>
      {w.detail !== "" && (
        <Text size={200} className={s.muted}>
          {w.detail}
        </Text>
      )}
    </div>
  );
}

export function EventRow({ e }: { e: RuntimeEventView }) {
  const s = useParts();
  return (
    <div className={s.row} data-testid={`event-${e.id}`}>
      <Word value={OUTCOME_WORD[e.outcome] ?? e.outcome} label={OUTCOME_WORD[e.outcome] ?? e.outcome} />
      <Word value={e.severity.toLowerCase()} />
      <Text size={200}>
        {e.kind} · {e.plane} · {e.binary ?? "—"}
        {e.path !== null ? ` → ${e.path}` : ""}
        {e.parentBinary !== null ? ` (parent ${e.parentBinary})` : ""}
        {e.dropped !== null ? ` · ${e.dropped} not kept` : ""}
      </Text>
      <Text size={200} className={s.muted}>
        {e.runKind} {short(e.runId, 8)} · {when(e.occurredAt)}
      </Text>
    </div>
  );
}

function Incident({ i, onChanged }: { i: IncidentView; onChanged: () => void }) {
  const { t } = useI18n();
  const s = useParts();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<IncidentView | null>(null);
  const [decision, setDecision] = useState<IncidentDecision>("investigate");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const show = () => {
    setOpen(!open);
    if (!open) void runtimeIncident(i.id).then(setDetail).catch((err: unknown) => setError(errorText(err)));
  };
  const submit = () => {
    setError(null);
    const current = detail ?? i;
    void reviewIncident(i.id, current.version, current.state === "RESOLVED" && current.blocksRetry ? "authorize_retry" : decision, note)
      .then((v) => {
        setDetail(v);
        setNote("");
        onChanged();
      })
      .catch((err: unknown) => setError(errorText(err)));
  };
  const d = detail ?? i;
  // A resolved incident that still holds the work is released only by a retry authorized with a reason.
  const releaseOnly = d.state === "RESOLVED" && d.blocksRetry;
  const chosen: IncidentDecision = releaseOnly ? "authorize_retry" : decision;
  return (
    <Card icon={<FindingsIcon size={18} />} tone={i.severity === "CRITICAL" || i.severity === "HIGH" ? "danger" : "warning"} title={<>{i.title} <Word value={i.state.toLowerCase()} /> <Word value={i.severity.toLowerCase()} /> {i.blocksRetry && <Word value="held" label={t("governance.runtime.holdsRetry")} />}</>}>
      <Text size={200} className={s.muted}>
        {i.category} · {i.employeeName ?? "—"} · {t("governance.runtime.seen", { count: i.count })} · {when(i.firstSeen)} – {when(i.lastSeen)}
      </Text>
      <div className={s.row}>
        <Button size="small" onClick={show}>
          {open ? t("governance.runtime.hide") : t("governance.runtime.details")}
        </Button>
      </div>
      {open && (
        <>
          <Text size={200}>{Object.entries(d.evidence).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</Text>
          {d.actions.map((a, n) => (
            <Text key={n} size={200} className={s.muted}>
              {when(a.at)} · {a.action} · {a.actor} · {a.outcome}
              {a.detail !== null ? ` · ${a.detail}` : ""}
            </Text>
          ))}
          {releaseOnly && (
            <Text size={200} className={s.muted}>
              {t("governance.runtime.resolvedHolds")}
            </Text>
          )}
          {(d.state !== "RESOLVED" || releaseOnly) && (
            <div className={s.row}>
              <CleanSelect
                value={chosen}
                ariaLabel={t("governance.runtime.decision")}
                options={[
                  ...(releaseOnly
                    ? []
                    : [
                        { value: "investigate", label: t("governance.runtime.investigate") },
                        { value: "resolve", label: t("governance.runtime.resolve") },
                      ]),
                  { value: "authorize_retry", label: t("governance.runtime.authorizeRetry") },
                ]}
                onChange={(v) => setDecision(v as IncidentDecision)}
              />
              <Textarea aria-label={t("governance.runtime.note")} placeholder={t("governance.runtime.notePlaceholder")} value={note} onChange={(_, v) => setNote(v.value)} />
              <Button size="small" appearance="primary" onClick={submit} disabled={chosen === "authorize_retry" && note.trim() === ""}>
                {t("governance.runtime.submit")}
              </Button>
            </div>
          )}
        </>
      )}
      <ErrorBar text={error} />
    </Card>
  );
}

export function RuntimeSecurityPage() {
  const { t } = useI18n();
  const s = useParts();
  const [outcome, setOutcome] = useState("");
  const [live, setLive] = useState(true);
  const overview = useResource(() => runtimeOverview(), []);
  const workloads = useResource(() => runtimeWorkloads(live), [live]);
  const events = useResource(() => runtimeEvents({ outcome }), [outcome]);
  const incidents = useResource(() => runtimeIncidents(false), []);
  useAppEvent("governance.changed", (e) => {
    if (e.data.area !== "runtime-security") return;
    void overview.reload();
    void workloads.reload();
    void events.reload();
    void incidents.reload();
  });
  if (overview.data === null) return overview.error ? <MessageBar intent="error"><MessageBarBody>{overview.error}</MessageBarBody></MessageBar> : <Spinner label={t("governance.runtime.reading")} />;
  const o = overview.data;
  const host = o.host;
  const prevention = host.capabilities.find((c) => c.capability === "prevent.exec");
  return (
    <div className={s.page}>
      {host.backend === "disabled" && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("governance.runtime.notEnabled")}</MessageBarBody>
        </MessageBar>
      )}
      {o.effective.mode === "observe" && (
        <MessageBar intent="info">
          <MessageBarBody>{t("governance.runtime.observeIsNotPrevention")}</MessageBarBody>
        </MessageBar>
      )}
      {o.effective.mode === "enforce" && prevention?.state !== "SUPPORTED" && (
        <MessageBar intent="error">
          <MessageBarBody>{t("governance.runtime.enforceUnproven", { state: prevention?.state ?? "UNKNOWN" })}</MessageBarBody>
        </MessageBar>
      )}
      <Card title={t("governance.runtime.title")} icon={<ShieldClearIcon size={18} />} tone="brand" description={t("governance.runtime.description")}>
        <div className={s.row}>
          <Stat label={t("governance.runtime.configured")} value={o.configured.mode} />
          <Stat label={t("governance.runtime.effective")} value={`${o.effective.mode} (${o.effective.from})`} tone={o.effective.mode === "enforce" && prevention?.state !== "SUPPORTED" ? "danger" : "neutral"} />
          <Stat label={t("governance.runtime.floor")} value={o.effective.floor} />
          <Stat label={t("governance.runtime.openIncidents")} value={o.openIncidents} tone={o.openIncidents > 0 ? "warning" : "neutral"} />
          <Stat label={t("governance.runtime.prevented")} value={o.prevented24h} />
          <Stat label={t("governance.runtime.detected")} value={o.detected24h} />
        </div>
        <div className={s.row}>
          <Stat label={t("governance.runtime.running")} value={o.coverage.running} />
          <Stat label={t("governance.runtime.protected")} value={o.coverage.protected} />
          <Stat label={t("governance.runtime.observing")} value={o.coverage.observing} />
          <Stat label={t("governance.runtime.degraded")} value={o.coverage.degraded} tone={o.coverage.degraded > 0 ? "warning" : "neutral"} />
          <Stat label={t("governance.runtime.contained")} value={o.coverage.contained} tone={o.coverage.contained > 0 ? "danger" : "neutral"} />
          <Stat label={t("governance.runtime.unprotected")} value={o.coverage.unprotected} />
        </div>
        <Text size={200} className={s.muted}>
          {t(o.sessions === "observed" ? "governance.runtime.sessionsObserved" : "governance.runtime.sessionsNotObserved")}
        </Text>
      </Card>
      <Card title={t("governance.runtime.hostTitle")} icon={<ShieldClearIcon size={18} />} tone={host.sensor.state === "HEALTHY" ? "success" : "warning"}>
        <div className={s.row}>
          <Word value={host.sensor.state.toLowerCase()} />
          <Text>
            {host.backend} {host.backendVersion ?? ""} · {host.hostKind} · {host.kernel ?? "—"} {host.arch ?? ""}
          </Text>
        </div>
        <Text size={200} className={s.muted}>
          {host.sensor.detail}
        </Text>
        <Text size={200} className={s.muted}>
          {t("governance.runtime.telemetry", { last: when(host.telemetry.lastEventAt), lost: host.telemetry.lost, unattributed: host.telemetry.unattributed, days: host.telemetry.retentionDays })}
        </Text>
        {host.capabilities.length === 0 ? <Text size={200}>{t("governance.runtime.noProbe")}</Text> : host.capabilities.map((c) => <Capability key={c.capability} c={c} />)}
        <Text size={200} className={s.muted}>
          {t("governance.runtime.probedAt", { at: when(host.probedAt) })}
        </Text>
      </Card>
      <Card title={t("governance.runtime.controlsTitle")} icon={<ShieldClearIcon size={18} />} tone="neutral">
        {Object.values(RUNTIME_CONTROLS).map((c) => (
          <div key={c.id}>
            <Text weight="semibold">
              {c.title} <Word value={o.effective.controls.includes(c.id) ? "on" : "off"} />
            </Text>
            <Text size={200} block>
              {t("governance.runtime.prevents")}: {c.prevents}
            </Text>
            <Text size={200} block className={s.muted}>
              {t("governance.runtime.doesNotPrevent")}: {c.doesNotPrevent}
            </Text>
          </div>
        ))}
      </Card>
      <Card
        title={t("governance.runtime.workloadsTitle")}
        icon={<ShieldClearIcon size={18} />}
        tone="neutral"
        actions={
          <Button size="small" onClick={() => setLive(!live)}>
            {live ? t("governance.runtime.showAll") : t("governance.runtime.showLive")}
          </Button>
        }
      >
        {(workloads.data?.workloads ?? []).length === 0 ? <EmptyState title={t("governance.runtime.noWorkloads")} /> : workloads.data?.workloads.map((w) => <WorkloadRow key={w.runId} w={w} asOf={workloads.loadedAt} />)}
      </Card>
      <Card
        title={t("governance.runtime.eventsTitle")}
        icon={<FindingsIcon size={18} />}
        tone="neutral"
        actions={<CleanSelect value={outcome} ariaLabel={t("governance.runtime.outcomeFilter")} options={[{ value: "", label: t("governance.runtime.allOutcomes") }, ...Object.entries(OUTCOME_WORD).map(([value, label]) => ({ value, label }))]} onChange={setOutcome} />}
      >
        {(events.data?.events ?? []).length === 0 ? <EmptyState title={t("governance.runtime.noEvents")} /> : events.data?.events.map((e) => <EventRow key={e.id} e={e} />)}
      </Card>
      <Card title={t("governance.runtime.incidentsTitle")} icon={<FindingsIcon size={18} />} tone="danger">
        {(incidents.data?.incidents ?? []).length === 0 && <EmptyState icon={<ShieldClearIcon size={22} />} tone="success" title={t("governance.runtime.noIncidents")} />}
      </Card>
      {incidents.data?.incidents.map((i) => <Incident key={i.id} i={i} onChanged={() => void incidents.reload()} />)}
    </div>
  );
}
