// EMPLOYEE NETWORK ACCESS, a part of the account's policy document (`employeeNetwork`), edited in a draft like the rest
// and published through the same review: AUTONOMOUS lets an employee's sandbox reach every public website (ports 80 and
// 443); RESTRICTED only the hosts listed (an exact host, or `*.domain`). Optional limits per run and per day are off
// unless a number is set. Whatever the mode, private, loopback and metadata addresses stay refused: that is never the
// policy's to loosen. A policy that does not say is AUTONOMOUS for employees; chats and research keep their own rules.
import { Button, Field, Input, Radio, RadioGroup, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { NETWORK_DISCLOSURE } from "../office/parts";
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

interface LimitSpec {
  key: keyof NetworkLimits;
  label: string;
  // The unit a person types, and how many of the stored unit one of it is.
  factor: number;
}

const LIMITS: LimitSpec[] = [
  { key: "bandwidthMbpsPerRun", label: "Bandwidth per run (Mbit/s)", factor: 1 },
  { key: "downloadBytesPerRun", label: "Download per run (MiB)", factor: MiB },
  { key: "downloadBytesPerDay", label: "Download per day, whole account (GiB)", factor: GiB },
  { key: "connectionsPerMinutePerRun", label: "New connections per minute, per run", factor: 1 },
  { key: "concurrentConnectionsPerRun", label: "Open connections at once, per run", factor: 1 },
];

const useStyles = makeStyles({
  hosts: { display: "flex", flexDirection: "column", gap: "4px", listStyleType: "none", margin: 0, paddingLeft: 0 },
  host: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  add: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "end" },
  limits: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: "10px" },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

function LimitField({ spec, value, editable, onChange }: { spec: LimitSpec; value: number | undefined; editable: boolean; onChange: (v: number | undefined) => void }) {
  const shown = value === undefined ? "" : String(Math.round((value / spec.factor) * 100) / 100);
  const [draft, setDraft] = useState<{ text: string; value: number | undefined } | null>(null);
  const text = draft !== null && draft.value === value ? draft.text : shown;
  return (
    <Field label={spec.label} hint="Empty: no limit.">
      <Input
        type="number"
        min={0}
        disabled={!editable}
        value={text}
        onChange={(_, d) => {
          const n = Number(d.value);
          const next = d.value.trim() === "" ? undefined : Number.isFinite(n) && n > 0 ? Math.round(n * spec.factor) : value;
          setDraft({ text: d.value, value: next });
          onChange(next);
        }}
      />
    </Field>
  );
}

export function EmployeeNetworkSection({ value, editable, onChange }: { value: EmployeeNetwork | null; editable: boolean; onChange: (v: EmployeeNetwork) => void }) {
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
    <Card title="Employee network access" description="What an employee's sandbox may reach on the internet. Chats and research keep their own rules.">
      {value === null && (
        <Text size={200} className={p.muted}>
          This revision does not say, so employee runs use Autonomous.{editable ? " Changing it here adds it to the draft." : ""}
        </Text>
      )}
      <Field label="Mode">
        <RadioGroup value={current.mode} disabled={!editable} onChange={(_, d) => onChange({ ...current, mode: d.value as NetworkMode })}>
          <Radio value="AUTONOMOUS" label="Autonomous — every public website, ports 80 and 443, with no per-site approval" />
          <Radio value="RESTRICTED" label="Restricted — only the hosts listed below" />
        </RadioGroup>
      </Field>
      <div className={p.inset}>
        <Text weight="semibold" size={300}>
          Allowed hosts {current.mode === "AUTONOMOUS" ? "(used once the mode is Restricted)" : ""}
        </Text>
        {current.allow.length === 0 ? (
          <Text size={200} className={p.muted}>
            {current.mode === "RESTRICTED" ? "None: in Restricted mode nothing outside is reached." : "None listed."}
          </Text>
        ) : (
          <ul className={s.hosts} aria-label="Allowed hosts">
            {current.allow.map((h) => (
              <li key={h} className={s.host}>
                <span className={p.codeChip}>{h}</span>
                {editable && <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={`Remove ${h}`} onClick={() => onChange({ ...current, allow: current.allow.filter((x) => x !== h) })} />}
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
            <Field label="Host or domain to allow" hint="An exact host (docs.example.com) or a whole domain (*.example.com)." validationState={typed !== "" && !valid ? "error" : "none"} validationMessage={typed !== "" && !valid ? "Not a host name or *.domain." : undefined}>
              <Input value={host} onChange={(_, d) => setHost(d.value)} />
            </Field>
            <Button type="submit" disabled={!valid}>
              Allow
            </Button>
          </form>
        )}
      </div>
      <div className={p.inset}>
        <Text weight="semibold" size={300}>
          Limits
        </Text>
        <div className={s.limits}>
          {LIMITS.map((l) => (
            <LimitField key={l.key} spec={l} value={current.limits?.[l.key]} editable={editable} onChange={(v) => setLimit(l.key, v)} />
          ))}
        </div>
      </div>
      <Text size={200} className={p.muted}>
        In both modes private, loopback, link-local and cloud-metadata addresses are refused, and every connection is logged for the work it belongs to. Switching from Restricted back to Autonomous is a high-risk change: it is reviewed as one before it is published.
      </Text>
      <Text size={200} weight="semibold" className={s.warn}>
        {NETWORK_DISCLOSURE}
      </Text>
    </Card>
  );
}
