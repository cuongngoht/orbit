// HIRE AN EMPLOYEE, in five steps: who it is; its department and role; the AI runtime it runs on, with a model and an
// effort level from that connection's own catalog; its Personal Sandbox and resources; then everything once more, with
// when it can take work, before it is hired. Only a connection that is connected and read its models from the account
// is offered -- an employee never runs on a fallback list -- and nothing switches to another provider by itself.
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
  checkHireEmployee,
  effortFor,
  effortLabel,
  type Department,
  type EmployeeDetail,
  type EmployeeTemplate,
  type HireEmployeeRequest,
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
import { ApiError, errorText } from "../../services/api";
import { useConnections } from "../connections/AiConnectionsSection";
import { cpuText, sizeText } from "../resources/format";
import { useResourceSummary } from "../resources/ComputeStorageSection";
import { office } from "./api";
import { Disclosure, useOfficeStyles } from "./parts";
import { ResourceFields, profileLine, resourceProblems, storageProblem } from "./ResourceFields";

export const HIRE_STEPS = ["Identity", "Department & role", "AI runtime, model & effort", "Personal sandbox & resources", "Review & hire"] as const;

const useStyles = makeStyles({
  surface: { width: "min(960px, 96vw)", maxWidth: "min(960px, 96vw)", maxHeight: "92dvh" },
  surfaceMobile: { width: "100vw", maxWidth: "100vw", height: "var(--orbit-app-height, 100dvh)", maxHeight: "var(--orbit-app-height, 100dvh)", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, borderRadius: 0 },
  steps: { display: "flex", gap: "6px", flexWrap: "wrap", listStyleType: "none", margin: 0, paddingLeft: 0 },
  step: { display: "inline-flex", alignItems: "center", gap: "6px", paddingTop: "4px", paddingRight: "10px", paddingBottom: "4px", paddingLeft: "6px", borderRadius: "9999px", backgroundColor: tokens.colorNeutralBackground2, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  stepOn: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  dot: { width: "20px", height: "20px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: tokens.colorNeutralBackground5, fontSize: tokens.fontSizeBase100 },
  body: { display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 },
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
  webSearch: boolean;
  orbitPlugin: boolean;
  resources: ResourceProfile | null;
  skipProbation: boolean;
  skipReason: string;
}

const EMPTY: Draft = { name: "", templateId: null, languages: "", departmentId: null, title: "", duties: "", instructions: "", skills: "", handoffStandard: "", reportingRule: "", connectionId: null, model: null, effort: null, webSearch: false, orbitPlugin: false, resources: null, skipProbation: false, skipReason: "" };

const list = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

// A connection an employee may run on: connected, and its models read from the account (never a fallback list).
export const usableForEmployees = (c: RuntimeConnection): boolean => c.auth === "connected" && c.catalog.source === "account" && c.catalog.models.length > 0;

const whyNot = (c: RuntimeConnection): string => (c.auth !== "connected" ? `not connected (${c.reason ?? "its CLI says it is not signed in"})` : c.catalog.source !== "account" ? "its models were not read from the account" : "its account offers no model");

// The Orbit plugin may be asked for an employee only on Claude Code, with the owner's grant for employees on exactly the
// plugin's current version.
const pluginAllowed = (c: RuntimeConnection): boolean => c.runtime === "claude" && c.plugins !== null && c.plugins.installed && c.plugins.useCases.employee.approved && !c.plugins.useCases.employee.needsConfirmation;

// What Anthropic's page says of a subscription used by something that works on its own, quoted with its source.
const CLAUDE_PLAN_NOTE = { quote: "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK.", source: "https://code.claude.com/docs/en/legal-and-compliance" };

// When the employee could take work, from what the account holds now.
export function availability(p: ResourceProfile, summary: ResourceSummary | null, runtime: string | null): string {
  const sandbox = "Its Personal Sandbox is prepared first (its desk, toolbox and quotas; no container starts), and it takes work once that is ready.";
  if (summary === null) return `${sandbox} Whether its work could start at once is not known: the account's budget could not be read.`;
  const overhead = summary.modelPlane.find((m) => m.runtime === runtime) ?? { cpuMillis: 0, memoryMiB: 0 };
  const cpu = p.cpuMillis + overhead.cpuMillis;
  const memory = p.memoryMiB + overhead.memoryMiB;
  const needs = `${cpuText(cpu)} and ${sizeText(memory)} of memory per attempt`;
  if (cpu > summary.budget.cpuMillis || memory > summary.budget.memoryMiB || cpu > summary.capacity.usable.cpuMillis || memory > summary.capacity.usable.memoryMiB)
    return `${sandbox} As configured its work could never start: it needs ${needs}, above the account's budget (${cpuText(summary.budget.cpuMillis)}, ${sizeText(summary.budget.memoryMiB)}) or what this host can give.`;
  if (cpu <= summary.available.cpuMillis && memory <= summary.available.memoryMiB) return `${sandbox} Its work could start at once: it needs ${needs}, and that is free now.`;
  return `${sandbox} Its work would wait for resources: it needs ${needs}; ${cpuText(summary.available.cpuMillis)} and ${sizeText(summary.available.memoryMiB)} are free now. It is hired all the same.`;
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

function Steps({ at }: { at: number }) {
  const s = useStyles();
  return (
    <ol className={s.steps} aria-label="Steps">
      {HIRE_STEPS.map((label, i) => (
        <li key={label} className={mergeClasses(s.step, i === at && s.stepOn)} aria-current={i === at ? "step" : undefined}>
          <span className={s.dot} aria-hidden>
            {i + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function HireWizard({ departments, onClose, onHired }: { departments: Department[]; onClose: () => void; onHired: (e: EmployeeDetail) => void }) {
  const s = useStyles();
  const o = useOfficeStyles();
  const { isMobile } = useViewport();
  const connections = useConnections();
  const summary = useResourceSummary();
  const templates = useResource<EmployeeTemplate[]>(() => office.templates(), []);
  const presetsRead = useResource<ResourcePreset[]>(() => office.presets(), []);
  const presets: readonly ResourcePreset[] = presetsRead.data ?? (presetsRead.error ? DEFAULT_PRESETS : []);
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
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
  const department = live.find((d) => d.id === draft.departmentId) ?? null;

  const body: HireEmployeeRequest | null =
    connection && model && resources
      ? {
          name: draft.name.trim(),
          departmentId: department?.id ?? null,
          managerId: null,
          templateId: draft.templateId,
          profile: {
            title: draft.title.trim(),
            duties: draft.duties.trim(),
            instructions: draft.instructions.trim(),
            skills: list(draft.skills),
            languages: list(draft.languages),
            knowledge: [],
            execution: { runtime: connection.runtime, connectionId: connection.id, model: model.id, effort, webSearch, orbitPlugin },
            handoffStandard: draft.handoffStandard.trim(),
            reportingRule: draft.reportingRule.trim(),
            canDelegate: false,
            maxAssistants: 0,
            canHirePermanent: false,
          },
          resources,
          ...(draft.skipProbation ? { skipProbation: true, skipReason: draft.skipReason.trim() } : {}),
        }
      : null;

  // What still stands between each step and the next.
  const missing: string[][] = [
    draft.name.trim() === "" ? ["Give it a name."] : [],
    draft.title.trim() === "" ? ["Give it a role title."] : [],
    connection === null ? ["Choose a connected AI CLI with models read from your account."] : model === null ? ["Choose a model."] : [],
    resources === null ? ["Choose a preset or your own numbers."] : [...resourceProblems(resources, summary.data?.budget.perEmployee ?? null), ...(storageProblem(resources, summary.data) ? [storageProblem(resources, summary.data) as string] : [])],
    body === null ? ["Something above is missing."] : draft.skipProbation && draft.skipReason.trim() === "" ? ["Say why the trial is skipped: it is recorded with the decision."] : [],
  ];
  const blocked = missing[at] ?? [];

  const template = (id: string) => {
    const t = (templates.data ?? []).find((x) => x.id === id);
    if (!t) return set({ templateId: null });
    const p = t.profile;
    set({ templateId: t.id, title: p.title, duties: p.duties, instructions: p.instructions, skills: p.skills.join(", "), languages: p.languages.join(", "), handoffStandard: p.handoffStandard, reportingRule: p.reportingRule });
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

  const subscriptionNote = connection?.method === "subscription" ? (connection.runtime === "claude" ? null : (connections.data?.methods.find((m) => m.runtime === connection.runtime && m.method === "subscription")?.note ?? "Your provider's plan limits assume ordinary, individual use.")) : null;

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={isMobile ? s.surfaceMobile : s.surface} aria-label="Hire an employee">
        <DialogBody>
          <DialogTitle>Hire an employee</DialogTitle>
          <DialogContent className={s.body}>
            <Steps at={at} />
            <Text weight="semibold" size={400} as="h3">
              Step {at + 1} of 5: {HIRE_STEPS[at]}
            </Text>

            {at === 0 && (
              <div className={o.formGrid}>
                <Field label="Name" required hint="How the office names it.">
                  <Input value={draft.name} maxLength={80} onChange={(_, d) => set({ name: d.value })} />
                </Field>
                <Field label="Start from a template" hint="Optional: fills the role, which you can change.">
                  <Select value={draft.templateId ?? ""} onChange={(_, d) => template(d.value)}>
                    <option value="">No template</option>
                    {(templates.data ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Languages" hint="Optional, separated by commas.">
                  <Input value={draft.languages} onChange={(_, d) => set({ languages: d.value })} />
                </Field>
              </div>
            )}

            {at === 1 && (
              <div className={o.form}>
                <div className={o.formGrid}>
                  <Field label="Department">
                    <Select value={draft.departmentId ?? ""} onChange={(_, d) => set({ departmentId: d.value === "" ? null : d.value })}>
                      <option value="">Unassigned</option>
                      {live.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Role title" required>
                    <Input value={draft.title} maxLength={120} onChange={(_, d) => set({ title: d.value })} />
                  </Field>
                </div>
                <Field label="Duties" hint="What it is responsible for.">
                  <Textarea value={draft.duties} resize="vertical" onChange={(_, d) => set({ duties: d.value })} />
                </Field>
                <Field label="Instructions" hint="How it should work.">
                  <Textarea value={draft.instructions} resize="vertical" onChange={(_, d) => set({ instructions: d.value })} />
                </Field>
                <div className={o.formGrid}>
                  <Field label="Skills" hint="Optional, separated by commas.">
                    <Input value={draft.skills} onChange={(_, d) => set({ skills: d.value })} />
                  </Field>
                  <Field label="Handoff standard" hint="Optional: what every result it hands in must hold.">
                    <Input value={draft.handoffStandard} onChange={(_, d) => set({ handoffStandard: d.value })} />
                  </Field>
                </div>
              </div>
            )}

            {at === 2 && (
              <div className={o.form}>
                {connections.data === null ? (
                  <Spinner size="tiny" label="Reading your AI connections…" />
                ) : (
                  <>
                    <Field label="AI connection" hint="Only a connection that is connected, with its models read from your account, can run an employee.">
                      <RadioGroup value={connection?.id ?? ""} onChange={(_, d) => set({ connectionId: d.value, model: null, effort: null, webSearch: false, orbitPlugin: false })}>
                        {all.map((c) => (
                          <Radio key={c.id} value={c.id} disabled={!usableForEmployees(c)} label={`${RUNTIME_LABELS[c.runtime]} — ${c.label}${usableForEmployees(c) ? "" : `: ${whyNot(c)}`}`} />
                        ))}
                      </RadioGroup>
                    </Field>
                    {all.length === 0 && (
                      <Text size={200}>
                        No AI connection yet. <Link href={settingsHref("ai-connections")}>Connect one in Settings → AI Connections</Link>.
                      </Text>
                    )}
                    {connection && (
                      <div className={o.formGrid}>
                        <Field label="Model" hint="From this connection's own catalog.">
                          <Select value={model?.id ?? ""} onChange={(_, d) => set({ model: d.value, effort: null })}>
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                                {connection.catalog.recommended === m.id ? " (recommended)" : ""}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Effort" hint={model && model.efforts.length === 0 ? "This model takes no effort level." : "How thoroughly it works."}>
                          <Select value={effort ?? ""} disabled={model === null || model.efforts.length === 0} onChange={(_, d) => set({ effort: d.value })}>
                            {model?.efforts.length === 0 && <option value="">No effort level</option>}
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
                        <Switch label="Web search (the runtime's own search)" checked={draft.webSearch} onChange={(_, d) => set({ webSearch: d.checked })} />
                      ) : (
                        <Text size={200} className={o.muted}>
                          Web search: not offered — this connection's CLI has no search Orbit can switch ({connection.capabilities.webSearch === "no" ? "it has none" : "not known"}).
                        </Text>
                      ))}
                    {connection?.runtime === "claude" &&
                      (pluginAllowed(connection) ? (
                        <Switch label="Orbit plugin (its skills; its hooks never run for an employee)" checked={draft.orbitPlugin} onChange={(_, d) => set({ orbitPlugin: d.checked })} />
                      ) : (
                        <Text size={200} className={o.muted}>
                          Orbit plugin: not approved for employees on this connection. <Link href={settingsHref("ai-connections")}>Settings → AI Connections → Claude Code → Plugins</Link>
                        </Text>
                      ))}
                  </>
                )}
              </div>
            )}

            {at === 3 && resources && <ResourceFields value={resources} onChange={(p) => set({ resources: p })} presets={presets} summary={summary.data} runtime={connection?.runtime ?? null} />}

            {at === 4 && body && connection && model && resources && (
              <div className={o.form}>
                <dl className={o.dl} aria-label="Your choices">
                  <dt className={o.dt}>Name</dt>
                  <dd className={o.dd}>{body.name}</dd>
                  <dt className={o.dt}>Role</dt>
                  <dd className={o.dd}>{body.profile.title}</dd>
                  <dt className={o.dt}>Department</dt>
                  <dd className={o.dd}>{department?.name ?? "Unassigned"}</dd>
                  <dt className={o.dt}>Runtime</dt>
                  <dd className={o.dd}>
                    {RUNTIME_LABELS[connection.runtime]} — {connection.label}
                  </dd>
                  <dt className={o.dt}>Model</dt>
                  <dd className={o.dd}>{model.label}</dd>
                  <dt className={o.dt}>Effort</dt>
                  <dd className={o.dd}>{effort ? effortLabel(effort) : "None (this model takes none)"}</dd>
                  <dt className={o.dt}>Web search</dt>
                  <dd className={o.dd}>{webSearch ? "On" : "Off"}</dd>
                  <dt className={o.dt}>Orbit plugin</dt>
                  <dd className={o.dd}>{orbitPlugin ? "On" : "Off"}</dd>
                  <dt className={o.dt}>Resources</dt>
                  <dd className={o.dd}>
                    {resources.presetId ? `${presets.find((p) => p.id === resources.presetId)?.name ?? resources.presetId} preset` : "Custom"}: {profileLine(resources)}
                  </dd>
                  <dt className={o.dt}>Limits and quotas</dt>
                  <dd className={o.dd}>
                    scratch {sizeText(resources.scratchStorageMiB)}, cache {sizeText(resources.cacheStorageMiB)}, {resources.pidsLimit} processes, {resources.timeoutMinutes} minutes per attempt
                  </dd>
                </dl>
                <MessageBar intent="info" layout="multiline">
                  <MessageBarBody>
                    <Text weight="semibold" size={200} block>
                      Estimated availability
                    </Text>
                    <Text size={200}>{availability(resources, summary.data, connection.runtime)}</Text>
                  </MessageBarBody>
                </MessageBar>
                <Disclosure />
                {connection.method === "subscription" && (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>
                      <Text weight="semibold" size={200} block>
                        A subscription sign-in
                      </Text>
                      {connection.runtime === "claude" ? (
                        <>
                          <blockquote className={s.quote}>
                            <Text size={200}>“{CLAUDE_PLAN_NOTE.quote}”</Text>
                          </blockquote>
                          <Text size={200}>
                            An API key is recommended for an employee that works on its own. <Link href={CLAUDE_PLAN_NOTE.source} target="_blank" rel="noopener noreferrer">Source</Link>
                          </Text>
                        </>
                      ) : (
                        <Text size={200}>{subscriptionNote}</Text>
                      )}
                    </MessageBarBody>
                  </MessageBar>
                )}
                <Checkbox checked={draft.skipProbation} onChange={(_, d) => set({ skipProbation: d.checked === true })} label="Skip the trial: it starts active, without probation work" />
                {draft.skipProbation && (
                  <Field label="Why the trial is skipped" required hint="Recorded with the decision.">
                    <Input value={draft.skipReason} onChange={(_, d) => set({ skipReason: d.value })} />
                  </Field>
                )}
                {!draft.skipProbation && (
                  <Text size={200} className={o.muted}>
                    It starts on probation: you activate it once its trial work is done.
                  </Text>
                )}
              </div>
            )}

            {blocked.length > 0 && (
              <Text size={200} className={o.muted} role="status">
                To continue: {blocked.join(" ")}
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
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            {at > 0 && <Button onClick={() => setAt(at - 1)}>Back</Button>}
            {at < HIRE_STEPS.length - 1 ? (
              <Button appearance="primary" disabled={blocked.length > 0} onClick={() => setAt(at + 1)}>
                Next
              </Button>
            ) : (
              <Button appearance="primary" disabled={busy || blocked.length > 0} onClick={() => void hire()}>
                {busy ? "Hiring…" : "Hire"}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
