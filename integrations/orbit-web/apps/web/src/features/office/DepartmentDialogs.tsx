// A DEPARTMENT: made, renamed, or archived. Archiving one that has members asks where they go first -- another
// department, or Unassigned -- because the API refuses to leave anybody in an archived department.
//
// EXECUTION DEFAULTS, the company's or a department's: per runtime, the connection, model and effort an employee of that
// runtime runs on where its profile leaves the field to them -- its department's default, else the company's. A field
// "not set" is left to the next layer; a default of one runtime never applies to another (nothing switches an employee's
// provider). Saved whole, against the version read.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Link, MessageBar, MessageBarBody, Select, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { RUNTIME_KINDS, RUNTIME_LABELS, WORKFORCE_ERRORS, effortLabel, type Department, type ExecutionDefault, type ExecutionDefaults, type Office, type RuntimeConnection, type RuntimeKind } from "@orbit-web/contracts";
import { useState } from "react";
import { settingsHref } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { ApiError } from "../../services/api";
import { useConnections } from "../connections/AiConnectionsSection";
import { office } from "./api";
import { ProblemBar, problemOf, useOfficeStyles, type Problem } from "./parts";

export type DepartmentEdit = { kind: "new" } | { kind: "rename"; department: Department } | { kind: "archive"; department: Department };

