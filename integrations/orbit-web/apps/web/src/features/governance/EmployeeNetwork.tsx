// EMPLOYEE NETWORK ACCESS, a part of the account's policy document (`employeeNetwork`), edited in a draft like the rest
// and published through the same review: AUTONOMOUS lets an employee's sandbox reach every public website (ports 80 and
// 443); RESTRICTED only the hosts listed (an exact host, or `*.domain`). Optional limits per run and per day are off
// unless a number is set. Whatever the mode, private, loopback and metadata addresses stay refused: that is never the
// policy's to loosen. A policy that does not say is AUTONOMOUS for employees; chats and research keep their own rules.
import { Button, Field, Input, Radio, RadioGroup, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Card, useParts } from "./parts";

export type NetworkMode = "AUTONOMOUS" | "RESTRICTED";

export interface NetworkLimits {
  bandwidthMbpsPerRun?: number;
  downloadBytesPerRun?: number;
  downloadBytesPerDay?: number;
  connectionsPerMinutePerRun?: number;
  concurrentConnectionsPerRun?: number;
}

export interface EmployeeNetwork {
  mode: NetworkMode;
  allow: string[];
  limits?: NetworkLimits;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The document's `employeeNetwork` as the page can edit it (null: the policy does not say), and the rest of the document.
export function splitNetwork(document: unknown): { rest: unknown; network: EmployeeNetwork | null } {
  if (!isRecord(document) || !("employeeNetwork" in document)) return { rest: document, network: null };
  const { employeeNetwork, ...rest } = document;
  if (!isRecord(employeeNetwork)) return { rest, network: null };
  const mode: NetworkMode = employeeNetwork.mode === "RESTRICTED" ? "RESTRICTED" : "AUTONOMOUS";
  const allow = Array.isArray(employeeNetwork.allow) ? employeeNetwork.allow.filter((h): h is string => typeof h === "string") : [];
  const limits = isRecord(employeeNetwork.limits) ? (employeeNetwork.limits as NetworkLimits) : undefined;
  return { rest, network: { mode, allow, ...(limits ? { limits } : {}) } };
}

// An exact host, or every host of a domain (`*.example.com`).
const HOST = /^(\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const isAllowEntry = (v: string): boolean => v.length <= 253 && HOST.test(v);

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export interface LimitSpec {
  key: keyof NetworkLimits;
  labelKey: MessageKey;
  // The unit a person types, and how many of the stored unit one of it is.
  factor: number;
}

// A limit's value in the unit a person reads and types it in.
export const inUnit = (spec: LimitSpec, value: number): string => String(Math.round((value / spec.factor) * 100) / 100);

export const LIMITS: LimitSpec[] = [
  { key: "bandwidthMbpsPerRun", labelKey: "governance.network.limit.bandwidthMbpsPerRun", factor: 1 },
  { key: "downloadBytesPerRun", labelKey: "governance.network.limit.downloadBytesPerRun", factor: MiB },
  { key: "downloadBytesPerDay", labelKey: "governance.network.limit.downloadBytesPerDay", factor: GiB },
  { key: "connectionsPerMinutePerRun", labelKey: "governance.network.limit.connectionsPerMinutePerRun", factor: 1 },
  { key: "concurrentConnectionsPerRun", labelKey: "governance.network.limit.concurrentConnectionsPerRun", factor: 1 },
];

const useStyles = makeStyles({
  hosts: { display: "flex", flexDirection: "column", gap: "4px", listStyleType: "none", margin: 0, paddingLeft: 0 },
  host: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  add: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "end" },
  limits: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: "10px", alignItems: "start" },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

// One limit, typed in its unit; empty is no limit (or, where `hint` says so, what something else decides).
export function LimitField({ spec, value, editable, onChange, hint }: { spec: LimitSpec; value: number | undefined; editable: boolean; onChange: (v: number | undefined) => void; hint?: string }) {
  const { t } = useI18n();
  const shown = value === undefined ? "" : inUnit(spec, value);
  const [draft, setDraft] = useState<{ text: string; value: number | undefined } | null>(null);
  const text = draft !== null && draft.value === value ? draft.text : shown;
  return (
    <Field label={t(spec.labelKey)} hint={hint ?? t("governance.network.limitHint")}>
      <Input
        type="number"
        min={0}
        disabled={!editable}
        value={text}
        onChange={(_, d) => {
          if (d.value.trim() === "") {
            setDraft(null);
            onChange(undefined);
            return;
          }
          const n = Number(d.value);
          if (Number.isFinite(n) && n > 0) {
            const next = Math.round(n * spec.factor);
            setDraft({ text: d.value, value: next });
            onChange(next);
          } else {
            setDraft({ text: d.value, value });
          }
        }}
      />
    </Field>
  );
}

export function EmployeeNetworkSection({ value, editable, onChange }: { value: EmployeeNetwork | null; editable: boolean; onChange: (v: EmployeeNetwork) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const current: EmployeeNetwork = value ?? { mode: "AUTONOMOUS", allow: [] };
  const [host, setHost] = useState("");
  const typed = host.trim().toLowerCase();
  const valid = isAllowEntry(typed);
  const add = () => {
    if (!valid || current.allow.includes(typed)) return;
    onChange({ ...current, allow: [...current.allow, typed] });
    setHost("");
  };
  const setLimit = (key: keyof NetworkLimits, v: number | undefined) => {
    const limits: NetworkLimits = { ...(current.limits ?? {}) };
    if (v === undefined) delete limits[key];
    else limits[key] = v;
    onChange({ ...current, ...(Object.keys(limits).length > 0 ? { limits } : { limits: undefined }) });
  };
  return (
    <Card className="orbit-touch" label={t("governance.network.title")} title={t("governance.network.title")} description={t("governance.network.description")}>
      {value === null && (
        <Text size={200} className={p.muted}>
          {t("governance.network.defaultNotice", { editable: editable ? t("governance.network.defaultEditable") : "" })}
        </Text>
      )}
      <Field label={t("governance.network.modeLabel")}>
        <RadioGroup value={current.mode} disabled={!editable} onChange={(_, d) => onChange({ ...current, mode: d.value as NetworkMode })}>
          <Radio value="AUTONOMOUS" label={t("governance.network.modeAutonomous")} />
          <Radio value="RESTRICTED" label={t("governance.network.modeRestricted")} />
        </RadioGroup>
      </Field>
      <div className={p.inset}>
        <Text weight="semibold" size={300}>
          {t("governance.network.allowedHosts")}
          {current.mode === "AUTONOMOUS" ? t("governance.network.allowedHostsInactiveSuffix") : ""}
        </Text>
        {current.allow.length === 0 ? (
          <Text size={200} className={p.muted}>
            {current.mode === "RESTRICTED" ? t("governance.network.noneRestricted") : t("governance.network.noneListed")}
          </Text>
        ) : (
          <ul className={s.hosts} aria-label={t("governance.network.allowedHosts")}>
            {current.allow.map((h) => (
              <li key={h} className={s.host}>
                <span className={p.codeChip}>{h}</span>
                {editable && <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={t("governance.network.removeHost", { host: h })} onClick={() => onChange({ ...current, allow: current.allow.filter((x) => x !== h) })} />}
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
            <Field label={t("governance.network.hostInputLabel")} hint={t("governance.network.hostInputHint")} validationState={typed !== "" && !valid ? "error" : "none"} validationMessage={typed !== "" && !valid ? t("governance.network.hostInputInvalid") : undefined}>
              <Input value={host} onChange={(_, d) => setHost(d.value)} />
            </Field>
            <Button type="submit" disabled={!valid}>
              {t("governance.network.allow")}
            </Button>
          </form>
        )}
      </div>
      <div className={p.inset}>
        <Text weight="semibold" size={300}>
          {t("governance.network.limits")}
        </Text>
        <div className={s.limits}>
          {LIMITS.map((l) => (
            <LimitField key={l.key} spec={l} value={current.limits?.[l.key]} editable={editable} onChange={(v) => setLimit(l.key, v)} />
          ))}
        </div>
      </div>
      <Text size={200} className={p.muted}>
        {t("governance.network.footerNote")}
      </Text>
      <Text size={200} weight="semibold" className={s.warn}>
        {t("office.shared.networkDisclosure")}
      </Text>
    </Card>
  );
}
