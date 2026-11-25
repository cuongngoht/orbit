// HIRE AN EMPLOYEE, in five steps: who it is; its department and role; the AI runtime it runs on, with a model and an
// effort level from that connection's own catalog -- or left to its department's default, else the company's; its
// Personal Sandbox and resources; then everything once more, with when it can take work, before it is hired. Only a
// connection that is connected and read its models from the account is offered -- an employee never runs on a fallback
// list -- and nothing switches to another provider by itself.
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
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Switch,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  DEFAULT_PRESETS,
  RUNTIME_LABELS,
  WORKFORCE_LIMITS,
  checkHireEmployee,
  effortFor,
  effortLabel,
  type Department,
  type EmployeeDetail,
  type EmployeeTemplate,
  type ExecutionDefaults,
  type ExecutionProfile,
  type HireEmployeeRequest,
  type InheritableField,
  type ResourcePreset,
  type ResourceProfile,
  type ResourceSummary,
  type RuntimeConnection,
} from "@orbit-web/contracts";
import { useState } from "react";
import { ConnectionRequired, isConnectionRequired } from "../../components/ApiErrorBar";
import { settingsHref } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { t as tr, useI18n, type I18nContextValue } from "../../i18n";
import { ApiError, errorText } from "../../services/api";
import { useConnections } from "../connections/AiConnectionsSection";
import { useExecutiveState } from "../executive/api";
import { cpuText, sizeText } from "../resources/format";
import { useResourceSummary } from "../resources/ComputeStorageSection";
import { office } from "./api";
import { Disclosure, useOfficeStyles } from "./parts";
import { DraftWithAi } from "./DraftWithAi";
import { ResourceFields, profileLine, resourceProblems, storageProblem } from "./ResourceFields";

export const HIRE_STEPS = [
  tr("office.hire.step.identity"),
  tr("office.hire.step.role"),
  tr("office.hire.step.runtime"),
  tr("office.hire.step.resources"),
  tr("office.hire.step.review"),
] as const;

