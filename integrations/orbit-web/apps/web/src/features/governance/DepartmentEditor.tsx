// A DEPARTMENT'S DRAFT, edited as rows the way the company's policy is (governance-core table.ts
// `withDepartmentTable`): per action what the department says for its employees -- nothing (it inherits the company's
// answer) or an answer of its own, never looser than the company delegated, and for an action the company did not
// delegate only narrower -- and its employees' network access and models, each part inherited or its own. A rule the rows
// cannot show is kept as written. Every change goes back into the document the page saves; the API holds it to the
// company's delegation in effect when it is validated, and again when it is published. Runtime security (ADR 0063) is
// offered only upward: a mode above the company's, or a control the company does not already require.
import { Checkbox, Field, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import {
  ACTION_KINDS,
  ACTIONS,
  COMPANY_ONLY_LIMITS,
  EFFECTS,
  networkHostOf,
  RUNTIME_CONTROLS,
  RUNTIME_MODES,
  rankOf,
  runtimeModeRank,
  strictest,
  withDepartmentTable,
  type ActionKind,
  type DepartmentNetwork,
  type DepartmentPolicy,
  type DepartmentRow,
  type Effect,
  type NetworkLimits,
  type Rule,
  type RuntimeControlId,
  type RuntimeMode,
  type RuntimeSecurity,
} from "@orbit-web/governance-core";
import { useI18n, type MessageKey } from "../../i18n";
import { LIMITS, LimitField } from "./EmployeeNetwork";
import { EntryList, modelOf } from "./EntryList";
import { CleanSelect, Word, put, useParts } from "./parts";

type Answer = Effect | "inherit";

const ANSWER_KEYS: Record<Effect, MessageKey> = {
  allow: "governance.deptEditor.answer.allow",
  require_approval: "governance.deptEditor.answer.require_approval",
  deny: "governance.deptEditor.answer.deny",
};

// An answer as a sentence says it.
const SAID_KEYS: Record<Effect, MessageKey> = {
  allow: "governance.deptEditor.said.allow",
  require_approval: "governance.deptEditor.said.require_approval",
  deny: "governance.deptEditor.said.deny",
};

// Why a department cannot loosen an action for its employees, as a row of the company's and the department's says it.
export const LOCK_KEYS: Record<NonNullable<DepartmentRow["locked"]>, MessageKey> = {
  ceiling: "governance.deptPolicy.locked.ceiling",
  not_delegated: "governance.deptPolicy.locked.not_delegated",
  mandatory: "governance.deptPolicy.locked.mandatory",
};

// The limits a department may set: the account-wide daily download is the company's alone.
const OWN_LIMITS = LIMITS.filter((l) => !COMPANY_ONLY_LIMITS.includes(l.key));

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 },
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
  answer: { minWidth: "200px" },
  control: { width: "100%", minWidth: 0 },
  limits: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: "10px", alignItems: "start" },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

const plain = (r: Rule): boolean => r.resource === undefined && r.principalType === undefined && r.environment === undefined;

// What the department's own rules answer for an action, as its row reads them: the strictest of its plain rules; null
// when it says nothing (it inherits).
function answerOf(document: DepartmentPolicy, action: ActionKind): Effect | null {
  const said = document.rules.filter((r) => r.action === action && plain(r)).map((r) => r.effect);
  return said.length === 0 ? null : said.reduce(strictest);
}

// What a department may answer: within what the company delegated (`cap`), or -- not delegated -- only narrower, never
// allowed. What it already says stays offered, so a row never hides it (the API says why it may not stay).
function answersFor(cap: Effect | null, current: Effect | null): Answer[] {
  const within = (e: Effect): boolean => (cap === null ? e !== "allow" : rankOf(e) >= rankOf(cap));
  return ["inherit", ...EFFECTS.filter((e) => within(e) || e === current)];
}

const ceilingDenies = (action: ActionKind): boolean => (ACTIONS[action].ceiling as Partial<Record<string, Effect>>).agent === "deny";

