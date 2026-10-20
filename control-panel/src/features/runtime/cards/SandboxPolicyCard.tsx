import { useState } from "react";
import { Button, Caption1, Checkbox, Field, Input, Select, Subtitle2, Switch, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { runtimeKeys, useSaveRuntimeSettings, useTrustOperation, type TrustAsk } from "../runtime.api";
import type { CheckoutRef, RuntimeSettings, Strategy } from "../runtime.types";
import { FINGERPRINT, PORT_MODES, PORT_SAY, QA_MODES, RESTORE_MODES, RESTORE_SAY, STRATEGIES, STRATEGY_SAY, isPortMode, isRestoreMode, isStrategy, shortFingerprint } from "../runtimeWords";
import type { PortMode, RestoreMode, SandboxPolicy, TrustKind } from "../sandbox.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  checks: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalM },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
});

// A policy as the form holds it: numbers are what was typed, so an empty field is "not a number yet" and is
// refused by the engine in its words, never replaced by a guess.
interface Draft {
  enabled: boolean;
  strategy: Strategy;
  active: string;
  portMode: PortMode;
  from: string;
  to: string;
  restore: RestoreMode;
  modes: string[];
  entry: string;
  deny: boolean;
}

const draftOf = (p: SandboxPolicy): Draft => ({ enabled: p.enabled, strategy: p.strategy, active: String(p.limits.active), portMode: p.ports.mode, from: String(p.ports.from), to: String(p.ports.to), restore: p.restore.mode, modes: p.qa.modes, entry: p.qa.entry ?? "", deny: p.network.denyProductionWrites });

// The fingerprints a person trusts, and the one browser kind this release has, are not the form's: they
// ride along exactly as they were read, so saving the form never grants a trust or takes one back.
const policyOf = (d: Draft, was: SandboxPolicy): SandboxPolicy => ({
  ...was,
  enabled: d.enabled,
  strategy: d.strategy,
  limits: { active: Number(d.active) },
  restore: { ...was.restore, mode: d.restore },
  ports: { mode: d.portMode, from: Number(d.from), to: Number(d.to) },
  qa: { ...was.qa, modes: d.modes, entry: d.entry.trim() === "" ? null : d.entry.trim() },
  network: { denyProductionWrites: d.deny },
});

// What a PERSON allows a task's sandbox in this checkout on this machine: whether tasks may have one, how
// many at once, which ports they may lease, whether a dependency restore may run, how QA may work there --
// and which restore plans and container definitions they trust. The policy is saved with the rest of the
// runtime settings, as a whole, against the revision this page read; trust is a standing word given by
// fingerprint, and Control's alone: no terminal, task or agent can give it.
export function SandboxPolicyCard({ at, settings }: { at: CheckoutRef; settings: RuntimeSettings }) {
  const styles = useStyles();
  const [saved, setSaved] = useState<string | null>(null);
  const trust = useTrustOperation(at, settings.revision);
  return (
    <Card title="Sandbox policy" subtitle="What a task's sandbox may do in this checkout on this machine. A sandbox never reuses your own running application, and Orbit controls no network.">
      <div className={styles.stack}>
        <Policy key={settings.revision ?? "new"} at={at} settings={settings} justSaved={saved !== null && saved === settings.revision} onSaved={setSaved} />
        <Trusted at={at} settings={settings} trust={trust} />
      </div>
    </Card>
  );
}

interface PolicyProps {
  at: CheckoutRef;
  settings: RuntimeSettings;
  justSaved: boolean;
  onSaved: (revision: string | null) => void;
}

