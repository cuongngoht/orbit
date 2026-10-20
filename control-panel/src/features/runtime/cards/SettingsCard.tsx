import { useState } from "react";
import { Button, Caption1, Field, Input, Select, Subtitle2, Switch, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { type ConnectivityDraft, connectivityDraftOf, connectivityOf, duplicateIds } from "../connectivityDraft";
import { NO_PORT, type PortDraft, portDraftOf, portOf } from "../portDraft";
import { runtimeKeys, useSaveRuntimeSettings } from "../runtime.api";
import type { CheckoutRef, ComponentRef, ComponentSetting, ProbeKind, Provider, RuntimeSettings, SettingsBlock, Strategy } from "../runtime.types";
import { PROVIDERS, PROVIDER_SAY, STRATEGIES, STRATEGY_SAY, isStrategy } from "../runtimeWords";
import type { SandboxPolicy } from "../sandbox.types";
import { PortEditor } from "./PortEditor";
import { RetryFields, TargetsEditor } from "./TargetsEditor";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  key: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere", color: tokens.colorNeutralForeground3 },
});

// What a person reads for each component: its name -- or its key, where two share a name. A key a
// setting names that is no component any more is shown as the key it is.
function labelsOf(refs: ComponentRef[], keys: string[]): Record<string, string> {
  const count = (name: string) => refs.filter((r) => r.name === name).length;
  return Object.fromEntries(keys.map((k) => [k, refs.find((r) => r.key === k && count(r.name) === 1)?.name ?? k]));
}

// A component's setting as the form holds it: every field a string, so an empty one means "not set".
interface ComponentDraft {
  provider: "" | Provider;
  probe: "" | ProbeKind;
  target: string;
  expect: string;
  env: string;
  /** Kept as it was: the form does not edit it, and must not lose it. */
  command?: string;
  /** How a task's sandbox tells it the port it leased: none, an argument or an environment variable. */
  port: PortDraft;
}

const EMPTY: ComponentDraft = { provider: "", probe: "", target: "", expect: "", env: "", port: NO_PORT };

const isPlacement = (v: string): v is "" | Provider => v === "" || PROVIDERS.some((p) => p === v);
const isProbe = (v: string): v is "" | ProbeKind => v === "" || v === "http" || v === "tcp";

const draftOf = (s: ComponentSetting | undefined): ComponentDraft => ({ provider: s?.provider ?? "", probe: s?.readiness?.kind ?? "", target: s?.readiness ? String(s.readiness.target) : "", expect: s?.readiness?.expect ? String(s.readiness.expect) : "", env: (s?.env ?? []).join(", "), ...(s?.command ? { command: s.command } : {}), port: portDraftOf(s?.port) });

// "Not told" is no `port` at all: the engine reads a `port` with no override as a mistake, never as none.
function settingOf(d: ComponentDraft): ComponentSetting | null {
  const env = d.env.split(",").map((n) => n.trim()).filter(Boolean);
  const readiness = d.probe ? { kind: d.probe, target: d.probe === "tcp" ? Number(d.target) : d.target.trim(), ...(d.probe === "http" && d.expect.trim() ? { expect: Number(d.expect) } : {}) } : undefined;
  const port = portOf(d.port);
  const set: ComponentSetting = { ...(d.provider ? { provider: d.provider } : {}), ...(d.command ? { command: d.command } : {}), ...(port ? { port } : {}), ...(env.length ? { env } : {}), ...(readiness ? { readiness } : {}) };
  return Object.keys(set).length ? set : null;
}

// The sandbox policy is not this form's: it goes back exactly as it was read, or a save here would erase it.
function blockOf(strategy: Strategy, reuseExternal: boolean, drafts: Record<string, ComponentDraft>, connectivity: ConnectivityDraft, sandbox: SandboxPolicy): SettingsBlock {
  const components = Object.fromEntries(Object.entries(drafts).flatMap(([key, d]) => {
    const set = settingOf(d);
    return set ? [[key, set]] : [];
  }));
  return { strategy, reuseExternal, components, connectivity: connectivityOf(connectivity), sandbox };
}

