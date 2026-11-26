// AN EMPLOYEE'S RUNTIME SECURITY (ADR 0063): what its attempts are held to now (the company's policy, its department's, the
// deployment's floor), what holds its running attempt -- each plane's identity as the allocator and the sensor agreed on
// it -- what was reported about its attempts, and its incidents. With no running attempt there is nothing to protect or
// observe: its desk is storage, never shown as a process.
import { MessageBar, MessageBarBody, Spinner, Text } from "@fluentui/react-components";
import { ShieldClearIcon } from "../../components/SectionIcons";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, EmptyState, Word, short, useParts, when } from "../governance/parts";
import { employeeRuntime } from "../governance/runtimeSecurityApi";
import { EventRow, WorkloadRow } from "../governance/RuntimeSecurityPage";

export function EmployeeRuntimeSecurityTab({ employeeId }: { employeeId: string }) {
  const { t } = useI18n();
  const s = useParts();
  const view = useResource(() => employeeRuntime(employeeId), [employeeId]);
  useAppEvent("governance.changed", (e) => e.data.area === "runtime-security" && void view.reload());
  if (view.data === null) return view.error ? <MessageBar intent="error"><MessageBarBody>{view.error}</MessageBarBody></MessageBar> : <Spinner size="tiny" label={t("office.shared.reading")} />;
  const v = view.data;
  return (
    <div className={s.page}>
      <Card title={t("office.employee.runtime.title")} icon={<ShieldClearIcon size={18} />} tone="brand" description={t("office.employee.runtime.effective", { mode: `${v.effective.mode} (${v.effective.from})`, controls: v.effective.controls.join(", ") || t("office.employee.runtime.noControl") })}>
        {v.current === null ? (
          <EmptyState title={t("office.employee.runtime.idleTitle")} body={t("office.employee.runtime.idleBody")} />
        ) : (
          <>
            <WorkloadRow w={v.current} asOf={view.loadedAt} />
            {v.current.planes.map((p) => (
              <Text key={p.containerId} size={200} block className={s.muted}>
                {p.plane} {short(p.containerId, 12)} · mnt {p.mntNs ?? "?"}
                {p.sensorMntNs !== p.mntNs ? ` (the sensor saw ${p.sensorMntNs ?? "nothing"})` : ""}
              </Text>
            ))}
            <div className={s.row}>
              {v.current.checks.map((c) => (
                <Word key={c.name} value={c.ok ? "ok" : "failed"} label={c.name} />
              ))}
            </div>
          </>
        )}
      </Card>
      {v.recent.filter((w) => w.runId !== v.current?.runId).length > 0 && (
        <Card title={t("office.employee.runtime.recent")} tone="neutral">
          {v.recent
            .filter((w) => w.runId !== v.current?.runId)
            .map((w) => (
              <WorkloadRow key={w.runId} w={w} asOf={view.loadedAt} />
            ))}
        </Card>
      )}
      <Card title={t("office.employee.runtime.events")} tone="neutral">
        {v.events.length === 0 ? <Text size={200}>{t("office.employee.runtime.noEvents")}</Text> : v.events.map((e) => <EventRow key={e.id} e={e} />)}
      </Card>
      <Card title={t("office.employee.runtime.incidents")} tone="danger">
        {v.incidents.length === 0 ? (
          <Text size={200}>{t("office.employee.runtime.noIncidents")}</Text>
        ) : (
          v.incidents.map((i) => (
            <div key={i.id} className={s.row}>
              <Word value={i.state.toLowerCase()} />
              <Word value={i.severity.toLowerCase()} />
              <Text>{i.title}</Text>
              <Text size={200} className={s.muted}>
                {when(i.lastSeen)}
              </Text>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