function Policy({ at, settings, justSaved, onSaved }: PolicyProps) {
  const styles = useStyles();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(draftOf(settings.settings.sandbox));
  const save = useSaveRuntimeSettings(at, settings.revision, onSaved);
  const stale = save.error instanceof ApiError && save.error.code === "STALE_REVISION";
  const change = (next: Partial<Draft>) => setDraft({ ...draft, ...next });
  return (
    <div className={styles.stack}>
      <Switch checked={draft.enabled} label="Tasks of this checkout may have a sandbox" onChange={(_, d) => change({ enabled: d.checked })} />
      <div className={styles.form}>
        <Field label="Where a component runs" hint="Auto takes the first way that works here.">
          <Select value={draft.strategy} onChange={(_, d) => isStrategy(d.value) && change({ strategy: d.value })}>
            {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_SAY[s]}</option>)}
          </Select>
        </Field>
        <Field label="Sandboxes at once" hint="1 to 10">
          <Input inputMode="numeric" value={draft.active} onChange={(_, d) => change({ active: d.value })} />
        </Field>
        <Field label="Ports" hint="A leased port is free when it is handed out and held until the sandbox ends.">
          <Select value={draft.portMode} onChange={(_, d) => isPortMode(d.value) && change({ portMode: d.value })}>
            {PORT_MODES.map((m) => <option key={m} value={m}>{PORT_SAY[m]}</option>)}
          </Select>
        </Field>
        <Field label="Port range from" hint="1024 to 65535">
          <Input inputMode="numeric" value={draft.from} onChange={(_, d) => change({ from: d.value })} />
        </Field>
        <Field label="Port range to" hint="at most 2000 ports">
          <Input inputMode="numeric" value={draft.to} onChange={(_, d) => change({ to: d.value })} />
        </Field>
        <Field label="Restoring dependencies" hint="A restore runs a command the checkout's files declare, on this machine.">
          <Select value={draft.restore} onChange={(_, d) => isRestoreMode(d.value) && change({ restore: d.value })}>
            {RESTORE_MODES.map((m) => <option key={m} value={m}>{RESTORE_SAY[m]}</option>)}
          </Select>
        </Field>
      </div>
      <Qa draft={draft} onChange={change} />
      <div className={styles.actions}>
        <Button appearance="primary" disabled={!mutationToken() || save.isPending} onClick={() => save.mutate({ ...settings.settings, sandbox: policyOf(draft, settings.settings.sandbox) })}>{save.isPending ? "Saving…" : "Save sandbox policy"}</Button>
        {(save.isSuccess || justSaved) && <Caption1>Saved.</Caption1>}
      </div>
      {save.isError && <ErrorState error={save.error} title="The sandbox policy was not saved" />}
      {stale && (
        <div className={styles.actions}>
          <Caption1>Your changes are still here, but every save names the revision this page read, so it would be refused again.</Caption1>
          <Button onClick={() => client.invalidateQueries({ queryKey: runtimeKeys.all(at) })}>Load the latest settings</Button>
        </div>
      )}
    </div>
  );
}

// How an investigation may work in a sandbox is the person's: what is not ticked is not allowed there, and
// observing is the one mode that needs nothing more than the environment itself.
function Qa({ draft, onChange }: { draft: Draft; onChange: (next: Partial<Draft>) => void }) {
  const styles = useStyles();
  const toggle = (mode: string, on: boolean) => onChange({ modes: on ? [...draft.modes, mode] : draft.modes.filter((m) => m !== mode) });
  return (
    <div className={styles.stack}>
      <div className={styles.section} role="group" aria-label="QA modes allowed in a sandbox">
        <Subtitle2 as="h3">Autonomous QA in a sandbox</Subtitle2>
        <Caption1 className={styles.muted}>An investigation works in a sandbox only in the modes you tick, and only in the isolated browser: a blank session of its own, never your signed-in profile.</Caption1>
        <div className={styles.checks}>
          {QA_MODES.map((m) => <Checkbox key={m} label={m} checked={draft.modes.includes(m)} onChange={(_, d) => toggle(m, d.checked === true)} />)}
        </div>
      </div>
      <div className={styles.form}>
        <Field label="Component the browser opens" hint="Which endpoint, when a sandbox answers on more than one. Empty: the only one.">
          <Input value={draft.entry} onChange={(_, d) => onChange({ entry: d.value })} />
        </Field>
        <Field label="Browser" hint="A blank session of its own. Copying a profile is not in this release.">
          <Select value="isolated" disabled>
            <option value="isolated">Isolated, blank</option>
          </Select>
        </Field>
      </div>
      <Switch checked={draft.deny} label="Production writes are refused (reported to QA; Orbit controls no network)" onChange={(_, d) => onChange({ deny: d.checked })} />
    </div>
  );
}