// What a PERSON chooses for this checkout on this machine: how to choose among the ways of running
// that WORK, and how to tell a component is ready. Never a command, never a secret -- an
// environment variable is named and read when a process starts -- and never a way to force
// something that does not work: there is no such setting. Saved against the revision it was read.
//
// `components` are the ones that can be STARTED: a library or a test project has no placement, no
// readiness and nothing that needs a server -- only one a setting already names is listed beside them.
export function SettingsCard({ at, settings, components }: { at: CheckoutRef; settings: RuntimeSettings; components: ComponentRef[] }) {
  const [saved, setSaved] = useState<string | null>(null);
  return <Configured key={settings.revision ?? "new"} at={at} settings={settings} components={components} justSaved={saved !== null && saved === settings.revision} onSaved={setSaved} />;
}

interface ConfiguredProps {
  at: CheckoutRef;
  settings: RuntimeSettings;
  components: ComponentRef[];
  justSaved: boolean;
  onSaved: (revision: string | null) => void;
}

function Configured({ at, settings, components, justSaved, onSaved }: ConfiguredProps) {
  const styles = useStyles();
  const keys = [...new Set([...components.map((c) => c.key), ...Object.keys(settings.settings.components)])];
  const labels = labelsOf(components, [...new Set([...keys, ...Object.values(settings.settings.connectivity.targets).flatMap((t) => t.requiredBy)])]);
  const [strategy, setStrategy] = useState<Strategy>(settings.settings.strategy);
  const [reuse, setReuse] = useState(settings.settings.reuseExternal);
  const [drafts, setDrafts] = useState<Record<string, ComponentDraft>>(Object.fromEntries(keys.map((k) => [k, draftOf(settings.settings.components[k])])));
  const [connectivity, setConnectivity] = useState<ConnectivityDraft>(connectivityDraftOf(settings.settings.connectivity));
  const save = useSaveRuntimeSettings(at, settings.revision, onSaved);
  const client = useQueryClient();
  const stale = save.error instanceof ApiError && save.error.code === "STALE_REVISION";
  const change = (key: string, next: ComponentDraft) => setDrafts({ ...drafts, [key]: next });
  const ambiguous = duplicateIds(connectivity).length > 0;
  return (
    <Card title="Settings for this machine" subtitle="Your choices for this checkout here. They choose among the ways that work and never make one work that does not.">
      <div className={styles.stack}>
        <div className={styles.form}>
          <Field label="How to run it" hint="Auto takes the first way that works here. A component can be placed on its own below.">
            <Select value={strategy} onChange={(_, d) => isStrategy(d.value) && setStrategy(d.value)}>
              {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_SAY[s]}</option>)}
            </Select>
          </Field>
          <Reuse reuse={reuse} onChange={setReuse} />
        </div>
        {keys.length > 0 && <Components keys={keys} labels={labels} drafts={drafts} onChange={change} />}
        <Connectivity draft={connectivity} components={keys} labels={labels} onChange={setConnectivity} />
        {settings.others.length > 0 && <Caption1 className={styles.muted}>Other machines keep settings for this checkout too ({settings.others.join(", ")}). They are advice, and are not applied here.</Caption1>}
        <div className={styles.actions}>
          <Button appearance="primary" disabled={!mutationToken() || save.isPending || ambiguous} onClick={() => save.mutate(blockOf(strategy, reuse, drafts, connectivity, settings.settings.sandbox))}>{save.isPending ? "Saving…" : "Save settings"}</Button>
          {(save.isSuccess || justSaved) && <Caption1>Saved.</Caption1>}
        </div>
        {save.isError && <ErrorState error={save.error} title="The settings were not saved" />}
        {stale && (
          <div className={styles.actions}>
            <Caption1>Your changes are still here, but every save names the revision this page read, so it would be refused again.</Caption1>
            <Button onClick={() => client.invalidateQueries({ queryKey: runtimeKeys.all(at) })}>Load the latest settings</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// Reusing is never taking: a server somebody else started is used only when the readiness a person
// set for the component answers, and nothing Orbit does ever stops it.
function Reuse({ reuse, onChange }: { reuse: boolean; onChange: (next: boolean) => void }) {
  const styles = useStyles();
  return (
    <div className={styles.section}>
      <Switch checked={reuse} label="Reuse a compatible server already running on this host" onChange={(_, d) => onChange(d.checked)} />
      <Caption1 className={styles.muted}>Orbit reuses it only when expected readiness can be established. Orbit never stops an external server.</Caption1>
    </div>
  );
}

function Connectivity({ draft, components, labels, onChange }: { draft: ConnectivityDraft; components: string[]; labels: Record<string, string>; onChange: (next: ConnectivityDraft) => void }) {
  const styles = useStyles();
  return (
    <>
      <div className={styles.section}>
        <Subtitle2 as="h3">Servers this checkout needs</Subtitle2>
        <Caption1 className={styles.muted}>A host and a port Orbit does not run, and where to check it from: this machine and the dev container are two networks, and each is asked on its own. Reachable means a connection was accepted, never a login, and Orbit controls no VPN.</Caption1>
      </div>
      <TargetsEditor draft={draft} components={components} labels={labels} onChange={onChange} />
      <div className={styles.section}>
        <Subtitle2 as="h3">Retry policy</Subtitle2>
        <Caption1 className={styles.muted}>How hard Retry and a before-start check try. Check once is always one attempt, and nothing retries on its own.</Caption1>
      </div>
      <div className={styles.form} role="group" aria-label="Retry policy">
        <RetryFields draft={draft.retry} onChange={(retry) => onChange({ ...draft, retry })} />
      </div>
    </>
  );
}

function Components({ keys, labels, drafts, onChange }: { keys: string[]; labels: Record<string, string>; drafts: Record<string, ComponentDraft>; onChange: (key: string, next: ComponentDraft) => void }) {
  return (
    <Table aria-label="Component settings" size="small">
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Component</TableHeaderCell>
          <TableHeaderCell>Placement</TableHeaderCell>
          <TableHeaderCell>Ready when</TableHeaderCell>
          <TableHeaderCell>Environment variable names</TableHeaderCell>
          <TableHeaderCell>Port in a sandbox</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => <ComponentRow key={key} name={key} label={labels[key] ?? key} draft={drafts[key] ?? EMPTY} onChange={(next) => onChange(key, next)} />)}
      </TableBody>
    </Table>
  );
}

