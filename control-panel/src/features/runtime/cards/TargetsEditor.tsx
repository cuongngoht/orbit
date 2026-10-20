import { Button, Caption1, Checkbox, Field, Input, MessageBar, MessageBarBody, Subtitle2, Switch, makeStyles, tokens } from "@fluentui/react-components";
import { Add20Regular, Delete20Regular } from "@fluentui/react-icons";
import { type ConnectivityDraft, type RetryDraft, type TargetDraft, duplicateIds, newTarget, toggled } from "../connectivityDraft";
import type { Provider } from "../runtime.types";
import { PROVIDERS, PROVIDER_SAY } from "../runtimeWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  target: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, margin: 0, padding: tokens.spacingHorizontalM, border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, minWidth: 0 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: tokens.spacingHorizontalS },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: tokens.spacingHorizontalM, alignItems: "start" },
  checks: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS, alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// The bounds are the engine's (src/runtime/settings.mjs), said here so a person can type a number that
// will be kept; a number outside them is refused by the engine, in its words, when saved.
const RETRY_FIELDS: readonly { key: keyof RetryDraft; label: string; hint: string }[] = [
  { key: "attempts", label: "Attempts", hint: "1 to 10" },
  { key: "intervalMs", label: "Wait between attempts (ms)", hint: "250 to 30000" },
  { key: "timeoutMs", label: "Timeout per attempt (ms)", hint: "250 to 30000" },
];

/** Three numbers. With `under`, an empty one means "as the policy under it", and says which number that is. */
export function RetryFields({ draft, under, onChange }: { draft: RetryDraft; under?: RetryDraft; onChange: (next: RetryDraft) => void }) {
  return (
    <>
      {RETRY_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <Input inputMode="numeric" value={draft[f.key]} placeholder={under ? `as this machine's: ${under[f.key] || "the default"}` : "the default"} onChange={(_, d) => onChange({ ...draft, [f.key]: d.value })} />
        </Field>
      ))}
    </>
  );
}

// The servers a checkout needs and Orbit does not run: a host and a port, who needs it, from where to
// ask, and whether a start waits for it. Nothing else can be typed here -- no URL, no user, no
// password, no connection string and no command -- because a target is somewhere to knock, never a
// way in.
export function TargetsEditor({ draft, components, labels, onChange }: { draft: ConnectivityDraft; components: string[]; labels: Record<string, string>; onChange: (next: ConnectivityDraft) => void }) {
  const styles = useStyles();
  const twice = duplicateIds(draft);
  const put = (next: TargetDraft) => onChange({ ...draft, targets: draft.targets.map((t) => (t.row === next.row ? next : t)) });
  return (
    <div className={styles.stack}>
      {draft.targets.length === 0 && <Caption1 className={styles.muted}>No server this checkout needs is named for this machine.</Caption1>}
      {draft.targets.map((t) => <TargetFields key={t.row} target={t} components={components} labels={labels} policy={draft.retry} onChange={put} onRemove={() => onChange({ ...draft, targets: draft.targets.filter((x) => x.row !== t.row) })} />)}
      {twice.length > 0 && <MessageBar intent="warning"><MessageBarBody>Two targets are called {twice.join(", ")}: give each its own id, or one of them would be lost when saved.</MessageBarBody></MessageBar>}
      <div><Button icon={<Add20Regular />} onClick={() => onChange({ ...draft, targets: [...draft.targets, newTarget(draft.targets)] })}>Add a target</Button></div>
    </div>
  );
}

interface TargetProps {
  target: TargetDraft;
  components: string[];
  labels: Record<string, string>;
  policy: RetryDraft;
  onChange: (next: TargetDraft) => void;
  onRemove: () => void;
}

function TargetFields({ target, components, labels, policy, onChange, onRemove }: TargetProps) {
  const styles = useStyles();
  const name = target.id.trim() || "(no id yet)";
  return (
    <fieldset className={styles.target} aria-label={`Target ${name}`}>
      <div className={styles.head}>
        <Subtitle2 as="h3">{name}</Subtitle2>
        <Button size="small" icon={<Delete20Regular />} aria-label={`Remove target ${name}`} onClick={onRemove}>Remove</Button>
      </div>
      <Where target={target} onChange={onChange} />
      <Checks label="Required by" shown={[...new Set([...components, ...target.requiredBy])]} chosen={target.requiredBy} say={(k) => labels[k] ?? k} onChange={(requiredBy) => onChange({ ...target, requiredBy })} />
      <Checks<Provider> label="Check from" shown={PROVIDERS} chosen={target.checkFrom} say={(p) => PROVIDER_SAY[p]} onChange={(checkFrom) => onChange({ ...target, checkFrom })} />
      <Switch checked={target.beforeStart} label="Check it before starting what requires it" onChange={(_, d) => onChange({ ...target, beforeStart: d.checked })} />
      <div className={styles.form} role="group" aria-label={`Retry policy of ${name}`}>
        <RetryFields draft={target.retry} under={policy} onChange={(retry) => onChange({ ...target, retry })} />
      </div>
    </fieldset>
  );
}

// A saved target keeps its id: what it observed is kept under it. Renaming one is removing it and adding another.
function Where({ target, onChange }: { target: TargetDraft; onChange: (next: TargetDraft) => void }) {
  const styles = useStyles();
  return (
    <div className={styles.form}>
      {!target.saved && <Field label="Id" hint="lowercase letters, digits and -, starting with a letter"><Input value={target.id} onChange={(_, d) => onChange({ ...target, id: d.value })} /></Field>}
      <Field label="Label"><Input value={target.label} placeholder={target.id || "what a person calls it"} onChange={(_, d) => onChange({ ...target, label: d.value })} /></Field>
      <Field label="Host" hint="a name or an address: never a URL, a user name or a password"><Input value={target.host} placeholder="db.internal or 10.0.0.5" onChange={(_, d) => onChange({ ...target, host: d.value })} /></Field>
      <Field label="Port"><Input inputMode="numeric" value={target.port} placeholder="a port" onChange={(_, d) => onChange({ ...target, port: d.value })} /></Field>
      <Field label="Note"><Input value={target.note} onChange={(_, d) => onChange({ ...target, note: d.value })} /></Field>
    </div>
  );
}

interface ChecksProps<T extends string> {
  label: string;
  shown: readonly T[];
  chosen: readonly T[];
  say: (value: T) => string;
  onChange: (next: T[]) => void;
}

function Checks<T extends string>({ label, shown, chosen, say, onChange }: ChecksProps<T>) {
  const styles = useStyles();
  return (
    <div role="group" aria-label={label} className={styles.checks}>
      <Caption1>{label}:</Caption1>
      {shown.length === 0 && <Caption1 className={styles.muted}>no component is known yet</Caption1>}
      {shown.map((v) => <Checkbox key={v} label={say(v)} checked={chosen.includes(v)} onChange={(_, d) => onChange(toggled(shown, chosen, v, d.checked === true))} />)}
    </div>
  );
}
