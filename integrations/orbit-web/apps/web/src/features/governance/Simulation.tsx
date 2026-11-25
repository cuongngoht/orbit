// SIMULATE A DECISION: what a revision would decide for one request, asked of the API, which answers with the same
// evaluate() every decision is made by. Nothing is recorded and nothing is allowed by asking. The company's simulation
// asks as anybody -- or, naming a department or an employee, as that employee's assignment (an agent's request, decided
// with the department's policy too); a department's asks as one of its own employees.
import { Button, Field, Input, Text, makeStyles, mergeClasses } from "@fluentui/react-components";
import { ACTION_KINDS, ENVIRONMENTS, PRINCIPAL_TYPES, type Environment, type PrincipalType } from "@orbit-web/governance-core";
import type { Roster, SimulatedRequest, SimulateResult } from "@orbit-web/contracts";
import { useState } from "react";
import { DecisionsIcon } from "../../components/SectionIcons";
import { useI18n } from "../../i18n";
import { errorText } from "../../services/api";
import { Card, CleanSelect, ErrorBar, Word, useParts } from "./parts";

// Whom a request may be asked as: the office's live departments, and its employees with the department each is in.
export interface SimulationPeople {
  departments: { id: string; name: string }[];
  employees: { id: string; name: string; departmentId: string | null }[];
}

// The people of the office as a simulation offers them; null when there is nobody to ask as.
export function peopleOf(roster: Roster | null): SimulationPeople | null {
  if (roster === null) return null;
  const departments = roster.departments.filter((d) => !d.archived).map((d) => ({ id: d.id, name: d.name }));
  const employees = roster.employees.map((e) => ({ id: e.id, name: e.name, departmentId: e.departmentId }));
  return departments.length === 0 && employees.length === 0 ? null : { departments, employees };
}

const useStyles = makeStyles({
  simGrid: {
    display: "grid",
    gridTemplateColumns: "124px minmax(180px, 1.15fr) minmax(210px, 1.35fr) 144px auto",
    gap: "10px",
    alignItems: "end",
    "@media (max-width: 959px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
    "@media (max-width: 639px)": { gridTemplateColumns: "1fr" },
  },
  // Without "Who": the request is always an employee's.
  simGridEmployee: {
    gridTemplateColumns: "minmax(180px, 1.15fr) minmax(210px, 1.35fr) 144px auto",
    gridAutoFlow: "row dense",
    "@media (max-width: 959px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
    "@media (max-width: 639px)": { gridTemplateColumns: "1fr" },
  },
  simPeople: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    alignItems: "end",
    "@media (max-width: 639px)": { gridTemplateColumns: "1fr" },
  },
  simField: { minWidth: 0, width: "100%" },
  simResourceField: {
    minWidth: 0,
    width: "100%",
    "@media (max-width: 959px)": { gridColumn: "1 / -1" },
  },
  simControl: { width: "100%", minWidth: 0 },
  simInput: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
    minHeight: "36px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "42px" },
  },
  simBtnWrap: {
    minWidth: 0,
    "@media (max-width: 959px)": { gridColumn: "1 / -1" },
  },
  simBtn: {
    width: "100%",
    minHeight: "36px",
    borderRadius: "10px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "42px" },
  },
});

