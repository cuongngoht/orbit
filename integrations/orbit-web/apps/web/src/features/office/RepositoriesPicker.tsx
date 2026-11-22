// REPOSITORIES FOR A MISSION: the ones its employee may use on the account's connectors (its Access tab) -- the
// repositories chosen there, or, when it may use every one, the ones the connector lists. Each one checked is brought
// into every attempt as a snapshot of its default branch (a git bundle in /input the employee clones); Orbit Web clones
// it with the connector's sign-in, which never reaches the employee.
import { Checkbox, Input, Link, Spinner, Text } from "@fluentui/react-components";
import { ACCESS_CONNECTOR_LABELS, MAX_MISSION_REPOSITORIES, type AccessConnector, type EmployeeAccess, type MissionRepositoryRequest, type RepositoryList } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { get } from "../../services/api";
import { useOfficeStyles } from "./parts";

interface Offered {
  source: AccessConnector;
  id: string;
  fullName: string;
}

// What one connector offers: the repositories granted, or (every one) the ones it lists now.
function useOffered(access: EmployeeAccess | null): { offered: Offered[]; reading: boolean; error: string | null } {
  const every = (c: AccessConnector) => access?.connectors.some((x) => x.connector === c && x.enabled && x.repositories === null) === true;
  const github = useResource<RepositoryList>(every("github") ? () => get("/api/repositories?source=github") : null, [every("github")]);
  const azure = useResource<RepositoryList>(every("azure") ? () => get("/api/repositories?source=azure") : null, [every("azure")]);
  const listed: Record<AccessConnector, RepositoryList | null> = { github: github.data, azure: azure.data };
  const offered = (access?.connectors ?? [])
    .filter((c) => c.enabled)
    .flatMap((c) => (c.repositories ?? listed[c.connector]?.repositories ?? []).map((r) => ({ source: c.connector, id: r.id, fullName: r.fullName })));
  return { offered, reading: (every("github") && github.data === null && github.error === null) || (every("azure") && azure.data === null && azure.error === null), error: github.error ?? azure.error };
}

export function RepositoriesPicker({ employeeId, employeeName, value, onChange }: { employeeId: string; employeeName: string; value: MissionRepositoryRequest[]; onChange: (v: MissionRepositoryRequest[]) => void }) {
  const o = useOfficeStyles();
  const access = useResource<EmployeeAccess>(employeeId === "" ? null : () => get(`/api/employees/${employeeId}/access`), [employeeId]);
  const { offered, reading, error } = useOffered(access.data);
  const [filter, setFilter] = useState("");
  const chosen = (r: Offered) => value.some((v) => v.source === r.source && v.id === r.id);
  const toggle = (r: Offered, on: boolean) => onChange(on ? [...value, { source: r.source, id: r.id, branch: null }] : value.filter((v) => !(v.source === r.source && v.id === r.id)));
  const shown = offered.filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));
  const accessLink = (
    <Link href={`#/office/employee/${employeeId}/access`} inline>
      its Access page
    </Link>
  );
  return (
    <div role="group" aria-label="Repositories" className={o.stack}>
      <Text weight="semibold" size={300}>
        Repositories
      </Text>
      <Text size={200} className={o.muted}>
        Optional, at most {MAX_MISSION_REPOSITORIES}. Each one checked comes into the work as a snapshot of its default branch, a git bundle the employee clones; Orbit Web brings it in with the connector's sign-in, which never reaches the employee.
      </Text>
      {access.data === null ? (
        access.error !== null ? null : <Spinner size="tiny" label="Reading what the employee may use…" />
      ) : offered.length === 0 && !reading ? (
        <Text size={200} className={o.muted}>
          {employeeName || "This employee"} may use no repository: let it on {accessLink}.
        </Text>
      ) : (
        <>
          {offered.length > 8 && <Input size="small" placeholder="Filter the repositories" value={filter} onChange={(_, d) => setFilter(d.value)} aria-label="Filter the repositories" />}
          {reading && <Spinner size="tiny" label="Reading the repositories…" />}
          {error !== null && <Text size={200}>The repositories could not be read: {error}</Text>}
          {shown.map((r) => (
            <Checkbox key={`${r.source}:${r.id}`} label={`${r.fullName} (${ACCESS_CONNECTOR_LABELS[r.source]})`} checked={chosen(r)} disabled={!chosen(r) && value.length >= MAX_MISSION_REPOSITORIES} onChange={(_, d) => toggle(r, d.checked === true)} />
          ))}
        </>
      )}
    </div>
  );
}
