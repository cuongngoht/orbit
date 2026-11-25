// QUICK AI MODEL SWITCHER for Office Overview: change one agent's AI connection, model, and effort directly from their
// desk card, OR switch ALL agents (or a department) in one simple dialog. Every change creates a normal auditable
// profile revision through PATCH /api/employees/:id (with If-Match), preserving webSearch / orbitPlugin rules and
// never mutating work already claimed.
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Link,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Sparkle16Regular } from "@fluentui/react-icons";
import {
  RUNTIME_LABELS,
  effortFor,
  effortLabel,
  type Department,
  type EmployeeCard,
  type EmployeeDetail,
  type ExecutionDefaults,
  type ExecutionProfile,
  type Roster,
  type RuntimeConnection,
} from "@orbit-web/contracts";
import { useState } from "react";
import { settingsHref } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText } from "../../services/api";
import { useConnections } from "../connections/AiConnectionsSection";
import { office, wholeRoster } from "./api";
import { DefaultsThatApply, INHERITED, inheritsModel, usableForEmployees } from "./HireWizard";
import { ProblemBar, useAction, useOfficeStyles } from "./parts";

export type ModelSwitcherTarget =
  | { kind: "single"; employee: EmployeeCard }
  | { kind: "bulk"; initialScope?: string };

const useStyles = makeStyles({
  surface: { maxWidth: "540px", width: "min(94vw, 540px)" },
  titleRow: { display: "inline-flex", alignItems: "center", gap: "8px" },
  scopeBox: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
});

function buildExecution(
  base: ExecutionProfile,
  connection: RuntimeConnection,
  modelId: string | null,
  effort: string | null,
  inherit: boolean,
): ExecutionProfile {
  const own = {
    runtime: connection.runtime,
    connectionId: connection.id,
    webSearch: base.webSearch && connection.capabilities.webSearch === "yes",
    orbitPlugin: base.orbitPlugin && connection.runtime === "claude" && connection.id === base.connectionId,
  };
  if (inherit || modelId === null) {
    return { ...own, model: "", effort: null, inherit: [...INHERITED] };
  }
  return { ...own, model: modelId, effort };
}