function Rows({ document, rows, editable, onChange }: { document: DepartmentPolicy; rows: readonly DepartmentRow[]; editable: boolean; onChange: (next: DepartmentPolicy) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const byAction = new Map(rows.map((r) => [r.action, r]));
  return (
    <div className={s.section}>
      <Text weight="semibold">{t("governance.deptEditor.rowsTitle")}</Text>
      <Text size={200} className={p.muted}>
        {t("governance.deptEditor.rowsDesc")}
      </Text>
      <ul className={s.rows} aria-label={t("governance.deptEditor.rowsTitle")}>
        {ACTION_KINDS.map((action) => {
          const row = byAction.get(action);
          const cap = row?.cap ?? null;
          const locked = row?.locked ?? (ceilingDenies(action) ? "ceiling" : cap === null ? "not_delegated" : null);
          const own = answerOf(document, action);
          const inherit = row ? t("governance.deptEditor.answer.inheritAs", { answer: t(SAID_KEYS[row.company.effect]) }) : t("governance.deptEditor.answer.inherit");
          return (
            <li key={action} className={s.row}>
              <div className={s.action}>
                <Text>{ACTIONS[action].summary}</Text>
                <span className={s.id}>{action}</span>
                {locked !== null ? (
                  <Text size={200} className={p.muted}>
                    {t(LOCK_KEYS[locked])}
                  </Text>
                ) : (
                  <div className={p.row}>
                    <Text size={200} className={p.muted}>
                      {t("governance.deptEditor.delegatedUpTo")}
                    </Text>
                    {cap !== null && <Word value={cap} />}
                  </div>
                )}
              </div>
              <CleanSelect
                className={s.answer}
                ariaLabel={t("governance.deptEditor.answerAria", { action })}
                value={own ?? "inherit"}
                disabled={!editable || locked === "ceiling"}
                options={answersFor(cap, own).map((a) => ({ value: a, label: a === "inherit" ? inherit : t(ANSWER_KEYS[a]) }))}
                onChange={(v) => onChange(withDepartmentTable(document, [{ action, department: v === "inherit" ? null : (v as Effect) }]))}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The rules the rows do not show -- one naming a resource or an environment -- kept exactly as written.
function Kept({ rules }: { rules: readonly Rule[] }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  if (rules.length === 0) return null;
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">{t("governance.policyTable.keptTitle")}</Text>
      <Text size={200} className={p.muted}>
        {t("governance.policyTable.keptDesc")}
      </Text>
      <div className={p.inset}>
        <ul className={p.list} aria-label={t("governance.policyTable.keptTitle")}>
          {rules.map((r) => (
            <li key={r.id}>
              <Text size={200}>
                <span className={s.id}>{r.id}</span> · {r.action}
                {r.principalType ? t("governance.policyTable.keptFor", { who: t("governance.policy.principalPlural", { type: r.principalType }) }) : ""}
                {r.environment ? t("governance.policyTable.keptIn", { env: r.environment }) : ""}
                {r.resource ? t("governance.policyTable.keptOn", { resource: r.resource }) : ""} · <Word value={r.effect} />
              </Text>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// The department's own employee network access: each part unset inherits the company's.
function Network({ value, editable, onChange }: { value: DepartmentNetwork | undefined; editable: boolean; onChange: (next: DepartmentNetwork | undefined) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const current: DepartmentNetwork = value ?? {};
  const set = (next: DepartmentNetwork) => onChange(Object.values(next).some((v) => v !== undefined) ? next : undefined);
  const setLimit = (key: keyof NetworkLimits, v: number | undefined) => {
    const limits = put({ ...(current.limits ?? {}) }, key, v);
    set(put(current, "limits", Object.keys(limits).length > 0 ? limits : undefined));
  };
  const modes = [
    { value: "inherit", label: t("governance.deptEditor.inheritsYours") },
    { value: "RESTRICTED", label: t("governance.deptEditor.modeRestricted") },
    { value: "AUTONOMOUS", label: t("governance.deptEditor.modeAutonomous") },
  ];
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">{t("governance.network.title")}</Text>
      <Text size={200} className={p.muted}>
        {t("governance.deptEditor.networkDesc")}
      </Text>
      <Field label={t("governance.network.modeLabel")}>
        {(fp) => (
          <CleanSelect
            className={s.control}
            fieldProps={fp}
            value={current.mode ?? "inherit"}
            disabled={!editable}
            options={modes}
            onChange={(m) => set(put(current, "mode", m === "RESTRICTED" || m === "AUTONOMOUS" ? m : undefined))}
          />
        )}
      </Field>
      <Checkbox checked={current.allow !== undefined} disabled={!editable} label={t("governance.deptEditor.ownHosts")} onChange={(_, d) => set(put(current, "allow", d.checked === true ? [] : undefined))} />
      {current.allow !== undefined && (
        <div className={p.inset}>
          <EntryList
            label={t("governance.network.allowedHosts")}
            entries={current.allow}
            editable={editable}
            onChange={(allow) => set({ ...current, allow })}
            entryOf={networkHostOf}
            inputLabel={t("governance.network.hostInputLabel")}
            hint={t("governance.network.hostInputHint")}
            invalid={t("governance.network.hostInputInvalid")}
            empty={t("governance.network.noneRestricted")}
          />
        </div>
      )}
      <Text size={300} weight="semibold">
        {t("governance.network.limits")}
      </Text>
      <div className={s.limits}>
        {OWN_LIMITS.map((l) => (
          <LimitField key={l.key} spec={l} value={current.limits?.[l.key]} editable={editable} hint={t("governance.deptEditor.limitHint")} onChange={(v) => setLimit(l.key, v)} />
        ))}
      </div>
      {current.mode === "AUTONOMOUS" && (
        <Text size={200} weight="semibold" className={s.warn}>
          {t("office.shared.networkDisclosure")}
        </Text>
      )}
    </div>
  );
}

function Models({ value, editable, onChange }: { value: string[] | undefined; editable: boolean; onChange: (next: string[] | undefined) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">{t("governance.deptEditor.modelsTitle")}</Text>
      <Checkbox checked={value !== undefined} disabled={!editable} label={t("governance.deptEditor.ownModels")} onChange={(_, d) => onChange(d.checked === true ? [] : undefined)} />
      {value !== undefined && (
        <div className={p.inset}>
          <EntryList
            label={t("governance.deptEditor.modelsTitle")}
            entries={value}
            editable={editable}
            onChange={onChange}
            entryOf={modelOf}
            inputLabel={t("governance.models.inputLabel")}
            hint={t("governance.models.inputHint")}
            invalid={t("governance.models.inputInvalid")}
            empty={t("governance.deptEditor.noModels")}
          />
        </div>
      )}
    </div>
  );
}

// The department's own runtime security: a mode only above the company's (what it already says stays offered, so the
// select never hides it -- the API says why it may not stay), and a control only where the company does not require it.
function Runtime({ value, company, editable, onChange }: { value: DepartmentPolicy["runtimeSecurity"]; company: RuntimeSecurity; editable: boolean; onChange: (next: DepartmentPolicy["runtimeSecurity"]) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const current = value ?? {};
  const set = (next: NonNullable<DepartmentPolicy["runtimeSecurity"]>) => onChange(next.mode !== undefined || (next.controls !== undefined && next.controls.length > 0) ? next : undefined);
  const modes = RUNTIME_MODES.filter((m) => runtimeModeRank(m) > runtimeModeRank(company.mode) || m === current.mode);
  const own = (id: RuntimeControlId) => current.controls?.includes(id) === true;
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">{t("governance.deptEditor.runtimeTitle")}</Text>
      <Text size={200} className={p.muted}>
        {t("governance.deptEditor.runtimeDesc")}
      </Text>
      <CleanSelect
        className={s.control}
        ariaLabel={t("governance.deptEditor.runtimeAria")}
        value={current.mode ?? "inherit"}
        disabled={!editable}
        options={[{ value: "inherit", label: t("governance.deptEditor.runtimeInherit", { mode: company.mode }) }, ...modes.map((m) => ({ value: m, label: m }))]}
        onChange={(v) => set(put(current, "mode", v === "inherit" ? undefined : (v as RuntimeMode)))}
      />
      {Object.values(RUNTIME_CONTROLS).map((c) =>
        company.controls.includes(c.id) ? (
          <Checkbox key={c.id} checked disabled label={t("governance.deptEditor.runtimeRequired", { title: c.title })} />
        ) : (
          <Checkbox
            key={c.id}
            checked={own(c.id)}
            disabled={!editable}
            label={`${c.title} -- ${c.prevents}`}
            onChange={(_, d) => {
              const controls = d.checked === true ? [...(current.controls ?? []), c.id] : (current.controls ?? []).filter((x) => x !== c.id);
              set(put(current, "controls", controls.length > 0 ? controls : undefined));
            }}
          />
        ),
      )}
    </div>
  );
}

export function DepartmentEditor({ document, rows, runtime, editable, onChange }: { document: DepartmentPolicy; rows: readonly DepartmentRow[]; runtime: RuntimeSecurity | null; editable: boolean; onChange: (next: DepartmentPolicy) => void }) {
  const s = useStyles();
  return (
    <div className={mergeClasses(s.wrap, "orbit-touch")}>
      <Rows document={document} rows={rows} editable={editable} onChange={onChange} />
      <Kept rules={document.rules.filter((r) => !plain(r))} />
      <Network value={document.employeeNetwork} editable={editable} onChange={(next) => onChange(put(document, "employeeNetwork", next))} />
      <Models value={document.employeeModels?.allow} editable={editable} onChange={(allow) => onChange(put(document, "employeeModels", allow === undefined ? undefined : { allow }))} />
      {runtime !== null && <Runtime value={document.runtimeSecurity} company={runtime} editable={editable} onChange={(next) => onChange(put(document, "runtimeSecurity", next))} />}
    </div>
  );
}
