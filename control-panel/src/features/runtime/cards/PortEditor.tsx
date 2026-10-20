import { Caption1, Checkbox, Field, Input, Select, makeStyles, tokens } from "@fluentui/react-components";
import { PORT_FORMAT, PORT_KINDS, PORT_KIND_SAY, type PortDraft, isPortKind, portHintsOf, withKind } from "../portDraft";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  hint: { color: tokens.colorNeutralForeground3 },
});

// How a task's sandbox tells ONE component the port it leased it: by an argument (`--port 61234`, with `--`
// before it for `npm run <script>`), by an environment variable (`PORT=61234`), or not at all -- then the
// component keeps the port its own files declare. A person's word, never a command: only a flag or a
// variable NAME, and what it is told, `{port}` once.
export function PortEditor({ name, draft, onChange }: { name: string; draft: PortDraft; onChange: (next: PortDraft) => void }) {
  const styles = useStyles();
  const hints = portHintsOf(draft);
  return (
    <div className={styles.stack}>
      <Select aria-label={`Port of ${name}`} value={draft.kind} onChange={(_, d) => isPortKind(d.value) && onChange(withKind(draft, d.value))}>
        {PORT_KINDS.map((k) => <option key={k} value={k}>{PORT_KIND_SAY[k]}</option>)}
      </Select>
      {draft.kind === "argv" && <Field label="Flag" size="small"><Input aria-label={`Port flag for ${name}`} value={draft.flag} onChange={(_, d) => onChange({ ...draft, flag: d.value })} /></Field>}
      {draft.kind === "argv" && <Checkbox label="put -- before it (npm run)" aria-label={`Put -- before the port flag for ${name}`} checked={draft.dashes} onChange={(_, d) => onChange({ ...draft, dashes: d.checked === true })} />}
      {draft.kind === "env" && <Field label="Variable" size="small"><Input aria-label={`Port variable for ${name}`} value={draft.name} onChange={(_, d) => onChange({ ...draft, name: d.value })} /></Field>}
      {draft.kind !== "" && <Field label={`Value (leave ${PORT_FORMAT})`} size="small"><Input aria-label={`Port format for ${name}`} value={draft.format} onChange={(_, d) => onChange({ ...draft, format: d.value })} /></Field>}
      {hints.map((h) => <Caption1 key={h} className={styles.hint}>{h}</Caption1>)}
    </div>
  );
}
