// RECRUIT: the owner's HIRING REQUEST (ADR 0062, staffing). One request -- what the company needs, for one department or
// the whole company -- and the CEO plans who to hire (and the departments to make, each with its manager); Orbit then
// hires them at once, on probation, on the connection, model and resources chosen HERE: the CEO never picks one. The
// dialog follows the request to its end -- the CEO planning (or waiting, and why), then who was hired, the departments
// made and the managers appointed, or why nothing was -- and the conversation stays in CEO Chat to read again.
import {
  Button,
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
  Switch,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
} from "@fluentui/react-components";
import {
  DEFAULT_PRESETS,
  RUNTIME_LABELS,
  STAFFING_LIMITS,
  effortFor,
  effortLabel,
  type Department,
  type ExecutionDefaults,
  type ExecutionProfile,
  type ExecutiveTurn,
  type HiringRequest,
  type ResourcePreset,
  type Roster,
  type StaffingAccepted,
  type StaffingView,
} from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { settingsHref } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { errorText, newIdempotencyKey } from "../../services/api";
import { useConnections } from "../connections/AiConnectionsSection";
import { executive } from "../executive/api";
import { useResourceSummary } from "../resources/ComputeStorageSection";
import { office } from "./api";
import { DefaultsThatApply, INHERITED, usableForEmployees } from "./HireWizard";
import { useOfficeStyles } from "./parts";
import { profileLine } from "./ResourceFields";

const useStyles = makeStyles({
  surface: { width: "min(640px, calc(100vw - 32px))", maxWidth: "640px" },
  surfaceMobile: { width: "100vw", maxWidth: "100vw", height: "100dvh", maxHeight: "100dvh", borderRadius: 0 },
  body: { display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 },
});

// How often the request is read again while the CEO plans it.
const POLL_MS = 1500;

