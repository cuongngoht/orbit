import { useState, type FormEvent } from "react";
import { Button, Caption1, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Radio, RadioGroup, Select, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { Add20Regular, Delete20Regular } from "@fluentui/react-icons";
import { ErrorState } from "../../shared/components/ErrorState";
import { useRouterResources } from "../router/router.api";
import { CapabilityPicker, capabilityOptions } from "./CapabilityPicker";
import { isSelection, isTransport, isVerdict, SELECTIONS, VERDICTS } from "./guards";
import type { Check, ExternalServer, ManagedInput, ManagedServer, Selection, Verdict } from "./mcp.types";
import { SELECTION, VERDICT } from "./McpStatus";
import { cleanHeaderName, envListIssue, headerIssues, idIssue, slugOf, suggestedEnv } from "./validate";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, maxWidth: "46rem" },
  pairs: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  pair: { display: "grid", gridTemplateColumns: "minmax(8rem, 14rem) 1fr auto", gap: tokens.spacingHorizontalS, alignItems: "start" },
  fixes: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: tokens.spacingHorizontalM },
  code: { fontFamily: tokens.fontFamilyMonospace },
  muted: { color: tokens.colorNeutralForeground3 },
});

// A header Orbit must send: its NAME, and the NAME of the environment variable
// its value is read from when Orbit connects. There is no field for the value
// itself -- the machine store is durable, which is exactly why a secret must
// not be in it.
interface HeaderRow {
  key: number;
  name: string;
  env: string;
}

export interface Draft {
  id: string;
  name: string;
  transport: "http" | "stdio";
  url: string;
  command: string;
  args: string;
  headers: HeaderRow[];
  env: string;
  provides: string[];
  selection: Selection;
  policy: Verdict;
}

let nextKey = 1;
const lines = (text: string) => text.split(/[\n,]/).map((a) => a.trim()).filter(Boolean);
const header = (name = "", env = ""): HeaderRow => ({ key: nextKey++, name, env });

export const emptyDraft = (): Draft => ({ id: "", name: "", transport: "http", url: "", command: "", args: "", headers: [], env: "", provides: [], selection: "automatic", policy: "allow" });

export const draftOfManaged = (s: ManagedServer): Draft => ({ ...emptyDraft(), id: s.id, name: s.name, transport: s.definition.transport, url: s.definition.url ?? "", command: s.definition.command ?? "", args: (s.definition.args ?? []).join("\n"), headers: (s.definition.requiredHeaders ?? []).map((h) => header(h.name, h.env)), env: (s.definition.requiredEnv ?? []).map((e) => e.name).join("\n"), provides: s.provides, selection: s.selection, policy: s.policy.default });

// From what a host shows: names only, and a masked value (`…`, `[redacted]`)
// left for the person to replace -- Orbit never copies a host's secret.
export function draftOfExternal(s: ExternalServer): Draft {
  const id = (s.name ?? s.id).replace(/[^A-Za-z0-9_.-]/g, "-");
  return { ...emptyDraft(), id, name: s.name, transport: s.transport === "stdio" ? "stdio" : "http", url: s.url ?? "", command: s.command ?? "", args: (s.args ?? []).join("\n"), headers: (s.headers ?? []).map((h) => header(h.name, suggestedEnv(id, h.name))), env: (s.env ?? []).map((e) => e.name).join("\n"), provides: s.provides };
}


export function inputOf(d: Draft): ManagedInput {
  const common = { id: d.id.trim(), ...(d.name.trim() ? { name: d.name.trim() } : {}), transport: d.transport, provides: d.provides, selection: d.selection };
  if (d.transport === "http") return { ...common, url: d.url.trim(), requiredHeaders: d.headers.filter((h) => h.name.trim() || h.env.trim()).map((h) => ({ name: h.name.trim(), env: h.env.trim() })) };
  return { ...common, command: d.command.trim(), args: d.args.split("\n").map((a) => a.trim()).filter(Boolean), requiredEnv: lines(d.env) };
}

const masked = (d: Draft) => /…|\[redacted\]/.test(`${d.url} ${d.args}`);

// Anything a field below says is wrong keeps the form from being sent: the
// server would refuse it anyway, and a pasted secret should not travel at all.
const hasIssues = (d: Draft) => (d.transport === "http" ? d.headers.some((h) => { const i = headerIssues(h); return Boolean(i.name || i.env); }) : Boolean(envListIssue(d.env)));

interface FormProps {
  initial: Draft;
  mode: "add" | "edit";
  busy: boolean;
  error: unknown;
  testing: boolean;
  check: Check | null;
  testError: unknown;
  onTest: (input: ManagedInput) => void;
  onSubmit: (input: ManagedInput, policy: Verdict) => void;
  onCancel: () => void;
}

