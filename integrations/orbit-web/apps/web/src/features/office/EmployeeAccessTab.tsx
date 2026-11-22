// ONE EMPLOYEE'S ACCESS TO THE ACCOUNT'S CONNECTORS: the GitHub and Azure DevOps sign-ins of Settings → Connectors, which
// Orbit Web uses on the employee's behalf -- reading only, and the sign-in never enters its sandbox. Each is off until a
// person turns it on, for every repository that sign-in reaches or only the ones chosen (an Azure DevOps project's work
// items and wiki come with a chosen repository's project).
import { Button, Checkbox, Input, Link, MessageBar, MessageBarBody, Radio, RadioGroup, Spinner, Switch, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ACCESS_CONNECTOR_LABELS, type ConnectorAccess, type EmployeeAccess, type EmployeeDetail, type RepositoryList, type SourcesStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { settingsHref } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px", minWidth: 0, maxWidth: "760px" },
  card: { display: "flex", flexDirection: "column", gap: "10px", paddingTop: "14px", paddingRight: "16px", paddingBottom: "14px", paddingLeft: "16px", borderRadius: "14px", ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2), minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { display: "flex", flexDirection: "column", gap: "2px", maxHeight: "260px", overflowY: "auto", paddingLeft: "4px" },
  row: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
});

// The access a card would save: every repository (null), or the ones chosen.
const scopeOf = (a: ConnectorAccess): string[] | null => (a.repositories === null ? null : a.repositories.map((r) => r.id));
const same = (a: string[] | null, b: string[] | null): boolean => (a === null || b === null ? a === b : a.length === b.length && a.every((x) => b.includes(x)));

function ConnectorCard({ employee, start, source }: { employee: EmployeeDetail; start: ConnectorAccess; source: { state: string; account: string | null } | undefined }) {
  const s = useStyles();
  const label = ACCESS_CONNECTOR_LABELS[start.connector];
  const signedIn = source?.state === "connected";
  const [saved, setSaved] = useState(start);
  const [enabled, setEnabled] = useState(start.enabled);
  const [every, setEvery] = useState(start.repositories === null);
  const [chosen, setChosen] = useState<string[]>(scopeOf(start) ?? []);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listing = useResource<RepositoryList>(enabled && !every && signedIn ? () => get(`/api/repositories?source=${start.connector}`) : null, [enabled, every, signedIn, start.connector]);
  const scope = enabled ? (every ? null : chosen) : null;
  const unchanged = enabled === saved.enabled && (!enabled || same(scope, scopeOf(saved)));
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaid(false);
    try {
      const next = await send<EmployeeAccess>("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: start.connector, enabled, repositories: scope }] });
      const mine = next.connectors.find((c) => c.connector === start.connector);
      if (mine) setSaved(mine);
      setSaid(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const repos = (listing.data?.repositories ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <section className={s.card} aria-label={label}>
      <div className={s.row}>
        <Text weight="semibold">{label}</Text>
        {signedIn ? (
          <Text size={200} className={s.muted}>
            signed in as {source?.account ?? "the installation's sign-in"}
          </Text>
        ) : (
          <Text size={200} className={s.muted}>
            Not connected: sign it in at <Link href={settingsHref("connectors")}>Settings → Connectors</Link>.
          </Text>
        )}
      </div>
      <Switch checked={enabled} disabled={!signedIn && !enabled} label={`Let ${employee.name} use ${label}`} onChange={(_, d) => setEnabled(d.checked)} />
      {enabled && (
        <RadioGroup value={every ? "every" : "chosen"} onChange={(_, d) => setEvery(d.value === "every")} aria-label={`What ${employee.name} may reach on ${label}`}>
          <Radio value="every" label="Every repository this sign-in reaches" />
          <Radio value="chosen" label="Only the repositories chosen" />
        </RadioGroup>
      )}
      {enabled && !every && (
        <>
          {(listing.data?.repositories.length ?? 0) > 8 && <Input size="small" placeholder="Filter the repositories" value={filter} onChange={(_, d) => setFilter(d.value)} aria-label="Filter the repositories" />}
          {listing.data === null ? (
            listing.error !== null ? <Text className={s.muted}>{listing.error}</Text> : <Spinner size="tiny" label="Reading the repositories…" />
          ) : (
            <div className={s.list}>
              {repos.length === 0 && <Text className={s.muted}>No repository here.</Text>}
              {repos.map((r) => (
                <Checkbox key={r.id} label={r.fullName} checked={chosen.includes(r.id)} onChange={(_, d) => setChosen((c) => (d.checked === true ? [...c, r.id] : c.filter((x) => x !== r.id)))} />
              ))}
            </div>
          )}
        </>
      )}
      <div className={s.row}>
        <Button appearance="primary" size="small" disabled={busy || unchanged || (enabled && !every && chosen.length === 0)} onClick={() => void save()}>
          Save
        </Button>
        {said && unchanged && (
          <Text size={200} className={s.muted}>
            Saved.
          </Text>
        )}
      </div>
      {error !== null && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  );
}

export function AccessTab({ e }: { e: EmployeeDetail }) {
  const s = useStyles();
  const access = useResource<EmployeeAccess>(() => get(`/api/employees/${e.id}/access`), [e.id]);
  const status = useResource<SourcesStatus>(() => get("/api/sources"), []);
  if (access.data === null || status.data === null) return <Text className={s.muted}>{access.error ?? status.error ?? "Reading…"}</Text>;
  return (
    <div className={s.root}>
      <Text className={s.muted}>
        What {e.name} may use of the account's connectors. Orbit Web reads on {e.name}'s behalf with that sign-in -- it never enters its sandbox -- and only reads: work items, wiki pages, issues, pull requests and files.
      </Text>
      {access.data.connectors.map((c) => (
        <ConnectorCard key={c.connector} employee={e} start={c} source={status.data?.sources.find((x) => x.source === c.connector)} />
      ))}
    </div>
  );
}
