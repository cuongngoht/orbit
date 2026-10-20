import { useMemo, useState } from "react";
import { Caption1, Combobox, Field, Option, OptionGroup, Tag, TagGroup, makeStyles, tokens } from "@fluentui/react-components";
import { FAMILY_NAMES, type EffectiveResources } from "../router/router.types";

const useStyles = makeStyles({
  tags: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS, marginTop: tokens.spacingVerticalXS },
  option: { display: "flex", flexDirection: "column" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// A capability a server can provide, and who in this plugin would use it.
export interface CapabilityOption {
  value: string;
  neededBy: { id: string; level: "required" | "optional" }[];
  providedBy: string[];
}

const WORD = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

// The words a server may say it provides, DERIVED from the registry: every
// capability a skill or agent needs or can use -- with who -- and every one
// something already provides. A CLI command (`command:<bin>`) is a tool's, not
// a server's. Nothing here maps a server to a skill: the server names a
// capability, and the resolver finds the skills that need it.
export function capabilityOptions(resources: EffectiveResources | undefined): CapabilityOption[] {
  if (!resources) return [];
  const needed = [...(resources.skills ?? []), ...(resources.agents ?? [])].flatMap((o) => [...o.routing.needs.map((value) => ({ value, id: o.id, level: "required" as const })), ...(o.routing.optional ?? []).map((value) => ({ value, id: o.id, level: "optional" as const }))]);
  const provided = FAMILY_NAMES.flatMap((family) => resources[family] ?? []).flatMap((r) => r.routing.provides.map((value) => ({ value, id: r.id })));
  const words = [...new Set([...needed, ...provided].map((n) => n.value))].filter((w) => !w.startsWith("command:")).sort();
  return words.map((value) => ({ value, neededBy: needed.filter((n) => n.value === value).map(({ id, level }) => ({ id, level })), providedBy: [...new Set(provided.filter((p) => p.value === value).map((p) => p.id))] }));
}

const neededLine = (o: CapabilityOption) => o.neededBy.map((n) => `${n.id} ${n.level === "required" ? "needs it" : "can use it"}`).join(" · ");

interface PickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
  options: CapabilityOption[];
}

// Fluent's multi-select Combobox: choose from the capabilities this plugin
// knows -- skills that need one are listed first, with their names -- or type
// a new one and add it. The choices show as tags, each removable.
export function CapabilityPicker({ selected, onChange, options }: PickerProps) {
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const typed = query.trim().toLowerCase();
  const shown = useMemo(() => options.filter((o) => !typed || o.value.includes(typed) || o.neededBy.some((n) => n.id.includes(typed))), [options, typed]);
  const addable = typed.length > 0 && WORD.test(typed) && !options.some((o) => o.value === typed) && !selected.includes(typed);
  return (
    <Field label="Capabilities provided" hint="What the resolver may match this server to. Skills name capabilities too — choosing one here is how this server comes to serve them.">
      <Combobox
        multiselect
        freeform
        placeholder={selected.length ? `${selected.length} chosen — add more` : "Choose or type a capability"}
        value={query}
        selectedOptions={selected}
        onChange={(e) => setQuery(e.target.value)}
        onOptionSelect={(_, d) => {
          onChange(d.selectedOptions.filter((v) => WORD.test(v)));
          setQuery("");
        }}
      >
        <OptionGroup label="Needed by skills and agents">
          {shown.filter((o) => o.neededBy.length).map((o) => (
            <Option key={o.value} value={o.value} text={o.value}>
              <span className={styles.option}>
                {o.value}
                <Caption1 className={styles.muted}>{neededLine(o)}</Caption1>
              </span>
            </Option>
          ))}
        </OptionGroup>
        <OptionGroup label="Other known capabilities">
          {shown.filter((o) => !o.neededBy.length).map((o) => (
            <Option key={o.value} value={o.value} text={o.value}>
              <span className={styles.option}>
                {o.value}
                {o.providedBy.length > 0 && <Caption1 className={styles.muted}>also provided by {o.providedBy.slice(0, 3).join(", ")}</Caption1>}
              </span>
            </Option>
          ))}
        </OptionGroup>
        {addable && (
          <Option value={typed} text={typed}>
            {`Add “${typed}”`}
          </Option>
        )}
      </Combobox>
      {selected.length > 0 && (
        <TagGroup className={styles.tags} aria-label="Chosen capabilities" onDismiss={(_, d) => onChange(selected.filter((s) => s !== d.value))}>
          {selected.map((s) => (
            <Tag key={s} value={s} size="small" dismissible dismissIcon={{ "aria-label": "remove" }}>
              {s}
            </Tag>
          ))}
        </TagGroup>
      )}
    </Field>
  );
}
