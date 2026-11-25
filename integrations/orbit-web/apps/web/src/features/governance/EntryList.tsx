// A LIST A POLICY KEEPS -- the hosts a department may name, the models it may choose -- as chips, each removable, with a
// field to add one more while it may change. What a person types is read by `entryOf` (null: it is not one); an entry is
// listed once.
import { Button, Field, Input, Text, makeStyles } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import { modelListErrors } from "@orbit-web/governance-core";
import { useState } from "react";
import { useI18n } from "../../i18n";
import { useParts } from "./parts";

const useStyles = makeStyles({
  entries: { display: "flex", flexWrap: "wrap", gap: "6px", listStyleType: "none", marginTop: 0, marginBottom: 0, paddingLeft: 0, minWidth: 0 },
  entry: { display: "inline-flex", alignItems: "center", gap: "2px", minWidth: 0, maxWidth: "100%" },
  add: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "end" },
});

// A model as a person types it, `<runtime>:<model>` (claude:sonnet), held to the policy's own rule for one; null when it
// is not one.
export function modelOf(text: string): string | null {
  const model = text.trim();
  return model !== "" && modelListErrors([model], "model").length === 0 ? model : null;
}

export function EntryList({
  label,
  entries,
  editable,
  onChange,
  entryOf,
  inputLabel,
  hint,
  invalid,
  empty,
}: {
  label: string;
  entries: readonly string[];
  editable: boolean;
  onChange: (next: string[]) => void;
  entryOf: (text: string) => string | null;
  inputLabel: string;
  hint: string;
  invalid: string;
  empty: string;
}) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const [text, setText] = useState("");
  const entry = entryOf(text);
  const wrong = text.trim() !== "" && entry === null;
  const add = () => {
    if (entry === null || entries.includes(entry)) return;
    onChange([...entries, entry]);
    setText("");
  };
  return (
    <>
      {entries.length === 0 ? (
        <Text size={200} className={p.muted}>
          {empty}
        </Text>
      ) : (
        <ul className={s.entries} aria-label={label}>
          {entries.map((e) => (
            <li key={e} className={s.entry}>
              <span className={p.codeChip}>{e}</span>
              {editable && <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={t("governance.entries.remove", { entry: e })} onClick={() => onChange(entries.filter((x) => x !== e))} />}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className={s.add}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label={inputLabel} hint={hint} validationState={wrong ? "error" : "none"} validationMessage={wrong ? invalid : undefined}>
            <Input value={text} onChange={(_, d) => setText(d.value)} />
          </Field>
          <Button type="submit" disabled={entry === null || entries.includes(entry)}>
            {t("governance.entries.add")}
          </Button>
        </form>
      )}
    </>
  );
}
