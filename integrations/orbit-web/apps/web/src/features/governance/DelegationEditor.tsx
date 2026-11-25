// DELEGATION TO DEPARTMENTS, a part of the company's policy document (`delegation.departments`; governance-core
// constitution.ts and department.ts): what each department may decide for its own employees' work, and how far -- for an
// action, the loosest answer it may give; for its employees' network access, the loosest mode it may choose, the hosts it
// may name and the highest limits it may set; the models it may choose among. What is not delegated a department may only
// narrow. A department's policy decides its employees' assignments alone: never a chat, a research question or a person.
// Edited in a draft like the rest of the policy and published through the same review; nothing else of the document
// changes here.
import { Button, Checkbox, Field, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import {
  ACTION_KINDS,
  ACTIONS,
  COMPANY_ONLY_LIMITS,
  EFFECTS,
  networkHostOf,
  type AccountPolicy,
  type ActionKind,
  type DepartmentDelegation,
  type Effect,
  type NetworkDelegation,
  type NetworkLimits,
} from "@orbit-web/governance-core";
import { useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { LIMITS, LimitField } from "./EmployeeNetwork";
import { EntryList, modelOf } from "./EntryList";
import { Card, CleanSelect, Word, put, useParts } from "./parts";

const CAP_KEYS: Record<Effect, MessageKey> = {
  allow: "governance.delegation.cap.allow",
  require_approval: "governance.delegation.cap.require_approval",
  deny: "governance.delegation.cap.deny",
};

const MODE_CAP_KEYS: Record<NetworkDelegation["mode"] | "none", MessageKey> = {
  none: "governance.delegation.mode.none",
  RESTRICTED: "governance.delegation.mode.RESTRICTED",
  AUTONOMOUS: "governance.delegation.mode.AUTONOMOUS",
};

// The limits a department may set: the account-wide daily download is the company's alone.
const DELEGATED_LIMITS = LIMITS.filter((l) => !COMPANY_ONLY_LIMITS.includes(l.key));

const useStyles = makeStyles({
  section: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 },
  dividerSection: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minWidth: 0,
    paddingTop: "14px",
    ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2),
  },
  rows: { display: "flex", flexDirection: "column", listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "8px",
    paddingBottom: "8px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  action: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1, flexBasis: "240px" },
  id: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  capSelect: { minWidth: "180px" },
  add: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "end", maxWidth: "560px" },
  control: { width: "100%", minWidth: 0 },
  limits: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: "10px", alignItems: "start" },
});

// The delegation a policy says (nothing said: nothing delegated).
export const delegationOf = (document: AccountPolicy): DepartmentDelegation => document.delegation?.departments ?? {};

// What is said of a delegation, without what says nothing: null when nothing is delegated at all.
function said(d: DepartmentDelegation): DepartmentDelegation | null {
  const tidy = put(d, "actions", d.actions !== undefined && Object.keys(d.actions).length > 0 ? d.actions : undefined);
  return Object.values(tidy).some((v) => v !== undefined) ? tidy : null;
}

// The policy with its delegation as the editor says it -- everything else as it was, and no delegation said at all when
// nothing is delegated.
export function withDelegation(document: AccountPolicy, departments: DepartmentDelegation): AccountPolicy {
  const next = said(departments);
  return put(document, "delegation", next === null ? undefined : { departments: next });
}

const neverAnEmployees = (action: ActionKind): boolean => (ACTIONS[action].ceiling as Partial<Record<string, Effect>>).agent === "deny";