export function RecruitDialog({
  departments,
  departmentId = null,
  companyDefaults = null,
  ceoName = null,
  onClose,
  onOpenEmployee,
  onSent,
}: {
  departments: Department[];
  departmentId?: string | null;
  companyDefaults?: ExecutionDefaults | null;
  ceoName?: string | null;
  onClose: () => void;
  onOpenEmployee?: (employeeId: string) => void;
  // Where the request goes once sent (CEO Chat opens its conversation); without it the dialog follows the request.
  onSent?: (accepted: StaffingAccepted) => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const { isMobile } = useViewport();
  const connections = useConnections();
  const summary = useResourceSummary();
  const presetsRead = useResource<ResourcePreset[]>(() => office.presets(), []);
  const presets: readonly ResourcePreset[] = presetsRead.data ?? (presetsRead.error ? DEFAULT_PRESETS : []);
  const live = departments.filter((d) => !d.archived);
  const [requirement, setRequirement] = useState("");
  const [scope, setScope] = useState<string>(departmentId ?? "");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [inherit, setInherit] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [effortPick, setEffortPick] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [key] = useState(() => newIdempotencyKey());
  const [sent, setSent] = useState<StaffingAccepted | null>(null);
  const [view, setView] = useState<StaffingView | null>(null);
  const [turn, setTurn] = useState<ExecutiveTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const usable = (connections.data?.connections ?? []).filter(usableForEmployees);
  const connection = usable.find((c) => c.id === connectionId) ?? usable.find((c) => c.isDefault) ?? usable[0] ?? null;
  const models = connection?.catalog.models ?? [];
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === connection?.catalog.recommended) ?? models[0] ?? null;
  const effort = model === null || model.efforts.length === 0 ? null : effortPick !== null && model.efforts.includes(effortPick as never) ? effortPick : effortFor(model, "medium");
  const preset = presets.find((p) => p.id === presetId) ?? presets[0] ?? null;
  const department = live.find((d) => d.id === scope) ?? null;
  const execution: ExecutionProfile | null =
    connection === null ? null : inherit ? { runtime: connection.runtime, connectionId: connection.id, model: "", effort: null, webSearch: false, orbitPlugin: false, inherit: [...INHERITED] } : model !== null ? { runtime: connection.runtime, connectionId: connection.id, model: model.id, effort, webSearch: false, orbitPlugin: false } : null;
  const storage = summary.data?.storage ?? null;
  const each = preset === null ? 0 : preset.profile.deskStorageMiB + preset.profile.cacheStorageMiB;
  // What the storage budget holds now, as the API will count it (it says so again when the request is sent).
  const fit = storage === null || each <= 0 ? null : Math.min(STAFFING_LIMITS.hires, Math.max(0, Math.floor((storage.budgetMiB - storage.committedMiB) / each)));
  const body: HiringRequest | null = execution !== null && preset !== null && requirement.trim().length > 0 ? { requirement: requirement.trim(), departmentId: department?.id ?? null, execution, resources: preset.profile } : null;
  const ceo = ceoName ?? t("office.recruit.theCeo");

  // While the CEO plans it, the request (and its turn: waiting, and why) is read again.
  useEffect(() => {
    if (sent === null) return;
    let stopped = false;
    const read = async (): Promise<boolean> => {
      try {
        const v = await executive.staffing(sent.staffingId);
        if (stopped) return true;
        setView(v);
        if (v.state !== "planning") return true;
        const d = await executive.conversation(sent.conversationId);
        if (!stopped) setTurn(d.turns.find((x) => x.id === sent.turn.id) ?? null);
        return false;
      } catch (err) {
        if (!stopped) setProblem(errorText(err));
        return false;
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async (): Promise<void> => {
      if (await read()) return;
      if (!stopped) timer = setTimeout(() => void loop(), POLL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [sent]);

  const submit = async () => {
    if (body === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const accepted = await executive.recruit(body, key);
      if (onSent !== undefined) onSent(accepted);
      else setSent(accepted);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const planning = sent !== null && (view === null || view.state === "planning");
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={mergeClasses("orbit-touch", isMobile ? s.surfaceMobile : s.surface)} aria-label={t("office.recruit.title")}>
        <DialogBody>
          <DialogTitle>{t("office.recruit.title")}</DialogTitle>
          <DialogContent className={s.body}>
            {sent === null ? (
              <>
                <Text className={o.muted}>{t("office.recruit.intro", { ceo })}</Text>
                <Field label={t("office.recruit.requirementLabel")} required hint={t("office.recruit.requirementHint")}>
                  <Textarea value={requirement} resize="vertical" rows={4} maxLength={STAFFING_LIMITS.requirementLength} placeholder={t("office.recruit.requirementPlaceholder")} onChange={(_, d) => setRequirement(d.value)} />
                </Field>
                <Field label={t("office.recruit.scopeLabel")} hint={department === null ? t("office.recruit.scopeCompanyHint") : t("office.recruit.scopeDepartmentHint", { name: department.name })}>
                  <Select value={scope} onChange={(_, d) => setScope(d.value)}>
                    <option value="">{t("office.recruit.scopeCompany")}</option>
                    {live.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {connections.data !== null && usable.length === 0 ? (
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      {t("office.recruit.noConnection")} <Link href={settingsHref("ai-connections")}>{t("office.hire.connectInSettings")}</Link>
                    </MessageBarBody>
                  </MessageBar>
                ) : (
                  <div className={o.formGrid}>
                    <Field label={t("office.recruit.connectionLabel")} hint={t("office.recruit.connectionHint")}>
                      <Select value={connection?.id ?? ""} onChange={(_, d) => { setConnectionId(d.value); setModelId(null); setEffortPick(null); }}>
                        {usable.map((c) => (
                          <option key={c.id} value={c.id}>
                            {`${RUNTIME_LABELS[c.runtime]} — ${c.label}`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("office.recruit.defaultsLabel")}>
                      <Switch checked={inherit} label={inherit ? t("office.recruit.defaultsOn") : t("office.recruit.defaultsOff")} onChange={(_, d) => setInherit(d.checked)} />
                    </Field>
                    {!inherit && (
                      <>
                        <Field label={t("office.recruit.modelLabel")}>
                          <Select value={model?.id ?? ""} onChange={(_, d) => { setModelId(d.value); setEffortPick(null); }}>
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                                {m.id === connection?.catalog.recommended ? t("office.hire.recommendedSuffix") : ""}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        {model !== null && model.efforts.length > 0 && (
                          <Field label={t("office.recruit.effortLabel")}>
                            <Select value={effort ?? ""} onChange={(_, d) => setEffortPick(d.value)}>
                              {model.efforts.map((e) => (
                                <option key={e} value={e}>
                                  {effortLabel(e)}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        )}
                      </>
                    )}
                  </div>
                )}
                {inherit && connection !== null && <DefaultsThatApply connection={connection} department={department} company={companyDefaults} />}
                <Field label={t("office.recruit.presetLabel")} hint={preset === null ? undefined : profileLine(preset.profile)}>
                  <Select value={preset?.id ?? ""} onChange={(_, d) => setPresetId(d.value)}>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {`${p.name} — ${p.description}`}
                      </option>
                    ))}
                  </Select>
                </Field>
                {fit !== null && (
                  <Text size={200} className={fit === 0 ? o.warn : o.muted}>
                    {fit === 0 ? t("office.recruit.noneFits") : t("office.recruit.fits", { count: fit })}
                  </Text>
                )}
                <Text size={200} className={o.muted}>
                  {t("office.recruit.howItWorks", { ceo })}
                </Text>
              </>
            ) : (
              <Progress sent={sent} view={view} turn={turn} ceo={ceo} onOpenEmployee={onOpenEmployee} />
            )}
            {problem !== null && (
              <MessageBar intent="error">
                <MessageBarBody>{problem}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            {sent === null ? (
              <>
                <Button onClick={onClose}>{t("office.recruit.cancel")}</Button>
                <Button appearance="primary" disabled={body === null || busy || fit === 0} onClick={() => void submit()}>
                  {busy ? t("office.recruit.sending") : t("office.recruit.send", { ceo })}
                </Button>
              </>
            ) : (
              <Button appearance={planning ? "secondary" : "primary"} onClick={onClose}>
                {planning ? t("office.recruit.closeWhilePlanning") : t("office.recruit.close")}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// From CEO Chat: the company's departments and defaults are read first; once sent, its conversation is opened.
export function RecruitFromChat({ ceoName, onClose, onSent }: { ceoName: string | null; onClose: () => void; onSent: (accepted: StaffingAccepted) => void }) {
  const roster = useResource<Roster>(() => office.roster({ department: null, q: "", status: null }), []);
  if (roster.data === null && roster.error === null) return null;
  return <RecruitDialog departments={roster.data?.departments ?? []} companyDefaults={roster.data?.office?.defaults ?? null} ceoName={ceoName} onClose={onClose} onSent={onSent} />;
}

// The request after it was sent: the CEO planning it (or waiting, and why), then what Orbit did.
function Progress({ sent, view, turn, ceo, onOpenEmployee }: { sent: StaffingAccepted; view: StaffingView | null; turn: ExecutiveTurn | null; ceo: string; onOpenEmployee?: (employeeId: string) => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const chat = `#/ceo/${encodeURIComponent(sent.conversationId)}`;
  if (view === null || view.state === "planning") {
    const waiting = turn?.state === "waiting" || turn?.state === "queued";
    return (
      <div className={o.stack} role="status" aria-live="polite">
        <div className={o.row}>
          <Spinner size="tiny" />
          <Text>{waiting ? t("office.recruit.waiting", { ceo }) : t("office.recruit.planning", { ceo })}</Text>
        </div>
        {waiting && turn?.waitingReason && (
          <Text size={200} className={o.muted}>
            {turn.waitingReason}
          </Text>
        )}
        <Link href={chat}>{t("office.recruit.openChat")}</Link>
      </div>
    );
  }
  const o2 = view.outcome;
  return (
    <div className={o.stack} role="status" aria-live="polite">
      {view.state === "hired" ? (
        <MessageBar intent="success">
          <MessageBarBody>{t("office.recruit.hired", { count: o2?.hired.length ?? 0 })}</MessageBarBody>
        </MessageBar>
      ) : (
        <MessageBar intent={view.state === "refused" ? "warning" : "error"}>
          <MessageBarBody>{view.state === "refused" ? t("office.recruit.refused") : t("office.recruit.failed")}</MessageBarBody>
        </MessageBar>
      )}
      {(o2?.hired.length ?? 0) > 0 && (
        <ul className={o.list} aria-label={t("office.recruit.hiredList")}>
          {o2?.hired.map((h) => (
            <li key={h.employeeId}>
              {onOpenEmployee ? (
                <Link as="button" onClick={() => onOpenEmployee(h.employeeId)}>
                  {h.name}
                </Link>
              ) : (
                <Link href={`#/office/employee/${h.employeeId}`}>{h.name}</Link>
              )}{" "}
              <Text size={200} className={o.muted}>
                {h.role === "manager" ? t("office.recruit.managerOf", { name: h.departmentName }) : t("office.recruit.memberOf", { name: h.departmentName })}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {(o2?.departmentsCreated.length ?? 0) > 0 && <Text size={200}>{t("office.recruit.departmentsMade", { names: o2?.departmentsCreated.map((d) => d.name).join(", ") ?? "" })}</Text>}
      {(o2?.problems.length ?? 0) > 0 && (
        <ul className={o.list} aria-label={t("office.recruit.problemsList")}>
          {o2?.problems.map((p) => (
            <li key={p}>
              <Text size={200} className={o.danger}>
                {p}
              </Text>
            </li>
          ))}
        </ul>
      )}
      <Link href={chat}>{t("office.recruit.openChat")}</Link>
    </div>
  );
}