function ComponentRow({ name, label, draft, onChange }: { name: string; label: string; draft: ComponentDraft; onChange: (next: ComponentDraft) => void }) {
  const styles = useStyles();
  return (
    <TableRow>
      <TableCell>
        <div>{label}</div>
        {label !== name && <Caption1 className={styles.key}>{name}</Caption1>}
      </TableCell>
      <TableCell>
        <Select aria-label={`Placement of ${name}`} value={draft.provider} onChange={(_, d) => isPlacement(d.value) && onChange({ ...draft, provider: d.value })}>
          <option value="">as chosen above</option>
          {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_SAY[p]}</option>)}
        </Select>
      </TableCell>
      <TableCell>
        <div className={styles.form}>
          <Select aria-label={`Readiness probe for ${name}`} value={draft.probe} onChange={(_, d) => isProbe(d.value) && onChange({ ...draft, probe: d.value })}>
            <option value="">nothing says</option>
            <option value="tcp">a port answers</option>
            <option value="http">a URL answers</option>
          </Select>
          {draft.probe && <Input aria-label={`Readiness target for ${name}`} placeholder={draft.probe === "tcp" ? "a port, e.g. 5173" : "http://localhost:5173/"} value={draft.target} onChange={(_, d) => onChange({ ...draft, target: d.value })} />}
          {draft.probe === "http" && <Input aria-label={`Expected status for ${name}`} placeholder="status, e.g. 200" value={draft.expect} onChange={(_, d) => onChange({ ...draft, expect: d.value })} />}
        </div>
      </TableCell>
      <TableCell>
        <Input aria-label={`Variable names for ${name}`} placeholder="NAME, NAME" value={draft.env} onChange={(_, d) => onChange({ ...draft, env: d.value })} />
      </TableCell>
      <TableCell>
        <PortEditor name={name} draft={draft.port} onChange={(port) => onChange({ ...draft, port })} />
      </TableCell>
    </TableRow>
  );
}