interface TrustProps {
  at: CheckoutRef;
  settings: RuntimeSettings;
  trust: { mutate: (ask: TrustAsk, options?: { onSuccess?: () => void }) => void; isPending: boolean; isError: boolean; error: unknown };
}

// Two lists of fingerprints, each a standing word of a person's: a restore plan the runtime may run in a
// sandbox, and a container definition it may bring up. The fingerprint is read from what the agent's
// prepare-sandbox said it needs; it names ONE plan or definition, and a changed file is another
// fingerprint and needs its own word. Each change names the settings revision this page read.
function Trusted({ at, settings, trust }: TrustProps) {
  const styles = useStyles();
  const client = useQueryClient();
  const stale = trust.error instanceof ApiError && trust.error.code === "STALE_REVISION";
  const off = !mutationToken() || trust.isPending;
  return (
    <div className={styles.stack}>
      <Fingerprints kind="restore" title="Restore plans you trust" grant="Trust" said="Trust a restore plan by the fingerprint prepare-sandbox printed." held={settings.settings.sandbox.restore.trusted} off={off} trust={trust} />
      <Fingerprints kind="definition" title="Container definitions you approve" grant="Approve" said="Approve a dev container definition by its fingerprint. Bringing it up runs its own commands on this machine." held={settings.settings.sandbox.trustedDefinitions} off={off} trust={trust} />
      {trust.isError && <ErrorState error={trust.error} title="Nothing was changed" />}
      {stale && (
        <div className={styles.actions}>
          <Caption1>What you typed is still here, but every change names the revision this page read, so it would be refused again.</Caption1>
          <Button onClick={() => client.invalidateQueries({ queryKey: runtimeKeys.all(at) })}>Load the latest settings</Button>
        </div>
      )}
    </div>
  );
}

interface FingerprintsProps {
  kind: TrustKind;
  title: string;
  grant: string;
  said: string;
  held: string[];
  off: boolean;
  trust: TrustProps["trust"];
}

function Fingerprints({ kind, title, grant, said, held, off, trust }: FingerprintsProps) {
  const styles = useStyles();
  const [typed, setTyped] = useState("");
  const fingerprint = typed.trim();
  const give = () => trust.mutate({ operation: "trust", body: { kind, fingerprint } }, { onSuccess: () => setTyped("") });
  return (
    <div className={styles.section} role="group" aria-label={title}>
      <Subtitle2 as="h3">{title}</Subtitle2>
      <Caption1 className={styles.muted}>{said}</Caption1>
      {held.length === 0 ? (
        <Caption1 className={styles.muted}>{kind === "restore" ? "No restore plan is trusted: a sandbox that needs one waits for you." : "No container definition is approved: a sandbox that needs one waits for you."}</Caption1>
      ) : (
        <Table aria-label={title} size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Fingerprint</TableHeaderCell>
              <TableHeaderCell>Take it back</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {held.map((fp) => (
              <TableRow key={fp}>
                <TableCell><span className={styles.mono} title={fp}>{shortFingerprint(fp)}</span></TableCell>
                <TableCell><Button size="small" disabled={off} aria-label={`Revoke ${shortFingerprint(fp)}`} onClick={() => trust.mutate({ operation: "revoke", body: { kind, fingerprint: fp } })}>Revoke</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className={styles.actions}>
        <Field label={`Fingerprint to ${grant.toLowerCase()}`} hint="64 lowercase hexadecimal characters: the whole fingerprint">
          <Input aria-label={`Fingerprint to ${grant.toLowerCase()} (${kind})`} value={typed} onChange={(_, d) => setTyped(d.value)} />
        </Field>
        <Button disabled={off || !FINGERPRINT.test(fingerprint)} onClick={give}>{grant}</Button>
      </div>
    </div>
  );
}