export function DepartmentDialog({ edit, departments, onClose, onDone }: { edit: DepartmentEdit; departments: Department[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [name, setName] = useState(edit.kind === "rename" ? edit.department.name : "");
  const others = edit.kind === "archive" ? departments.filter((d) => !d.archived && d.id !== edit.department.id) : [];
  const [moveTo, setMoveTo] = useState<string>("");
  // Whether the members' destination must be chosen: the department has members, or the API said so in between.
  const [needsMove, setNeedsMove] = useState(edit.kind === "archive" && edit.department.members > 0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const title = edit.kind === "new" ? t("office.department.newTitle") : edit.kind === "rename" ? t("office.department.renameTitle", { name: edit.department.name }) : t("office.department.archiveTitle", { name: edit.department.name });
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (edit.kind === "new") await office.createDepartment(name.trim());
      else if (edit.kind === "rename") await office.renameDepartment(edit.department, name.trim());
      else await office.archiveDepartment(edit.department, needsMove ? { moveTo: moveTo === "" ? null : moveTo } : {});
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === WORKFORCE_ERRORS.departmentNotEmpty) setNeedsMove(true);
      setProblem(problemOf(err, t("office.department.stale")));
    } finally {
      setBusy(false);
    }
  };
  const targetLabel = edit.kind === "archive" ? (edit.department.members === 1 ? t("office.department.oneMember") : t("office.department.manyMembers", { count: edit.department.members })) : "";
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent className={o.form}>
              {edit.kind !== "archive" ? (
                <Field label={t("office.department.nameLabel")} required>
                  <Input value={name} maxLength={80} autoFocus onChange={(_, d) => setName(d.value)} />
                </Field>
              ) : (
                <>
                  <Text>{t("office.department.archiveNote")}</Text>
                  {needsMove && (
                    <Field label={t("office.department.moveMembersLabel", { target: targetLabel })} required>
                      <Select value={moveTo} onChange={(_, d) => setMoveTo(d.value)}>
                        <option value="">{t("office.overview.unassigned")}</option>
                        {others.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </>
              )}
              <ProblemBar problem={problem} />
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>{t("office.department.cancel")}</Button>
              <Button appearance="primary" type="submit" disabled={busy || (edit.kind !== "archive" && name.trim() === "")}>
                {edit.kind === "new" ? t("office.department.create") : edit.kind === "rename" ? t("office.floor.rename") : t("office.floor.archive")}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

// ---- execution defaults -----------------------------------------------------------------------------------------

// Whose defaults are edited: the company's (against the office's version), or a department's (against its own), beside
// what the company says -- what a field the department leaves unset falls to.
export type DefaultsTarget = { kind: "company"; office: Office } | { kind: "department"; department: Department; company: ExecutionDefaults };

const useDefaultsStyles = makeStyles({
  // Three fields a runtime side by side; on a phone the surface is the screen and the fields stack.
  surface: { maxWidth: "min(760px, 100vw)" },
  runtime: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  fields: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px", minWidth: 0, "@media (max-width: 639px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});

type DefaultField = "connectionId" | "model" | "effort";
const FIELDS: readonly DefaultField[] = ["connectionId", "model", "effort"];

// A select's value for a field: "" not set (left to the next layer), NONE an explicit null kept as it was read (the
// account's default connection, or no effort level), else the value itself -- which no connection id, model or effort
// level can be mistaken for.
const NOT_SET = "";
const NONE = "~none";
const selectOf = (v: string | null | undefined): string => (v === undefined ? NOT_SET : v === null ? NONE : v);
const valueOf = (s: string): string | null | undefined => (s === NOT_SET ? undefined : s === NONE ? null : s);

// One runtime's default with one field set, or left unset (the key absent).
function withField(d: ExecutionDefault, field: DefaultField, v: string | null | undefined): ExecutionDefault {
  const rest = Object.fromEntries(Object.entries(d).filter(([k]) => k !== field)) as ExecutionDefault;
  return v === undefined ? rest : { ...rest, [field]: v };
}

// What is sent: a runtime with nothing set is left out.
const cleaned = (d: ExecutionDefaults): ExecutionDefaults => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && Object.keys(v).length > 0));

// The same defaults however their keys were ordered: whether anything changed.
const canonical = (d: ExecutionDefaults): string =>
  JSON.stringify(
    RUNTIME_KINDS.map((r) => {
      const x = d[r];
      return FIELDS.map((f) => (x !== undefined && Object.hasOwn(x, f) ? selectOf(x[f] ?? null) : NOT_SET));
    }),
  );

// The connection whose catalog the model is chosen from: the one chosen here, else the one the company names, else the
// account's default connection of the runtime.
const catalogOf = (connections: RuntimeConnection[], d: ExecutionDefault, company: ExecutionDefault | null): RuntimeConnection | null =>
  connections.find((c) => c.id === d.connectionId) ?? connections.find((c) => c.id === company?.connectionId) ?? connections.find((c) => c.isDefault) ?? connections[0] ?? null;

function RuntimeDefaults({ runtime, value, connections, company, onChange }: { runtime: RuntimeKind; value: ExecutionDefault; connections: RuntimeConnection[]; company: ExecutionDefault | null; onChange: (next: ExecutionDefault) => void }) {
  const { t } = useI18n();
  const s = useDefaultsStyles();
  const models = catalogOf(connections, value, company)?.catalog.models ?? [];
  // The model that would apply here -- chosen, else the company's -- says which effort levels may be chosen.
  const applying = models.find((m) => m.id === (value.model ?? company?.model)) ?? null;
  const efforts = applying !== null ? applying.efforts : [...new Set(models.flatMap((m) => m.efforts))];
  // A choice the next connection or model does not offer is dropped with it; one read that nothing offers now stays shown.
  const fit = (next: ExecutionDefault): ExecutionDefault => {
    const offered = catalogOf(connections, next, company)?.catalog.models ?? [];
    const kept = next.model === undefined || offered.length === 0 || offered.some((m) => m.id === next.model) ? next : withField(next, "model", undefined);
    const model = offered.find((m) => m.id === (kept.model ?? company?.model));
    return typeof kept.effort !== "string" || model === undefined || model.efforts.includes(kept.effort) ? kept : withField(kept, "effort", undefined);
  };
  const connectionLabel = (id: string | null) => (id === null ? t("office.defaults.accountConnection") : (connections.find((c) => c.id === id)?.label ?? id));
  const modelLabel = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const effortText = (e: string | null) => (e === null ? t("office.defaults.noEffortLevel") : effortLabel(e));
  // "Not set", saying what the company has for it when a department leaves it unset.
  const notSet = (field: DefaultField, said: (v: string | null) => string): string => {
    if (company !== null && Object.hasOwn(company, field)) return t("office.defaults.notSetCompany", { value: said(company[field] ?? null) });
    return field === "connectionId" ? t("office.defaults.notSetAccount") : t("office.defaults.notSet");
  };
  return (
    <div role="group" aria-label={RUNTIME_LABELS[runtime]} className={s.runtime}>
      <Text weight="semibold" size={300}>
        {RUNTIME_LABELS[runtime]}
      </Text>
      <div className={s.fields}>
        <Field label={t("office.hire.connectionLabel")}>
          <Select value={selectOf(value.connectionId)} onChange={(_, d) => onChange(fit(withField(value, "connectionId", valueOf(d.value))))}>
            <option value={NOT_SET}>{notSet("connectionId", connectionLabel)}</option>
            {value.connectionId === null && <option value={NONE}>{t("office.defaults.accountConnection")}</option>}
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.isDefault ? t("office.defaults.accountDefaultSuffix", { label: c.label }) : c.label}
              </option>
            ))}
            {typeof value.connectionId === "string" && !connections.some((c) => c.id === value.connectionId) && <option value={value.connectionId}>{t("office.defaults.notOffered", { value: value.connectionId })}</option>}
          </Select>
        </Field>
        <Field label={t("office.hire.modelLabel")}>
          <Select value={selectOf(value.model)} onChange={(_, d) => onChange(fit(withField(value, "model", valueOf(d.value))))}>
            <option value={NOT_SET}>{notSet("model", (v) => modelLabel(v ?? ""))}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {value.model !== undefined && !models.some((m) => m.id === value.model) && <option value={value.model}>{t("office.defaults.notOffered", { value: value.model })}</option>}
          </Select>
        </Field>
        <Field label={t("office.hire.effortLabel")} hint={applying !== null && applying.efforts.length === 0 ? t("office.hire.effortNoLevelHint") : undefined}>
          <Select value={selectOf(value.effort)} disabled={efforts.length === 0 && value.effort === undefined} onChange={(_, d) => onChange(withField(value, "effort", valueOf(d.value)))}>
            <option value={NOT_SET}>{notSet("effort", effortText)}</option>
            {value.effort === null && <option value={NONE}>{t("office.defaults.noEffortLevel")}</option>}
            {efforts.map((e) => (
              <option key={e} value={e}>
                {effortLabel(e)}
              </option>
            ))}
            {typeof value.effort === "string" && !efforts.includes(value.effort) && <option value={value.effort}>{t("office.defaults.notOffered", { value: effortLabel(value.effort) })}</option>}
          </Select>
        </Field>
      </div>
    </div>
  );
}