function SingleAgentBody({
  employee,
  departments,
  companyDefaults,
  ready,
  onClose,
  onDone,
}: {
  employee: EmployeeCard;
  departments: Department[];
  companyDefaults: ExecutionDefaults;
  ready: RuntimeConnection[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const act = useAction();
  const detail = useResource<EmployeeDetail>(() => office.employee(employee.id), [employee.id]);
  const initial = detail.data?.profile.execution ?? employee.execution;
  const [connectionId, setConnectionId] = useState<string | null>(initial.connectionId);
  const [modelId, setModelId] = useState<string | null>(initial.model || null);
  const [effortId, setEffortId] = useState<string | null>(initial.effort);
  const [inherit, setInherit] = useState<boolean>(inheritsModel(initial));

  const connection = ready.find((c) => c.id === connectionId) ?? ready[0] ?? null;
  const models = connection?.catalog.models ?? [];
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === connection?.catalog.recommended) ?? models[0] ?? null;
  const effort = model === null || model.efforts.length === 0 ? null : effortId !== null && model.efforts.includes(effortId) ? effortId : effortFor(model, "medium");
  const dept = departments.find((d) => d.id === employee.departmentId) ?? null;

  const save = async () => {
    const e = detail.data;
    if (e === null || connection === null || (model === null && !inherit)) return;
    const execution = buildExecution(e.profile.execution, connection, model?.id ?? null, effort, inherit);
    const modelLabel = inherit || model === null ? t("office.employee.defaultModelNote") : model.label;
    const note = t("office.employee.runsOnNote", {
      runtime: RUNTIME_LABELS[connection.runtime],
      label: connection.label,
      model: modelLabel,
    });
    const ok = await act.run(() => office.updateEmployee(e, { profile: { ...e.profile, execution }, note }));
    if (ok) {
      onDone();
      onClose();
    }
  };

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <DialogBody>
        <DialogTitle>
          <span className={s.titleRow}>
            <Sparkle16Regular aria-hidden />
            <span>{t("office.modelSwitcher.singleTitle", { name: employee.name })}</span>
          </span>
        </DialogTitle>
        <DialogContent className={o.form}>
          <Text size={200} className={o.muted}>
            {t("office.modelSwitcher.singleLead", { name: employee.name })}
          </Text>
          {detail.data === null ? (
            detail.error ? (
              <MessageBar intent="error">
                <MessageBarBody>{detail.error}</MessageBarBody>
              </MessageBar>
            ) : (
              <Spinner size="tiny" label={t("office.modelSwitcher.readingAgent", { name: employee.name })} />
            )
          ) : ready.length === 0 ? (
            <MessageBar intent="warning">
              <MessageBarBody>
                {t("office.hire.noConnectionYet")}
                <Link href={settingsHref("ai-connections")}>{t("office.hire.connectInSettings")}</Link>
              </MessageBarBody>
            </MessageBar>
          ) : (
            <>
              <Field label={t("office.hire.connectionLabel")}>
                <Select
                  value={connection?.id ?? ""}
                  onChange={(_, d) => {
                    setConnectionId(d.value);
                    setModelId(null);
                    setEffortId(null);
                  }}
                >
                  {ready.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`${RUNTIME_LABELS[c.runtime]} — ${c.label}`}
                    </option>
                  ))}
                </Select>
              </Field>
              {!inherit && (
                <div className={o.formGrid}>
                  <Field label={t("office.hire.modelLabel")}>
                    <Select
                      value={model?.id ?? ""}
                      onChange={(_, d) => {
                        setModelId(d.value);
                        setEffortId(null);
                      }}
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {connection?.catalog.recommended === m.id ? t("office.hire.recommendedSuffix") : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("office.hire.effortLabel")} hint={model && model.efforts.length === 0 ? t("office.hire.effortNoLevelHint") : undefined}>
                    <Select value={effort ?? ""} disabled={model === null || model.efforts.length === 0} onChange={(_, d) => setEffortId(d.value)}>
                      {model?.efforts.length === 0 && <option value="">{t("office.hire.noEffortOption")}</option>}
                      {(model?.efforts ?? []).map((v) => (
                        <option key={v} value={v}>
                          {effortLabel(v)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
              <Checkbox
                checked={inherit}
                onChange={(_, d) => setInherit(d.checked === true)}
                label={employee.role === "ceo" ? t("office.hire.ceoInheritLabel") : t("office.hire.inheritLabel")}
              />
              {inherit && connection !== null && <DefaultsThatApply connection={connection} department={dept} company={companyDefaults} />}
              <Text size={200} className={o.muted}>
                {t("office.modelSwitcher.appliesNextNote")}
              </Text>
            </>
          )}
          <ProblemBar problem={act.problem} onLoadLatest={() => void detail.reload()} />
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose} disabled={act.busy}>
            {t("office.assign.cancel")}
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={act.busy || detail.data === null || connection === null || (model === null && !inherit)}
          >
            {act.busy ? t("office.modelSwitcher.saving") : t("office.modelSwitcher.saveSingle")}
          </Button>
        </DialogActions>
      </DialogBody>
    </form>
  );
}

function BulkAgentsBody({
  initialScope,
  ready,
  onClose,
  onDone,
}: {
  initialScope: string;
  ready: RuntimeConnection[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const roster = useResource<Roster>(() => wholeRoster(), []);
  const [scope, setScope] = useState<string>(initialScope);
  const [connectionId, setConnectionId] = useState<string | null>(ready.find((c) => c.isDefault)?.id ?? ready[0]?.id ?? null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [effortId, setEffortId] = useState<string | null>(null);
  const [inherit, setInherit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const connection = ready.find((c) => c.id === connectionId) ?? ready[0] ?? null;
  const models = connection?.catalog.models ?? [];
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === connection?.catalog.recommended) ?? models[0] ?? null;
  const effort = model === null || model.efforts.length === 0 ? null : effortId !== null && model.efforts.includes(effortId) ? effortId : effortFor(model, "medium");

  const activeAgents = (roster.data?.employees ?? []).filter((e) => e.employment !== "archived" && e.employment !== "deleted");
  const liveDepartments = (roster.data?.departments ?? []).filter((d) => !d.archived);
  const ceo = activeAgents.find((e) => e.role === "ceo" || (roster.data?.ceo !== null && e.id === roster.data?.ceo?.employeeId)) ?? null;
  const unassigned = activeAgents.filter((e) => e.departmentId === null && e.id !== ceo?.id);

  const selectedAgents =
    scope === "all"
      ? activeAgents
      : scope === "ceo"
        ? ceo
          ? [ceo]
          : []
        : scope === "unassigned"
          ? unassigned
          : activeAgents.filter((e) => e.departmentId === scope && e.id !== ceo?.id);

  const applyAll = async () => {
    if (connection === null || (model === null && !inherit) || selectedAgents.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    setProgress({ done: 0, total: selectedAgents.length });
    const failures: string[] = [];
    let okCount = 0;
    const modelLabel = inherit || model === null ? t("office.employee.defaultModelNote") : model.label;
    const note = t("office.modelSwitcher.noteBulk", {
      runtime: RUNTIME_LABELS[connection.runtime],
      label: connection.label,
      model: modelLabel,
    });
    for (const agent of selectedAgents) {
      try {
        const detail = await office.employee(agent.id);
        const execution = buildExecution(detail.profile.execution, connection, model?.id ?? null, effort, inherit);
        await office.updateEmployee(detail, { profile: { ...detail.profile, execution }, note });
        okCount += 1;
      } catch (err) {
        failures.push(`${agent.name} (${errorText(err)})`);
      }
      setProgress({ done: okCount + failures.length, total: selectedAgents.length });
    }
    setBusy(false);
    setProgress(null);
    if (okCount > 0) onDone();
    if (failures.length === 0) {
      onClose();
    } else {
      setErrorMsg(t("office.modelSwitcher.partialFailure", { ok: okCount, total: selectedAgents.length, errors: failures.join("; ") }));
    }
  };

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void applyAll();
      }}
    >
      <DialogBody>
        <DialogTitle>
          <span className={s.titleRow}>
            <Sparkle16Regular aria-hidden />
            <span>{t("office.modelSwitcher.bulkTitle")}</span>
          </span>
        </DialogTitle>
        <DialogContent className={o.form}>
          <Text size={200} className={o.muted}>
            {t("office.modelSwitcher.bulkLead")}
          </Text>
          {roster.data === null ? (
            roster.error ? (
              <MessageBar intent="error">
                <MessageBarBody>{roster.error}</MessageBarBody>
              </MessageBar>
            ) : (
              <Spinner size="tiny" label={t("office.modelSwitcher.readingRoster")} />
            )
          ) : ready.length === 0 ? (
            <MessageBar intent="warning">
              <MessageBarBody>
                {t("office.hire.noConnectionYet")}
                <Link href={settingsHref("ai-connections")}>{t("office.hire.connectInSettings")}</Link>
              </MessageBarBody>
            </MessageBar>
          ) : (
            <>
              <Field label={t("office.modelSwitcher.applyToLabel")}>
                <Select value={scope} disabled={busy} onChange={(_, d) => setScope(d.value)}>
                  <option value="all">{t("office.modelSwitcher.scopeAll", { count: activeAgents.length })}</option>
                  {ceo && <option value="ceo">{t("office.modelSwitcher.scopeCeo", { name: ceo.name })}</option>}
                  {liveDepartments.map((d) => {
                    const count = activeAgents.filter((e) => e.departmentId === d.id && e.id !== ceo?.id).length;
                    return (
                      <option key={d.id} value={d.id}>
                        {t("office.modelSwitcher.scopeDept", { name: d.name, count })}
                      </option>
                    );
                  })}
                  {unassigned.length > 0 && (
                    <option value="unassigned">{t("office.modelSwitcher.scopeUnassigned", { count: unassigned.length })}</option>
                  )}
                </Select>
              </Field>
              <div className={s.scopeBox}>
                <Text size={200} className={selectedAgents.length === 0 ? o.muted : undefined}>
                  {selectedAgents.length === 0
                    ? t("office.modelSwitcher.noAgentsInScope")
                    : t("office.modelSwitcher.affectedSummary", {
                        count: selectedAgents.length,
                        names: selectedAgents.map((a) => a.name).join(", "),
                      })}
                </Text>
              </div>
              <Field label={t("office.hire.connectionLabel")}>
                <Select
                  value={connection?.id ?? ""}
                  disabled={busy}
                  onChange={(_, d) => {
                    setConnectionId(d.value);
                    setModelId(null);
                    setEffortId(null);
                  }}
                >
                  {ready.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`${RUNTIME_LABELS[c.runtime]} — ${c.label}`}
                    </option>
                  ))}
                </Select>
              </Field>
              {!inherit && (
                <div className={o.formGrid}>
                  <Field label={t("office.hire.modelLabel")}>
                    <Select
                      value={model?.id ?? ""}
                      disabled={busy}
                      onChange={(_, d) => {
                        setModelId(d.value);
                        setEffortId(null);
                      }}
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {connection?.catalog.recommended === m.id ? t("office.hire.recommendedSuffix") : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("office.hire.effortLabel")} hint={model && model.efforts.length === 0 ? t("office.hire.effortNoLevelHint") : undefined}>
                    <Select value={effort ?? ""} disabled={busy || model === null || model.efforts.length === 0} onChange={(_, d) => setEffortId(d.value)}>
                      {model?.efforts.length === 0 && <option value="">{t("office.hire.noEffortOption")}</option>}
                      {(model?.efforts ?? []).map((v) => (
                        <option key={v} value={v}>
                          {effortLabel(v)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
              <Checkbox
                checked={inherit}
                disabled={busy}
                onChange={(_, d) => setInherit(d.checked === true)}
                label={t("office.modelSwitcher.inheritBulkLabel")}
              />
              {inherit && (
                <Text size={200} className={o.muted}>
                  {t("office.modelSwitcher.inheritBulkNote")}
                </Text>
              )}
              <Text size={200} className={o.muted}>
                {t("office.modelSwitcher.appliesNextNote")}
              </Text>
            </>
          )}
          {errorMsg && (
            <MessageBar intent="error" layout="multiline">
              <MessageBarBody>{errorMsg}</MessageBarBody>
            </MessageBar>
          )}
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose} disabled={busy}>
            {t("office.assign.cancel")}
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={busy || roster.data === null || selectedAgents.length === 0 || connection === null || (model === null && !inherit)}
          >
            {progress
              ? t("office.modelSwitcher.updatingProgress", { done: progress.done, total: progress.total })
              : t("office.modelSwitcher.saveBulk", { count: selectedAgents.length })}
          </Button>
        </DialogActions>
      </DialogBody>
    </form>
  );
}

export function ModelSwitcherDialog({
  target,
  departments,
  companyDefaults,
  onClose,
  onDone,
}: {
  target: ModelSwitcherTarget;
  departments: Department[];
  companyDefaults: ExecutionDefaults;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const connections = useConnections();
  const ready = (connections.data?.connections ?? []).filter(usableForEmployees);
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={`orbit-touch ${s.surface}`}>
        {connections.data === null ? (
          <DialogBody>
            <DialogTitle>{t("office.modelSwitcher.bulkTitle")}</DialogTitle>
            <DialogContent>
              <Spinner size="tiny" label={t("office.hire.readingConnections")} />
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>{t("office.assign.cancel")}</Button>
            </DialogActions>
          </DialogBody>
        ) : target.kind === "single" ? (
          <SingleAgentBody
            key={target.employee.id}
            employee={target.employee}
            departments={departments}
            companyDefaults={companyDefaults}
            ready={ready}
            onClose={onClose}
            onDone={onDone}
          />
        ) : (
          <BulkAgentsBody
            initialScope={target.initialScope ?? "all"}
            ready={ready}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogSurface>
    </Dialog>
  );
}
