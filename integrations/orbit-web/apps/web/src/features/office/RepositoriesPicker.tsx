// REPOSITORIES FOR A MISSION: the ones its employee may use on the account's connectors (its Access tab) -- the
// repositories chosen there, or, when it may use every one, the ones the connector lists. Each one checked is brought
// into every attempt as a snapshot of its default branch (a git bundle in /input the employee clones); Orbit Web clones
// it with the connector's sign-in, which never reaches the employee.
import { Checkbox, Input, Link, Spinner, Text } from "@fluentui/react-components";
import { ACCESS_CONNECTOR_LABELS, MAX_MISSION_REPOSITORIES, type AccessConnector, type EmployeeAccess, type MissionRepositoryRequest, type RepositoryList, type SourcesStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { get } from "../../services/api";
import { useOfficeStyles } from "./parts";

interface Offered {
  source: AccessConnector;
  id: string;
  fullName: string;
}

// What one connector offers: the repositories granted, or (every one / delegating) the ones it lists now.
function useOffered(access: EmployeeAccess | null, sources: SourcesStatus | null, delegating: boolean): { offered: Offered[]; reading: boolean; error: string | null } {
  const connected = (c: AccessConnector) => sources?.sources.some((s) => s.source === c && s.state === "connected") === true;
  const every = (c: AccessConnector) => (delegating ? connected(c) : access?.connectors.some((x) => x.connector === c && x.enabled && x.repositories === null) === true);
  const github = useResource<RepositoryList>(every("github") ? () => get("/api/repositories?source=github") : null, [every("github")]);
  const azure = useResource<RepositoryList>(every("azure") ? () => get("/api/repositories?source=azure") : null, [every("azure")]);
  const listed: Record<AccessConnector, RepositoryList | null> = { github: github.data, azure: azure.data };
  const offered = delegating
    ? (["github", "azure"] as const).flatMap((c) => (connected(c) ? (listed[c]?.repositories ?? []).map((r) => ({ source: c, id: r.id, fullName: r.fullName })) : []))
    : (access?.connectors ?? [])
        .filter((c) => c.enabled)
        .flatMap((c) => (c.repositories ?? listed[c.connector]?.repositories ?? []).map((r) => ({ source: c.connector, id: r.id, fullName: r.fullName })));
  return { offered, reading: (every("github") && github.data === null && github.error === null) || (every("azure") && azure.data === null && azure.error === null), error: github.error ?? azure.error };
}

export function RepositoriesPicker({ employeeId, employeeName, delegating = false, value, onChange }: { employeeId: string; employeeName: string; delegating?: boolean; value: MissionRepositoryRequest[]; onChange: (v: MissionRepositoryRequest[]) => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const access = useResource<EmployeeAccess>(!delegating && employeeId !== "" ? () => get(`/api/employees/${employeeId}/access`) : null, [delegating, employeeId]);
  const sources = useResource<SourcesStatus>(delegating ? () => get("/api/sources") : null, [delegating]);
  const { offered, reading, error } = useOffered(access.data, sources.data, delegating);
  const [filter, setFilter] = useState("");
  const chosen = (r: Offered) => value.some((v) => v.source === r.source && v.id === r.id);
  const toggle = (r: Offered, on: boolean) => onChange(on ? [...value, { source: r.source, id: r.id, branch: null }] : value.filter((v) => !(v.source === r.source && v.id === r.id)));
  const shown = offered.filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));
  const accessLink = (
    <Link href={`#/office/employee/${employeeId}/access`} inline>
      {t("office.repos.accessLink")}
    </Link>
  );
  const loadingBase = delegating ? sources.data === null && sources.error === null : access.data === null && access.error === null;
  const failedBase = delegating ? sources.data === null && sources.error !== null : access.data === null && access.error !== null;
  return (
    <div role="group" aria-label={t("office.repos.groupAria")} className={o.stack}>
      <Text weight="semibold" size={300}>
        {t("office.repos.title")}
      </Text>
      <Text size={200} className={o.muted}>
        {t(delegating ? "office.repos.delegatingHint" : "office.repos.hint", { max: MAX_MISSION_REPOSITORIES })}
      </Text>
      {loadingBase ? (
        <Spinner size="tiny" label={t("office.repos.readingAllowed")} />
      ) : failedBase ? null : offered.length === 0 && !reading ? (
        <Text size={200} className={o.muted}>
          {delegating ? (
            t("office.repos.noneConnected")
          ) : (
            <>
              {t("office.repos.noneAllowedPrefix", { name: employeeName || t("office.repos.thisEmployee") })}
              {accessLink}
              {t("office.repos.noneAllowedSuffix")}
            </>
          )}
        </Text>
      ) : (
        <>
          {offered.length > 8 && <Input size="small" placeholder={t("office.repos.filterPlaceholder")} value={filter} onChange={(_, d) => setFilter(d.value)} aria-label={t("office.repos.filterPlaceholder")} />}
          {reading && <Spinner size="tiny" label={t("office.repos.readingRepos")} />}
          {error !== null && <Text size={200}>{t("office.repos.readError", { error })}</Text>}
          {shown.map((r) => (
            <Checkbox key={`${r.source}:${r.id}`} label={`${r.fullName} (${ACCESS_CONNECTOR_LABELS[r.source]})`} checked={chosen(r)} disabled={!chosen(r) && value.length >= MAX_MISSION_REPOSITORIES} onChange={(_, d) => toggle(r, d.checked === true)} />
          ))}
        </>
      )}
    </div>
  );
}