export function DefaultsDialog({ target, onClose, onDone }: { target: DefaultsTarget; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useDefaultsStyles();
  const connections = useConnections();
  const saved = target.kind === "company" ? target.office.defaults : target.department.defaults;
  const company = target.kind === "department" ? target.company : null;
  const [draft, setDraft] = useState<ExecutionDefaults>(saved);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const all = connections.data?.connections ?? [];
  // The runtimes an employee can run on here, and any a default was already set for.
  const runtimes = RUNTIME_KINDS.filter((r) => all.some((c) => c.runtime === r && c.employeeReady.reasonCode !== "runtime_not_supported") || saved[r] !== undefined);
  const next = cleaned(draft);
  const changed = canonical(next) !== canonical(cleaned(saved));
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (target.kind === "company") await office.setCompanyDefaults(target.office, next);
      else await office.setDepartmentDefaults(target.department, next);
      onDone();
    } catch (err) {
      setProblem(problemOf(err, t("office.defaults.stale")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={mergeClasses("orbit-touch", s.surface)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <DialogTitle>{target.kind === "company" ? t("office.defaults.companyTitle") : t("office.defaults.departmentTitle", { name: target.department.name })}</DialogTitle>
            <DialogContent className={o.form}>
              <Text size={200} className={o.muted}>
                {target.kind === "company" ? t("office.defaults.companyLead") : t("office.defaults.departmentLead", { name: target.department.name })}
              </Text>
              {connections.data === null ? (
                connections.error !== null ? (
                  <MessageBar intent="error">
                    <MessageBarBody>{connections.error}</MessageBarBody>
                  </MessageBar>
                ) : (
                  <Spinner size="tiny" label={t("office.hire.readingConnections")} />
                )
              ) : runtimes.length === 0 ? (
                <Text size={200}>
                  {t("office.defaults.noRuntime")}
                  <Link href={settingsHref("ai-connections")}>{t("office.overview.openAiConnections")}</Link>
                </Text>
              ) : (
                runtimes.map((r) => <RuntimeDefaults key={r} runtime={r} value={draft[r] ?? {}} connections={all.filter((c) => c.runtime === r)} company={company?.[r] ?? null} onChange={(v) => setDraft((d) => ({ ...d, [r]: v }))} />)
              )}
              <ProblemBar problem={problem} />
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>{t("office.department.cancel")}</Button>
              <Button appearance="primary" type="submit" disabled={busy || !changed}>
                {t("office.defaults.save")}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