export function Simulation({
  description,
  ask,
  people = null,
  who = true,
}: {
  description: string;
  ask: (request: SimulatedRequest) => Promise<SimulateResult>;
  // The departments and employees a request may be asked as (the company's simulation); null: nobody to choose.
  people?: SimulationPeople | null;
  // Whether a person chooses who asks; a department's simulation is always one of its employees.
  who?: boolean;
}) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  const [principalType, setPrincipalType] = useState<string>("agent");
  const [action, setAction] = useState<string>("repository.push");
  const [resource, setResource] = useState("");
  const [environment, setEnvironment] = useState<string>("development");
  const [departmentId, setDepartmentId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Naming a department or an employee asks as an employee's assignment: an agent's request.
  const asEmployee = departmentId !== "" || employeeId !== "";
  const chooseEmployee = (id: string) => {
    setEmployeeId(id);
    // An employee's work is decided with its own department's policy: asked as it, it is asked in that department.
    const employee = people?.employees.find((e) => e.id === id);
    if (employee !== undefined) setDepartmentId(employee.departmentId ?? "");
  };
  const request = (): SimulatedRequest => ({
    principalType: (who && !asEmployee ? principalType : "agent") as PrincipalType,
    action,
    resource,
    environment: environment as Environment,
    workspaceId: null,
    researchWorkspaceId: null,
    ...(asEmployee ? { runKind: "assignment" as const, departmentId: departmentId || null, employeeId: employeeId || null } : {}),
  });
  const submit = () => {
    setError(null);
    void ask(request())
      .then(setResult)
      .catch((err: unknown) => setError(errorText(err)));
  };
  const departmentName = new Map((people?.departments ?? []).map((d) => [d.id, d.name]));
  return (
    <Card title={t("governance.policy.simTitle")} icon={<DecisionsIcon size={18} />} tone="teal" description={description}>
      {people !== null && (
        <div className={styles.simPeople}>
          <Field label={t("governance.sim.department")} className={styles.simField}>
            {(fp) => (
              <CleanSelect
                className={styles.simControl}
                fieldProps={fp}
                value={departmentId}
                onChange={setDepartmentId}
                options={[{ value: "", label: t("governance.sim.nobody") }, ...people.departments.map((d) => ({ value: d.id, label: d.name }))]}
              />
            )}
          </Field>
          <Field label={t("governance.sim.employee")} className={styles.simField}>
            {(fp) => (
              <CleanSelect
                className={styles.simControl}
                fieldProps={fp}
                value={employeeId}
                onChange={chooseEmployee}
                options={[
                  { value: "", label: t("governance.sim.nobody") },
                  ...people.employees.map((e) => ({ value: e.id, label: e.departmentId !== null && departmentName.has(e.departmentId) ? t("governance.sim.employeeIn", { name: e.name, department: departmentName.get(e.departmentId) ?? "" }) : e.name })),
                ]}
              />
            )}
          </Field>
        </div>
      )}
      {people !== null && (
        <Text size={200} className={s.muted}>
          {asEmployee ? t("governance.sim.asEmployee") : t("governance.sim.asAnybody")}
        </Text>
      )}
      <div className={mergeClasses(styles.simGrid, !who && styles.simGridEmployee)}>
        {who && (
          <Field label={t("governance.policy.simWho")} className={styles.simField}>
            {(fp) => (
              <CleanSelect
                className={styles.simControl}
                fieldProps={fp}
                value={asEmployee ? "agent" : principalType}
                disabled={asEmployee}
                onChange={setPrincipalType}
                options={PRINCIPAL_TYPES.map((p) => ({ value: p, label: p === "human" ? t("governance.parts.principal.you") : p }))}
              />
            )}
          </Field>
        )}
        <Field label={t("governance.policy.simAction")} className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={action} onChange={setAction} options={ACTION_KINDS.map((a) => ({ value: a, label: a }))} />}
        </Field>
        <Field label={t("governance.policy.simResource")} className={styles.simResourceField}>
          <Input className={styles.simInput} value={resource} onChange={(_, d) => setResource(d.value)} placeholder={t("governance.policy.simResourcePlaceholder")} />
        </Field>
        <Field label={t("governance.policy.simEnv")} className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={environment} onChange={setEnvironment} options={ENVIRONMENTS.map((e) => ({ value: e, label: e }))} />}
        </Field>
        <div className={styles.simBtnWrap}>
          <Button className={styles.simBtn} appearance="secondary" onClick={submit}>
            {t("governance.policy.simAsk")}
          </Button>
        </div>
      </div>
      <ErrorBar text={error} />
      {result && (
        <div className={s.inset} aria-label={t("governance.policy.simResultAria")}>
          <div className={s.row}>
            <Word value={result.evaluation.verdict} />
            <Text size={200}>{t("governance.policy.simHeldBy", { enforcement: result.evaluation.enforcement })}</Text>
            <Text size={200} className={s.mono}>
              {result.evaluation.reasonCodes.join(", ")}
              {result.evaluation.matchedRules.length > 0 ? ` · ${result.evaluation.matchedRules.join(", ")}` : ""}
            </Text>
          </div>
        </div>
      )}
    </Card>
  );
}