function ActionCaps({ value, editable, onChange }: { value: Partial<Record<ActionKind, Effect>>; editable: boolean; onChange: (next: Partial<Record<ActionKind, Effect>>) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const delegated = ACTION_KINDS.filter((a) => value[a] !== undefined);
  const others = ACTION_KINDS.filter((a) => value[a] === undefined);
  const [adding, setAdding] = useState<string>("");
  const choice = others.find((a) => a === adding) ?? others[0];
  const caps = EFFECTS.map((e) => ({ value: e, label: t(CAP_KEYS[e]) }));
  return (
    <div className={s.section}>
      <Text weight="semibold">{t("governance.delegation.actionsTitle")}</Text>
      <Text size={200} className={p.muted}>
        {t("governance.delegation.actionsDesc")}
      </Text>
      {delegated.length === 0 ? (
        <Text size={200} className={p.muted}>
          {t("governance.delegation.nothingDelegated")}
        </Text>
      ) : (
        <ul className={s.rows} aria-label={t("governance.delegation.actionsTitle")}>
          {delegated.map((a) => (
            <li key={a} className={s.row}>
              <div className={s.action}>
                <Text>{ACTIONS[a].summary}</Text>
                <span className={s.id}>{a}</span>
                {neverAnEmployees(a) && (
                  <Text size={200} className={p.muted}>
                    {t("governance.delegation.neverEmployees")}
                  </Text>
                )}
              </div>
              {editable ? (
                <div className={p.row}>
                  <CleanSelect className={s.capSelect} ariaLabel={t("governance.delegation.capAria", { action: a })} value={value[a] ?? "deny"} options={caps} onChange={(v) => onChange({ ...value, [a]: v as Effect })} />
                  <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={t("governance.delegation.stopAria", { action: a })} onClick={() => onChange(put(value, a, undefined))} />
                </div>
              ) : (
                <Word value={value[a] ?? "deny"} label={t(CAP_KEYS[value[a] ?? "deny"])} />
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && choice !== undefined && (
        <div className={s.add}>
          <Field label={t("governance.delegation.addLabel")}>
            {(fp) => <CleanSelect className={s.control} fieldProps={fp} value={choice} onChange={setAdding} options={others.map((a) => ({ value: a, label: a }))} />}
          </Field>
          <Button onClick={() => onChange({ ...value, [choice]: "allow" })}>{t("governance.delegation.delegate")}</Button>
        </div>
      )}
    </div>
  );
}

function NetworkCap({ value, editable, onChange }: { value: NetworkDelegation | undefined; editable: boolean; onChange: (next: NetworkDelegation | undefined) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const modes = (["none", "RESTRICTED", "AUTONOMOUS"] as const).map((m) => ({ value: m, label: t(MODE_CAP_KEYS[m]) }));
  const setLimit = (key: keyof NetworkLimits, v: number | undefined) => {
    if (value === undefined) return;
    const limits = put({ ...(value.limits ?? {}) }, key, v);
    onChange(put(value, "limits", Object.keys(limits).length > 0 ? limits : undefined));
  };
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">{t("governance.delegation.networkTitle")}</Text>
      <Field label={t("governance.delegation.modeLabel")}>
        {(fp) => (
          <CleanSelect
            className={s.control}
            fieldProps={fp}
            value={value?.mode ?? "none"}
            disabled={!editable}
            options={modes}
            onChange={(m) => onChange(m === "RESTRICTED" || m === "AUTONOMOUS" ? { ...(value ?? {}), mode: m } : undefined)}
          />
        )}
      </Field>
      {value !== undefined && (
        <>
          <Checkbox
            checked={value.allowWithin === undefined}
            disabled={!editable}
            label={t("governance.delegation.anyHost")}
            onChange={(_, d) => onChange(put(value, "allowWithin", d.checked === true ? undefined : []))}
          />
          {value.allowWithin !== undefined && (
            <div className={p.inset}>
              <EntryList
                label={t("governance.delegation.hostsLabel")}
                entries={value.allowWithin}
                editable={editable}
                onChange={(allowWithin) => onChange({ ...value, allowWithin })}
                entryOf={networkHostOf}
                inputLabel={t("governance.network.hostInputLabel")}
                hint={t("governance.network.hostInputHint")}
                invalid={t("governance.network.hostInputInvalid")}
                empty={t("governance.delegation.noHosts")}
              />
            </div>
          )}
          <Text size={300} weight="semibold">
            {t("governance.delegation.limitsTitle")}
          </Text>
          <div className={s.limits}>
            {DELEGATED_LIMITS.map((l) => (
              <LimitField key={l.key} spec={l} value={value.limits?.[l.key]} editable={editable} hint={t("governance.delegation.limitHint")} onChange={(v) => setLimit(l.key, v)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ModelsCap({ value, editable, onChange }: { value: string[] | undefined; editable: boolean; onChange: (next: string[] | undefined) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">{t("governance.delegation.modelsTitle")}</Text>
      <Checkbox checked={value === undefined} disabled={!editable} label={t("governance.delegation.anyModel")} onChange={(_, d) => onChange(d.checked === true ? undefined : [])} />
      {value !== undefined && (
        <div className={p.inset}>
          <EntryList
            label={t("governance.delegation.modelsLabel")}
            entries={value}
            editable={editable}
            onChange={onChange}
            entryOf={modelOf}
            inputLabel={t("governance.models.inputLabel")}
            hint={t("governance.models.inputHint")}
            invalid={t("governance.models.inputInvalid")}
            empty={t("governance.delegation.noModels")}
          />
        </div>
      )}
    </div>
  );
}

export function DelegationEditor({ value, editable, onChange }: { value: DepartmentDelegation; editable: boolean; onChange: (next: DepartmentDelegation) => void }) {
  const { t } = useI18n();
  return (
    <Card className="orbit-touch" label={t("governance.delegation.title")} title={t("governance.delegation.title")} description={t("governance.delegation.description")}>
      <ActionCaps value={value.actions ?? {}} editable={editable} onChange={(actions) => onChange(put(value, "actions", actions))} />
      <NetworkCap value={value.employeeNetwork} editable={editable} onChange={(employeeNetwork) => onChange(put(value, "employeeNetwork", employeeNetwork))} />
      <ModelsCap value={value.models?.allow} editable={editable} onChange={(allow) => onChange(put(value, "models", allow === undefined ? undefined : { allow }))} />
    </Card>
  );
}