export function ManagedServerForm(props: FormProps) {
  const styles = useStyles();
  const [draft, setDraft] = useState<Draft>(props.initial);
  const resources = useRouterResources();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit(inputOf(draft), draft.policy);
  };
  const ready = Boolean(draft.id.trim() && (draft.transport === "http" ? draft.url.trim() : draft.command.trim())) && !idIssue(draft.id) && !masked(draft) && !hasIssues(draft);
  return (
    <form className={styles.form} onSubmit={submit} aria-label={props.mode === "edit" ? "Edit a Orbit-managed MCP server" : "Add a Orbit-managed MCP server"}>
      {masked(draft) && (
        <MessageBar intent="warning">
          <MessageBarBody>Part of this was masked where it came from (… or [redacted]). Replace it with the real value, or move a secret into an environment variable.</MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.row}>
        <IdField draft={draft} editable={props.mode === "add"} set={set} />
        <Field label="Display name" hint="Any text — this is what a page shows.">
          <Input value={draft.name} onChange={(_, d) => set({ name: d.value })} />
        </Field>
      </div>
      <Field label="Transport">
        <RadioGroup value={draft.transport} onChange={(_, d) => isTransport(d.value) && set({ transport: d.value })} layout="horizontal">
          <Radio value="http" label="HTTP — remote, nothing to install" />
          <Radio value="stdio" label="stdio — a command on this machine" />
        </RadioGroup>
      </Field>
      {draft.transport === "http" ? <HttpFields draft={draft} set={set} /> : <StdioFields draft={draft} set={set} />}
      <SecretHelp draft={draft} />
      <CapabilityPicker selected={draft.provides} onChange={(provides) => set({ provides })} options={capabilityOptions(resources.data?.resources)} />
      <div className={styles.row}>
        <Field label="Selection mode" hint={SELECTION[draft.selection].hint}>
          <Select value={draft.selection} onChange={(_, d) => isSelection(d.value) && set({ selection: d.value })}>
            {SELECTIONS.map((s) => (
              <option key={s} value={s}>
                {SELECTION[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Policy" hint="The default for everything it provides; per capability on the Policies tab.">
          <Select value={draft.policy} onChange={(_, d) => isVerdict(d.value) && set({ policy: d.value })}>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>
                {VERDICT[v]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {props.error != null && <ErrorState error={props.error} title={props.mode === "edit" ? "Not saved" : "Not added"} />}
      {props.testError != null && <ErrorState error={props.testError} title="The test could not run" />}
      {props.check && <CheckResult check={props.check} />}
      <div className={styles.actions}>
        <Button type="button" disabled={!ready || props.testing} onClick={() => props.onTest(inputOf(draft))}>
          {props.testing ? "Testing…" : "Test Connection"}
        </Button>
        <Button appearance="primary" type="submit" disabled={!ready || props.busy}>
          {props.busy ? "Saving…" : props.mode === "edit" ? "Save" : "Add to Orbit"}
        </Button>
        <Button type="button" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// The id Orbit names the server by -- checked as it is typed, with a usable id
// one click away, made from what was typed or from the display name.
function IdField({ draft, editable, set }: { draft: Draft; editable: boolean; set: (patch: Partial<Draft>) => void }) {
  const styles = useStyles();
  const issue = idIssue(draft.id);
  const suggestion = slugOf(draft.id.trim() ? draft.id : draft.name);
  const offer = editable && suggestion !== "" && suggestion !== draft.id && (Boolean(issue) || !draft.id.trim());
  return (
    <div>
      <Field label="Id" required hint={editable ? "Letters, digits and . _ - — no spaces or accents. How Orbit names it." : "A server cannot be renamed."} validationState={issue ? "error" : "none"} validationMessage={issue}>
        <Input value={draft.id} disabled={!editable} onChange={(_, d) => set({ id: d.value })} />
      </Field>
      {offer && (
        <Button size="small" appearance="transparent" className={styles.fixes} onClick={() => set({ id: suggestion })}>
          Use {suggestion}
        </Button>
      )}
    </div>
  );
}

function HttpFields({ draft, set }: { draft: Draft; set: (patch: Partial<Draft>) => void }) {
  const styles = useStyles();
  const put = (key: number, patch: Partial<HeaderRow>) => set({ headers: draft.headers.map((h) => (h.key === key ? { ...h, ...patch } : h)) });
  return (
    <>
      <Field label="URL" required hint="No user name, password or secret in it: a token goes in a header, read from an environment variable.">
        <Input type="url" value={draft.url} onChange={(_, d) => set({ url: d.value })} placeholder="https://example.com/mcp" />
      </Field>
      <fieldset className={styles.pairs} style={{ border: "none", margin: 0, padding: 0 }}>
        <legend>
          <Text weight="semibold">Required headers</Text> <Caption1 className={styles.muted}>The header's name, and the NAME of the environment variable that holds its value — not the value.</Caption1>
        </legend>
        {draft.headers.map((h) => (
          <HeaderFields key={h.key} row={h} id={draft.id} onChange={(patch) => put(h.key, patch)} onRemove={() => set({ headers: draft.headers.filter((x) => x.key !== h.key) })} />
        ))}
        <div>
          <Button icon={<Add20Regular />} size="small" onClick={() => set({ headers: [...draft.headers, header()] })}>
            Add header
          </Button>
        </div>
      </fieldset>
    </>
  );
}

// One header row, checked as it is typed. A secret pasted where the variable's
// NAME belongs is masked at once, never repeated in a message, and one click
// replaces it with a variable name -- so it does not have to be deleted by hand.
function HeaderFields({ row, id, onChange, onRemove }: { row: HeaderRow; id: string; onChange: (patch: Partial<HeaderRow>) => void; onRemove: () => void }) {
  const styles = useStyles();
  const issues = headerIssues(row);
  const cleaned = cleanHeaderName(row.name);
  const suggestion = suggestedEnv(id || "mcp", cleaned || "token");
  return (
    <div>
      <div className={styles.pair}>
        <Field validationState={issues.name ? "error" : "none"} validationMessage={issues.name}>
          <Input aria-label="Header name" value={row.name} placeholder="Authorization" onChange={(_, d) => onChange({ name: d.value })} />
        </Field>
        <Field validationState={issues.env ? "error" : "none"} validationMessage={issues.env}>
          <Input aria-label={`Environment variable for ${cleaned || "this header"}`} type={issues.secret ? "password" : "text"} value={row.env} placeholder={suggestion} autoComplete="off" spellCheck={false} onChange={(_, d) => onChange({ env: d.value })} />
        </Field>
        <Button icon={<Delete20Regular />} appearance="subtle" aria-label={`Remove ${cleaned || "header"}`} onClick={onRemove} />
      </div>
      <div className={styles.fixes}>
        {issues.name && cleaned !== row.name.trim() && /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(cleaned) && (
          <Button size="small" appearance="transparent" onClick={() => onChange({ name: cleaned })}>
            Use {cleaned}
          </Button>
        )}
        {(issues.secret || (issues.env && !row.env.trim())) && (
          <Button size="small" appearance="transparent" onClick={() => onChange({ env: suggestion })}>
            Use {suggestion}
          </Button>
        )}
      </div>
    </div>
  );
}

function StdioFields({ draft, set }: { draft: Draft; set: (patch: Partial<Draft>) => void }) {
  const envIssue = envListIssue(draft.env);
  return (
    <>
      <Field label="Command" required hint="Found on this machine's PATH when it starts. A runtime Orbit installs comes from the catalog instead.">
        <Input value={draft.command} onChange={(_, d) => set({ command: d.value })} placeholder="npx" />
      </Field>
      <Field label="Arguments" hint="One per line. Passed as they are — never through a shell. No secret here: use a variable.">
        <Textarea value={draft.args} onChange={(_, d) => set({ args: d.value })} rows={3} resize="vertical" />
      </Field>
      <Field label="Required environment variables" hint="Names only, one per line. The server gets these and the few any process needs — never the rest of the environment." validationState={envIssue ? "error" : "none"} validationMessage={envIssue}>
        <Textarea value={draft.env} onChange={(_, d) => set({ env: d.value })} rows={2} resize="vertical" placeholder="API_TOKEN" />
      </Field>
    </>
  );
}

// Where the value goes instead: the environment Orbit runs in. Named with the
// person's own variables, so it can be copied as it is.
function SecretHelp({ draft }: { draft: Draft }) {
  const styles = useStyles();
  const names = draft.transport === "http" ? draft.headers.filter((h) => !headerIssues(h).env && h.env.trim()).map((h) => h.env.trim()) : envListIssue(draft.env) ? [] : lines(draft.env);
  if (!names.length) return null;
  return (
    <MessageBar intent="info" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>Where the value goes</MessageBarTitle>
        Set {names.length > 1 ? "these variables" : "this variable"} in the environment Claude Code and Orbit Control start from — for example in <span className={styles.code}>~/.zshrc</span>:{" "}
        {names.map((n) => (
          <span key={n} className={styles.code}>{`export ${n}="…" `}</span>
        ))}
        — then restart them. Orbit reads the value only when it connects, and never keeps it; the server's page shows whether each is set.
      </MessageBarBody>
    </MessageBar>
  );
}

export function CheckResult({ check }: { check: Check }) {
  const intent = check.status === "connected" ? "success" : check.status === "failed" ? "error" : "warning";
  return (
    <MessageBar intent={intent}>
      <MessageBarBody>
        {check.status === "connected" ? `Connected — ${check.toolCount ?? 0} tool${check.toolCount === 1 ? "" : "s"} offered.` : `${check.status === "needs-auth" ? "Needs credentials" : check.status === "failed" ? "Did not connect" : "Could not be tested"}: ${check.reason ?? "no reason given"}`}
      </MessageBarBody>
    </MessageBar>
  );
}
