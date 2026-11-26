// REPOSITORIES FOR A MISSION: the ones its employee may use on the account's connectors (its Access tab) -- the
// repositories chosen there, or, when it may use every one, the ones the connector lists. Each one checked is brought
// into every attempt as a snapshot of its default branch (a git bundle in /input the employee clones); Orbit Web clones
// it with the connector's sign-in, which never reaches the employee.
import { Checkbox, Input, Link, Spinner, Text } from "@fluentui/react-components";
import { ACCESS_CONNECTOR_LABELS, MAX_MISSION_REPOSITORIES, type AccessConnector, type EmployeeAccess, type MissionRepositoryRequest, type RepositoryList, type SourcesStatus } from "@orbit-web/contracts";
import { useState, type RefObject } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { get } from "../../services/api";
import { useOfficeStyles } from "./parts";
import type { OfferedRepository } from "./repositoryMentions";

export interface MissionRepositoriesState {
  access: EmployeeAccess | null;
  sources: SourcesStatus | null;
  listed: Record<AccessConnector, RepositoryList | null>;
  offered: OfferedRepository[];
  loadingBase: boolean;
  failedBase: boolean;
  reading: boolean;
  error: string | null;
}

// Reads the repositories available to attach for this recipient (and connector status when delegating or when brief URLs
// need connector diagnostics), shared between AssignDialog's pre-assignment check and RepositoriesPicker.
export function useMissionRepositories(employeeId: string, delegating: boolean, needSources = false): MissionRepositoriesState {
  const access = useResource<EmployeeAccess>(!delegating && employeeId !== "" ? () => get(`/api/employees/${employeeId}/access`) : null, [delegating, employeeId]);
  const sources = useResource<SourcesStatus>(delegating || needSources ? () => get("/api/sources") : null, [delegating, needSources]);
  const connected = (c: AccessConnector) => sources.data?.sources.some((s) => s.source === c && s.state === "connected") === true;
  const every = (c: AccessConnector) => (delegating ? connected(c) : access.data?.connectors.some((x) => x.connector === c && x.enabled && x.repositories === null) === true);
  const github = useResource<RepositoryList>(every("github") ? () => get("/api/repositories?source=github") : null, [every("github")]);
  const azure = useResource<RepositoryList>(every("azure") ? () => get("/api/repositories?source=azure") : null, [every("azure")]);
  const listed: Record<AccessConnector, RepositoryList | null> = { github: github.data, azure: azure.data };
  const offered: OfferedRepository[] = delegating
    ? (["github", "azure"] as const).flatMap((c) => (connected(c) ? (listed[c]?.repositories ?? []).map((r) => ({ source: c, id: r.id, fullName: r.fullName })) : []))
    : (access.data?.connectors ?? [])
        .filter((c) => c.enabled)
        .flatMap((c) => (c.repositories ?? listed[c.connector]?.repositories ?? []).map((r) => ({ source: c.connector, id: r.id, fullName: r.fullName })));
  const loadingBase = delegating ? sources.data === null && sources.error === null : employeeId !== "" && access.data === null && access.error === null;
  const failedBase = delegating ? sources.data === null && sources.error !== null : employeeId !== "" && access.data === null && access.error !== null;
  const reading = (every("github") && github.data === null && github.error === null) || (every("azure") && azure.data === null && azure.error === null);
  return {
    access: access.data,
    sources: sources.data,
    listed,
    offered,
    loadingBase,
    failedBase,
    reading,
    error: github.error ?? azure.error,
  };
}

function RepositoriesPickerView({
  employeeId,
  employeeName,
  delegating,
  value,
  onChange,
  state,
  sectionRef,
}: {
  employeeId: string;
  employeeName: string;
  delegating: boolean;
  value: MissionRepositoryRequest[];
  onChange: (v: MissionRepositoryRequest[]) => void;
  state: MissionRepositoriesState;
  sectionRef?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [filter, setFilter] = useState("");
  const chosen = (r: OfferedRepository) => value.some((v) => v.source === r.source && v.id === r.id);
  const toggle = (r: OfferedRepository, on: boolean) => onChange(on ? [...value, { source: r.source, id: r.id, branch: null }] : value.filter((v) => !(v.source === r.source && v.id === r.id)));
  const shown = state.offered.filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));
  const accessLink = (
    <Link href={`#/office/employee/${employeeId}/access`} inline>
      {t("office.repos.accessLink")}
    </Link>
  );
  return (
    <div ref={sectionRef} tabIndex={-1} role="group" aria-label={t("office.repos.groupAria")} className={o.stack}>
      <Text weight="semibold" size={300}>
        {t("office.repos.title")}
      </Text>
      <Text size={200} className={o.muted}>
        {t(delegating ? "office.repos.delegatingHint" : "office.repos.hint", { max: MAX_MISSION_REPOSITORIES })}
      </Text>
      {state.loadingBase ? (
        <Spinner size="tiny" label={t("office.repos.readingAllowed")} />
      ) : state.failedBase ? null : state.offered.length === 0 && !state.reading ? (
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
          {state.offered.length > 8 && <Input size="small" placeholder={t("office.repos.filterPlaceholder")} value={filter} onChange={(_, d) => setFilter(d.value)} aria-label={t("office.repos.filterPlaceholder")} />}
          {state.reading && <Spinner size="tiny" label={t("office.repos.readingRepos")} />}
          {state.error !== null && <Text size={200}>{t("office.repos.readError", { error: state.error })}</Text>}
          {shown.map((r) => (
            <Checkbox key={`${r.source}:${r.id}`} label={`${r.fullName} (${ACCESS_CONNECTOR_LABELS[r.source]})`} checked={chosen(r)} disabled={!chosen(r) && value.length >= MAX_MISSION_REPOSITORIES} onChange={(_, d) => toggle(r, d.checked === true)} />
          ))}
          {delegating && value.length > 0 && (
            <Text size={200} className={o.muted}>
              {t("office.repos.delegatingAttachedNote", { name: employeeName || t("office.repos.thisEmployee") })}
            </Text>
          )}
        </>
      )}
    </div>
  );
}

function StandaloneRepositoriesPicker(p: {
  employeeId: string;
  employeeName: string;
  delegating: boolean;
  value: MissionRepositoryRequest[];
  onChange: (v: MissionRepositoryRequest[]) => void;
  sectionRef?: RefObject<HTMLDivElement | null>;
}) {
  const state = useMissionRepositories(p.employeeId, p.delegating, false);
  return <RepositoriesPickerView {...p} state={state} />;
}

export function RepositoriesPicker({
  employeeId,
  employeeName,
  delegating = false,
  value,
  onChange,
  state,
  sectionRef,
}: {
  employeeId: string;
  employeeName: string;
  delegating?: boolean;
  value: MissionRepositoryRequest[];
  onChange: (v: MissionRepositoryRequest[]) => void;
  state?: MissionRepositoriesState;
  sectionRef?: RefObject<HTMLDivElement | null>;
}) {
  if (state !== undefined) {
    return <RepositoriesPickerView employeeId={employeeId} employeeName={employeeName} delegating={delegating} value={value} onChange={onChange} state={state} sectionRef={sectionRef} />;
  }
  return <StandaloneRepositoriesPicker employeeId={employeeId} employeeName={employeeName} delegating={delegating} value={value} onChange={onChange} sectionRef={sectionRef} />;
}