const useStyles = makeStyles({
  surface: {
    width: "min(960px, 96vw)",
    maxWidth: "min(960px, 96vw)",
    maxHeight: "92dvh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  surfaceMobile: {
    width: "100vw",
    maxWidth: "100vw",
    height: "var(--orbit-app-height, 100dvh)",
    maxHeight: "var(--orbit-app-height, 100dvh)",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  dialogBody: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    maxHeight: "100%",
    minHeight: 0,
    flexGrow: 1,
    overflow: "hidden",
  },
  steps: { display: "flex", gap: "6px", flexWrap: "wrap", listStyleType: "none", margin: 0, paddingLeft: 0 },
  step: { display: "inline-flex", alignItems: "center", gap: "6px", paddingTop: "4px", paddingRight: "10px", paddingBottom: "4px", paddingLeft: "6px", borderRadius: "9999px", backgroundColor: tokens.colorNeutralBackground2, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  stepBtn: { border: "none", fontFamily: "inherit", cursor: "pointer", ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover }, ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" } },
  stepOn: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  dot: { width: "20px", height: "20px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: tokens.colorNeutralBackground5, fontSize: tokens.fontSizeBase100 },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: "2px",
    paddingRight: "4px",
    paddingBottom: "4px",
  },
  dialogActions: { paddingTop: "8px" },
  option: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  quote: { borderLeft: `3px solid ${tokens.colorNeutralStroke1}`, paddingLeft: "10px", margin: 0 },
});

interface Draft {
  name: string;
  templateId: string | null;
  languages: string;
  departmentId: string | null;
  title: string;
  duties: string;
  instructions: string;
  skills: string;
  handoffStandard: string;
  reportingRule: string;
  connectionId: string | null;
  model: string | null;
  effort: string | null;
  // The model and effort left to the department's default, else the company's.
  inherit: boolean;
  webSearch: boolean;
  orbitPlugin: boolean;
  resources: ResourceProfile | null;
  skipProbation: boolean;
  skipReason: string;
  canDelegate: boolean;
  // How many temporary assistants it may engage while it leads a mission (as the CEO or a manager).
  maxAssistants: number;
  // Optional reason recorded on the CEO appointment created at hire.
  appointReason: string;
}

// What a new profile allows by default: a lead (the CEO, a manager) may engage two temporary assistants per mission.
export const DEFAULT_ASSISTANTS = 2;

const EMPTY: Draft = { name: "", templateId: null, languages: "", departmentId: null, title: "", duties: "", instructions: "", skills: "", handoffStandard: "", reportingRule: "", connectionId: null, model: null, effort: null, inherit: false, webSearch: false, orbitPlugin: false, resources: null, skipProbation: false, skipReason: "", canDelegate: false, maxAssistants: DEFAULT_ASSISTANTS, appointReason: "" };

const list = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

// A connection an employee may run on, as the server says it (employeeReadiness): connected, its models read from the
// account (never a fallback list), and its model plane observed held to Orbit's tools.
export const usableForEmployees = (c: RuntimeConnection): boolean => c.employeeReady.ready;

// How many temporary assistants it may engage while it leads a mission: 0 to the contract's bound, 0 turning it off.
export function AssistantsField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useI18n();
  return (
    <Field label={t("office.hire.assistantsLabel")} hint={t("office.hire.assistantsHint")}>
      <Select value={String(value)} onChange={(_, d) => onChange(Number(d.value))}>
        {Array.from({ length: WORKFORCE_LIMITS.maxAssistants + 1 }, (_, n) => (
          <option key={n} value={String(n)}>
            {n === 0 ? t("office.hire.assistantsNone") : String(n)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const whyNot = (c: RuntimeConnection): string => c.employeeReady.reason ?? tr("office.hire.cannotRunEmployees");

// The Orbit plugin may be asked for an employee only on Claude Code, with the owner's grant for employees on exactly the
// plugin's current version.
const pluginAllowed = (c: RuntimeConnection): boolean => c.runtime === "claude" && c.plugins !== null && c.plugins.installed && c.plugins.useCases.employee.approved && !c.plugins.useCases.employee.needsConfirmation;

// What Anthropic's page says of a subscription used by something that works on its own, quoted with its source.
const CLAUDE_PLAN_NOTE = { quote: tr("office.hire.claudePlanQuote"), source: "https://code.claude.com/docs/en/legal-and-compliance" };

// When the employee could take work, from what the account holds now.
export function availability(p: ResourceProfile, summary: ResourceSummary | null, runtime: string | null): string {
  const sandbox = tr("office.hire.sandboxPrepared");
  if (summary === null) return tr("office.hire.availabilityUnknown", { sandbox });
  const overhead = summary.modelPlane.find((m) => m.runtime === runtime) ?? { cpuMillis: 0, memoryMiB: 0 };
  const cpu = p.cpuMillis + overhead.cpuMillis;
  const memory = p.memoryMiB + overhead.memoryMiB;
  const needs = tr("office.hire.needsPerAttempt", { cpu: cpuText(cpu), memory: sizeText(memory) });
  if (cpu > summary.budget.cpuMillis || memory > summary.budget.memoryMiB || cpu > summary.capacity.usable.cpuMillis || memory > summary.capacity.usable.memoryMiB)
    return tr("office.hire.availabilityNever", { sandbox, needs, budgetCpu: cpuText(summary.budget.cpuMillis), budgetMemory: sizeText(summary.budget.memoryMiB) });
  if (cpu <= summary.available.cpuMillis && memory <= summary.available.memoryMiB) return tr("office.hire.availabilityNow", { sandbox, needs });
  return tr("office.hire.availabilityWait", { sandbox, needs, freeCpu: cpuText(summary.available.cpuMillis), freeMemory: sizeText(summary.available.memoryMiB) });
}

// What a profile that leaves its model and effort to the defaults asks: these two fields, and nothing chosen for them.
export const INHERITED: InheritableField[] = ["model", "effort"];

export const inheritsModel = (x: ExecutionProfile): boolean => x.inherit?.includes("model") === true;

// The default a field left to them comes from (execution precedence, the API's rule said again only to show it): the
// department's default for the employee's runtime, else the company's -- null when neither names one. `owner`: the
// department's name, or null for the company.
export function defaultFor(field: "model" | "effort", runtime: RuntimeConnection["runtime"], department: Department | null, company: ExecutionDefaults | null): { value: string | null; owner: string | null } | null {
  const mine = department?.defaults?.[runtime];
  if (mine !== undefined && Object.hasOwn(mine, field)) return { value: mine[field] ?? null, owner: department?.name ?? null };
  const theirs = company?.[runtime];
  if (theirs !== undefined && Object.hasOwn(theirs, field)) return { value: theirs[field] ?? null, owner: null };
  return null;
}

// Which model and effort an employee leaving them to the defaults would run on, on this connection, in words -- and what
// the API would refuse about it (a model nobody names, one this connection does not offer, an effort the model needs).
export function defaultsInWords(t: I18nContextValue["t"], connection: RuntimeConnection, department: Department | null, company: ExecutionDefaults | null): { model: string; effort: string; warnings: string[] } {
  const owner = (who: string | null) => who ?? t("office.hire.companyOwner");
  const model = defaultFor("model", connection.runtime, department, company);
  const effort = defaultFor("effort", connection.runtime, department, company);
  const option = model?.value ? (connection.catalog.models.find((m) => m.id === model.value) ?? null) : null;
  const warnings = [
    ...(model?.value && option === null ? [t("office.hire.modelNotOffered", { value: model.value })] : []),
    ...(option !== null && option.efforts.length > 0 && (effort === null || effort.value === null) ? [t("office.hire.effortRequired", { model: option.label })] : []),
  ];
  return {
    model: model?.value ? t("office.hire.defaultOf", { value: option?.label ?? model.value, owner: owner(model.owner) }) : t("office.hire.noModelDefault", { runtime: RUNTIME_LABELS[connection.runtime] }),
    effort: effort?.value ? t("office.hire.defaultOf", { value: effortLabel(effort.value), owner: owner(effort.owner) }) : t("office.hire.noEffortDefault"),
    warnings,
  };
}

// The model and effort the defaults would give, said where a person chooses to leave them to the defaults.
export function DefaultsThatApply({ connection, department, company }: { connection: RuntimeConnection; department: Department | null; company: ExecutionDefaults | null }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const words = defaultsInWords(t, connection, department, company);
  return (
    <div className={o.inset}>
      <Text size={200}>{t("office.hire.inheritModel", { value: words.model })}</Text>
      <Text size={200}>{t("office.hire.inheritEffort", { value: words.effort })}</Text>
      {words.warnings.map((w) => (
        <Text key={w} size={200} className={o.warn}>
          {w}
        </Text>
      ))}
      <Text size={200} className={o.muted}>
        {t("office.hire.inheritNote")}
      </Text>
    </div>
  );
}

// A refusal's reasons, when the API listed them beside its message.
function reasonsOf(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const d = err.details;
  if (Array.isArray(d)) return d.filter((x): x is string => typeof x === "string");
  if (d !== null && typeof d === "object") for (const k of ["reasons", "problems", "errors"]) {
    const v = (d as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function Steps({ steps, at, onSelect }: { steps: readonly string[]; at: number; onSelect: (step: number) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <ol className={s.steps} aria-label={t("office.hire.stepsAria")}>
      {steps.map((label, i) => (
        <li key={label} aria-current={i === at ? "step" : undefined}>
          {i < at ? (
            <button type="button" className={mergeClasses(s.step, s.stepBtn)} onClick={() => onSelect(i)}>
              <span className={s.dot} aria-hidden>
                {i + 1}
              </span>
              {label}
            </button>
          ) : (
            <span className={mergeClasses(s.step, i === at && s.stepOn)}>
              <span className={s.dot} aria-hidden>
                {i + 1}
              </span>
              {label}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function HireWizard({ departments, initialDepartmentId = null, appointRole = null, companyDefaults = null, onClose, onHired }: { departments: Department[]; initialDepartmentId?: string | null; appointRole?: "ceo" | null; companyDefaults?: ExecutionDefaults | null; onClose: () => void; onHired: (e: EmployeeDetail) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const { isMobile } = useViewport();
  const isCeo = appointRole === "ceo";
  const steps = isCeo
    ? ([t("office.hire.step.identity"), t("office.hire.step.ceoRole"), t("office.hire.step.runtime"), t("office.hire.step.resources"), t("office.hire.step.review")] as const)
    : HIRE_STEPS;
  const connections = useConnections();
  const summary = useResourceSummary();
  // Whether the CEO can draft a profile for this form now.
  const executiveState = useExecutiveState();
  const templates = useResource<EmployeeTemplate[]>(isCeo ? null : () => office.templates(), [isCeo]);
  const presetsRead = useResource<ResourcePreset[]>(() => office.presets(), []);
  const presets: readonly ResourcePreset[] = presetsRead.data ?? (presetsRead.error ? DEFAULT_PRESETS : []);
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<Draft>(() =>
    isCeo
      ? {
          ...EMPTY,
          departmentId: null,
          title: t("office.hire.ceoDefaultTitle"),
          duties: t("office.hire.ceoDefaultDuties"),
          skills: t("office.hire.ceoDefaultSkills"),
          handoffStandard: t("office.hire.ceoDefaultHandoff"),
        }
      : { ...EMPTY, departmentId: initialDepartmentId },
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const set = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));

  const all = connections.data?.connections ?? [];
  const usable = all.filter(usableForEmployees);
  const connection = usable.find((c) => c.id === draft.connectionId) ?? usable.find((c) => c.isDefault) ?? usable[0] ?? null;
  const models = connection?.catalog.models ?? [];
  const model = models.find((m) => m.id === draft.model) ?? models.find((m) => m.id === connection?.catalog.recommended) ?? models[0] ?? null;
  const effort = model === null ? null : model.efforts.length === 0 ? null : draft.effort !== null && model.efforts.includes(draft.effort) ? draft.effort : effortFor(model, "medium");
  const webSearch = connection?.capabilities.webSearch === "yes" && draft.webSearch;
  const orbitPlugin = connection !== null && pluginAllowed(connection) && draft.orbitPlugin;
  const resources = draft.resources ?? presets[0]?.profile ?? DEFAULT_PRESETS[0]?.profile ?? null;
  const live = departments.filter((d) => !d.archived);
  const department = isCeo ? null : (live.find((d) => d.id === draft.departmentId) ?? null);
  const inherits = draft.inherit;
  // Left to the defaults: no model and no effort of its own -- the department's, else the company's, apply when it runs.
  const execution: ExecutionProfile | null =
    connection === null
      ? null
      : inherits
        ? { runtime: connection.runtime, connectionId: connection.id, model: "", effort: null, webSearch, orbitPlugin, inherit: [...INHERITED] }
        : model !== null
          ? { runtime: connection.runtime, connectionId: connection.id, model: model.id, effort, webSearch, orbitPlugin }
          : null;
  const inherited = connection !== null && inherits ? defaultsInWords(t, connection, department, companyDefaults) : null;

  const body: HireEmployeeRequest | null =
    execution && resources
      ? {
          name: draft.name.trim(),
          departmentId: isCeo ? null : (department?.id ?? null),
          managerId: null,
          templateId: isCeo ? null : draft.templateId,
          profile: {
            title: draft.title.trim(),
            duties: draft.duties.trim(),
            instructions: draft.instructions.trim(),
            skills: list(draft.skills),
            languages: list(draft.languages),
            knowledge: [],
            execution,
            handoffStandard: draft.handoffStandard.trim(),
            reportingRule: draft.reportingRule.trim(),
            canDelegate: isCeo ? false : draft.canDelegate,
            maxAssistants: draft.maxAssistants,
            canHirePermanent: false,
          },
          resources,
          ...(draft.skipProbation ? { skipProbation: true, skipReason: draft.skipReason.trim() } : {}),
          ...(isCeo ? { appointRole: "ceo" as const, ...(draft.appointReason.trim() !== "" ? { appointReason: draft.appointReason.trim() } : {}) } : {}),
        }
      : null;

  // What still stands between each step and the next.
  const missing: string[][] = [
    draft.name.trim() === "" ? [t("office.hire.missingName")] : [],
    draft.title.trim() === "" ? [t("office.hire.missingTitle")] : [],
    connection === null ? [t("office.hire.missingConnection")] : model === null && !inherits ? [t("office.hire.missingModel")] : [],
    resources === null ? [t("office.hire.missingResources")] : [...resourceProblems(resources, summary.data?.budget.perEmployee ?? null), ...(storageProblem(resources, summary.data) ? [storageProblem(resources, summary.data) as string] : [])],
    body === null ? [t("office.hire.missingSomething")] : draft.skipProbation && draft.skipReason.trim() === "" ? [t("office.hire.missingSkipReason")] : [],
  ];
  const blocked = missing[at] ?? [];

  const template = (id: string) => {
    const t = (templates.data ?? []).find((x) => x.id === id);
    if (!t) return set({ templateId: null });
    const p = t.profile;
    set({ templateId: t.id, title: p.title, duties: p.duties, instructions: p.instructions, skills: p.skills.join(", "), languages: p.languages.join(", "), handoffStandard: p.handoffStandard, reportingRule: p.reportingRule, maxAssistants: p.maxAssistants });
  };

  const hire = async () => {
    if (body === null) return;
    const checked = checkHireEmployee(body);
    if (!checked.ok) return setFailure(new Error(checked.errors.join("; ")));
    setBusy(true);
    setFailure(null);
    try {
      onHired(await office.hire(body));
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const subscriptionNote = connection?.method === "subscription" ? (connection.runtime === "claude" ? null : (connections.data?.methods.find((m) => m.runtime === connection.runtime && m.method === "subscription")?.note ?? t("office.hire.subscriptionDefaultNote"))) : null;

  const dialogTitle = isCeo ? t("office.hire.ceoTitle") : t("office.hire.title");

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={mergeClasses("orbit-touch", isMobile ? s.surfaceMobile : s.surface)} aria-label={dialogTitle}>
        <DialogBody className={s.dialogBody}>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogContent className={s.body}>
            <Steps steps={steps} at={at} onSelect={setAt} />
            <Text weight="semibold" size={400} as="h3">
              {t("office.hire.stepHeading", { step: at + 1, total: steps.length, label: steps[at] })}
            </Text>

            {at === 0 && (
              <div className={o.form}>
                {isCeo && (
                  <MessageBar intent="info" layout="multiline">
                    <MessageBarBody>{t("office.hire.ceoBanner")}</MessageBarBody>
                  </MessageBar>
                )}
                <div className={o.formGrid}>
                  <Field label={t("office.hire.nameLabel")} required hint={t("office.hire.nameHint")}>
                    <Input value={draft.name} maxLength={80} onChange={(_, d) => set({ name: d.value })} />
                  </Field>
                  {!isCeo && (
                    <Field label={t("office.hire.templateLabel")} hint={t("office.hire.templateHint")}>
                      <Select value={draft.templateId ?? ""} onChange={(_, d) => template(d.value)}>
                        <option value="">{t("office.hire.noTemplate")}</option>
                        {(templates.data ?? []).map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label={t("office.hire.languagesLabel")} hint={t("office.hire.languagesHint")}>
                    <Input value={draft.languages} onChange={(_, d) => set({ languages: d.value })} />
                  </Field>
                </div>
              </div>
            )}

            {at === 1 && (
              <div className={o.form}>
                {!isCeo && (
                  <DraftWithAi
                    form={{ title: draft.title, duties: draft.duties, instructions: draft.instructions, skills: draft.skills, languages: draft.languages, handoffStandard: draft.handoffStandard }}
                    departmentId={department?.id ?? null}
                    departmentName={department?.name ?? null}
                    state={executiveState.data}
                    onFill={(f) => set({ title: f.title, duties: f.duties, instructions: f.instructions, skills: f.skills, languages: f.languages, handoffStandard: f.handoffStandard })}
                  />
                )}
                <div className={o.formGrid}>
                  {isCeo ? (
                    <Field label={t("office.hire.choiceDept")} hint={t("office.hire.ceoDepartmentHint")}>
                      <Input value={t("office.hire.ceoDepartmentValue")} readOnly disabled />
                    </Field>
                  ) : (
                    <Field label={t("office.hire.choiceDept")}>
                      <Select value={draft.departmentId ?? ""} onChange={(_, d) => set({ departmentId: d.value === "" ? null : d.value })}>
                        <option value="">{t("office.overview.unassigned")}</option>
                        {live.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label={t("office.hire.roleTitleLabel")} required>
                    <Input value={draft.title} maxLength={120} onChange={(_, d) => set({ title: d.value })} />
                  </Field>
                </div>
                <Field label={t("office.hire.dutiesLabel")} hint={t("office.hire.dutiesHint")}>
                  <Textarea value={draft.duties} resize="vertical" onChange={(_, d) => set({ duties: d.value })} />
                </Field>
                <Field label={t("office.hire.instructionsLabel")} hint={t("office.hire.instructionsHint")}>
                  <Textarea value={draft.instructions} resize="vertical" onChange={(_, d) => set({ instructions: d.value })} />
                </Field>
                <div className={o.formGrid}>
                  <Field label={t("office.hire.skillsLabel")} hint={t("office.hire.languagesHint")}>
                    <Input value={draft.skills} onChange={(_, d) => set({ skills: d.value })} />
                  </Field>
                  <Field label={t("office.hire.handoffLabel")} hint={t("office.hire.handoffHint")}>
                    <Input value={draft.handoffStandard} onChange={(_, d) => set({ handoffStandard: d.value })} />
                  </Field>
                </div>
                {isCeo ? (
                  <Text size={200} className={o.muted}>
                    {t("office.hire.ceoAuthorityNote")}
                  </Text>
                ) : (
                  <div className={s.option}>
                    <Switch label={t("office.hire.teamLeadLabel")} checked={draft.canDelegate} onChange={(_, d) => set({ canDelegate: d.checked })} />
                    <Text size={200}>
                      {t("office.hire.teamLeadDesc")}
                    </Text>
                  </div>
                )}
                <AssistantsField value={draft.maxAssistants} onChange={(v) => set({ maxAssistants: v })} />
              </div>
            )}

            {at === 2 && (
              <div className={o.form}>
                {connections.data === null ? (
                  <Spinner size="tiny" label={t("office.hire.readingConnections")} />
                ) : (
                  <>
                    <Field label={t("office.hire.connectionLabel")} hint={t("office.hire.connectionHint")}>
                      <RadioGroup value={connection?.id ?? ""} onChange={(_, d) => set({ connectionId: d.value, model: null, effort: null, webSearch: false, orbitPlugin: false })}>
                        {all.map((c) => (
                          <Radio key={c.id} value={c.id} disabled={!usableForEmployees(c)} label={`${RUNTIME_LABELS[c.runtime]} — ${c.label}${usableForEmployees(c) ? "" : `: ${whyNot(c)}`}`} />
                        ))}
                      </RadioGroup>
                    </Field>
                    {all.length === 0 && (
                      <Text size={200}>
                        {t("office.hire.noConnectionYet")}
                        <Link href={settingsHref("ai-connections")}>{t("office.hire.connectInSettings")}</Link>.
                      </Text>
                    )}
                    {connection && <Checkbox checked={inherits} onChange={(_, d) => set({ inherit: d.checked === true })} label={t(isCeo ? "office.hire.ceoInheritLabel" : "office.hire.inheritLabel")} />}
                    {connection && inherits && <DefaultsThatApply connection={connection} department={department} company={companyDefaults} />}
                    {connection && !inherits && (
                      <div className={o.formGrid}>
                        <Field label={t("office.hire.modelLabel")} hint={t("office.hire.modelHint")}>
                          <Select value={model?.id ?? ""} onChange={(_, d) => set({ model: d.value, effort: null })}>
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                                {connection.catalog.recommended === m.id ? t("office.hire.recommendedSuffix") : ""}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={t("office.hire.effortLabel")} hint={model && model.efforts.length === 0 ? t("office.hire.effortNoLevelHint") : t("office.hire.effortHint")}>
                          <Select value={effort ?? ""} disabled={model === null || model.efforts.length === 0} onChange={(_, d) => set({ effort: d.value })}>
                            {model?.efforts.length === 0 && <option value="">{t("office.hire.noEffortOption")}</option>}
                            {(model?.efforts ?? []).map((e) => (
                              <option key={e} value={e}>
                                {effortLabel(e)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    )}
                    {connection &&
                      (connection.capabilities.webSearch === "yes" ? (
                        <Switch label={t("office.hire.webSearchLabel")} checked={draft.webSearch} onChange={(_, d) => set({ webSearch: d.checked })} />
                      ) : (
                        <Text size={200} className={o.muted}>
                          {t("office.hire.webSearchOff", { why: connection.capabilities.webSearch === "no" ? t("office.hire.webSearchNone") : t("office.hire.webSearchUnknown") })}
                        </Text>
                      ))}
                    {connection?.runtime === "claude" &&
                      (pluginAllowed(connection) ? (
                        <Switch label={t("office.hire.pluginLabel")} checked={draft.orbitPlugin} onChange={(_, d) => set({ orbitPlugin: d.checked })} />
                      ) : (
                        <Text size={200} className={o.muted}>
                          {t("office.hire.pluginNotApproved")}
                          <Link href={settingsHref("ai-connections")}>{t("office.hire.pluginSettingsLink")}</Link>
                        </Text>
                      ))}
                  </>
                )}
              </div>
            )}

            {at === 3 && resources && <ResourceFields value={resources} onChange={(p) => set({ resources: p })} presets={presets} summary={summary.data} runtime={connection?.runtime ?? null} />}

            {at === 4 && body && connection && resources && (
              <div className={o.form}>
                <dl className={o.dl} aria-label={t("office.hire.choicesAria")}>
                  <dt className={o.dt}>{t("office.hire.choiceName")}</dt>
                  <dd className={o.dd}>{body.name}</dd>
                  <dt className={o.dt}>{t("office.hire.choiceRole")}</dt>
                  <dd className={o.dd}>{body.profile.title}</dd>
                  <dt className={o.dt}>{t("office.hire.choiceDept")}</dt>
                  <dd className={o.dd}>{isCeo ? t("office.hire.ceoDepartmentValue") : (department?.name ?? t("office.overview.unassigned"))}</dd>
                  {isCeo ? (
                    <>
                      <dt className={o.dt}>{t("office.hire.choiceAppointment")}</dt>
                      <dd className={o.dd}>{t("office.hire.choiceAppointmentCeo")}</dd>
                    </>
                  ) : (
                    <>
                      <dt className={o.dt}>{t("office.hire.choiceTeamLead")}</dt>
                      <dd className={o.dd}>{draft.canDelegate ? t("office.hire.teamLeadYes") : t("office.hire.teamLeadNo")}</dd>
                    </>
                  )}
                  <dt className={o.dt}>{t("office.hire.choiceAssistants")}</dt>
                  <dd className={o.dd}>{draft.maxAssistants === 0 ? t("office.hire.assistantsNone") : String(draft.maxAssistants)}</dd>
                  <dt className={o.dt}>{t("office.hire.choiceRuntime")}</dt>
                  <dd className={o.dd}>
                    {RUNTIME_LABELS[connection.runtime]} — {connection.label}
                  </dd>
                  <dt className={o.dt}>{t("office.hire.choiceModel")}</dt>
                  <dd className={o.dd}>{inherited !== null ? inherited.model : (model?.label ?? "")}</dd>
                  <dt className={o.dt}>{t("office.hire.choiceEffort")}</dt>
                  <dd className={o.dd}>{inherited !== null ? inherited.effort : effort ? effortLabel(effort) : t("office.hire.effortNone")}</dd>
                  <dt className={o.dt}>{t("office.hire.choiceWebSearch")}</dt>
                  <dd className={o.dd}>{webSearch ? t("office.hire.on") : t("office.hire.off")}</dd>
                  <dt className={o.dt}>{t("office.hire.choicePlugin")}</dt>
                  <dd className={o.dd}>{orbitPlugin ? t("office.hire.on") : t("office.hire.off")}</dd>
                  <dt className={o.dt}>{t("office.hire.choiceResources")}</dt>
                  <dd className={o.dd}>
                    {resources.presetId ? t("office.hire.presetNameSuffix", { name: presets.find((p) => p.id === resources.presetId)?.name ?? resources.presetId }) : t("office.hire.customPreset")}: {profileLine(resources)}
                  </dd>
                  <dt className={o.dt}>{t("office.hire.choiceLimits")}</dt>
                  <dd className={o.dd}>
                    {t("office.hire.limitsSummary", { scratch: sizeText(resources.scratchStorageMiB), cache: sizeText(resources.cacheStorageMiB), pids: resources.pidsLimit, timeout: resources.timeoutMinutes })}
                  </dd>
                </dl>
                {inherited !== null && inherited.warnings.length > 0 && (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>{inherited.warnings.join(" ")}</MessageBarBody>
                  </MessageBar>
                )}
                <MessageBar intent="info" layout="multiline">
                  <MessageBarBody>
                    <Text weight="semibold" size={200} block>
                      {t("office.hire.estimatedAvailability")}
                    </Text>
                    <Text size={200}>{availability(resources, summary.data, connection.runtime)}</Text>
                  </MessageBarBody>
                </MessageBar>
                <Disclosure />
                {connection.method === "subscription" && (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>
                      <Text weight="semibold" size={200} block>
                        {t("office.hire.subscriptionTitle")}
                      </Text>
                      {connection.runtime === "claude" ? (
                        <>
                          <blockquote className={s.quote}>
                            <Text size={200}>“{CLAUDE_PLAN_NOTE.quote}”</Text>
                          </blockquote>
                          <Text size={200}>
                            {t("office.hire.subscriptionClaudeHint")}
                            <Link href={CLAUDE_PLAN_NOTE.source} target="_blank" rel="noopener noreferrer">
                              {t("office.hire.sourceLink")}
                            </Link>
                          </Text>
                        </>
                      ) : (
                        <Text size={200}>{subscriptionNote}</Text>
                      )}
                    </MessageBarBody>
                  </MessageBar>
                )}
                {isCeo && (
                  <Field label={t("office.hire.appointReasonLabel")} hint={t("office.hire.appointReasonHint")}>
                    <Input value={draft.appointReason} maxLength={WORKFORCE_LIMITS.noteLength} placeholder={t("office.hire.appointReasonPlaceholder")} onChange={(_, d) => set({ appointReason: d.value })} />
                  </Field>
                )}
                <Checkbox checked={draft.skipProbation} onChange={(_, d) => set({ skipProbation: d.checked === true })} label={t("office.hire.skipProbationLabel")} />
                {draft.skipProbation && (
                  <Field label={t("office.hire.skipReasonLabel")} required hint={t("office.hire.skipReasonHint")}>
                    <Input value={draft.skipReason} onChange={(_, d) => set({ skipReason: d.value })} />
                  </Field>
                )}
                {!draft.skipProbation && (
                  <Text size={200} className={o.muted}>
                    {t("office.hire.probationNote")}
                  </Text>
                )}
              </div>
            )}

            {blocked.length > 0 && (
              <Text size={200} className={o.muted} role="status">
                {t("office.hire.toContinue", { reasons: blocked.join(" ") })}
              </Text>
            )}
            {failure !== null &&
              (isConnectionRequired(failure) ? (
                <ConnectionRequired />
              ) : (
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>
                    {errorText(failure)}
                    {reasonsOf(failure).length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: "18px" }}>
                        {reasonsOf(failure).map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </MessageBarBody>
                </MessageBar>
              ))}
          </DialogContent>
          <DialogActions className={s.dialogActions}>
            <Button onClick={onClose}>{t("office.assign.cancel")}</Button>
            {at > 0 && <Button onClick={() => setAt(at - 1)}>{t("office.hire.back")}</Button>}
            {at < steps.length - 1 ? (
              <Button appearance="primary" disabled={blocked.length > 0} onClick={() => setAt(at + 1)}>
                {t("office.hire.next")}
              </Button>
            ) : (
              <Button appearance="primary" disabled={busy || blocked.length > 0} onClick={() => void hire()}>
                {busy ? t(isCeo ? "office.hire.hiringCeo" : "office.hire.hiring") : t(isCeo ? "office.hire.hireCeo" : "office.hire.hire")}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
