import { useState } from "react";
import { Button, Caption1, Field, Input, MessageBar, MessageBarBody, Select, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Add20Regular, Delete20Regular } from "@fluentui/react-icons";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { mcpApi, useMcpChange, useMcpPolicies } from "../mcp.api";
import type { PoliciesView, Policy, Verdict } from "../mcp.types";
import { isVerdict } from "../guards";
import { VERDICT } from "../McpStatus";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: tokens.spacingHorizontalM },
  exception: { display: "grid", gridTemplateColumns: "1fr 1fr 9rem auto", gap: tokens.spacingHorizontalS, alignItems: "end" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// Capability-first: a verdict per capability a server provides, a default, and
// what one tool call may do (read or write, as the server declares the tool).
// A workflow exception is the most specific rule there is. No roles, no users.
export function PoliciesTab({ readOnly }: { readOnly: boolean }) {
  const styles = useStyles();
  const policies = useMcpPolicies();
  if (policies.isPending) return <LoadingState label="Loading policies…" />;
  if (policies.isError) return <ErrorState error={policies.error} title="Could not read the policies" />;
  return (
    <div className={styles.stack}>
      {!policies.data.resources.length && <Text className={styles.muted}>Orbit manages no MCP server yet, so there is nothing to set a policy on.</Text>}
      {policies.data.resources.map((r) => (
        <ResourcePolicy key={r.key} resource={r} verdicts={policies.data.verdicts} readOnly={readOnly} />
      ))}
      <Workflows view={policies.data} readOnly={readOnly} />
    </div>
  );
}

function ResourcePolicy({ resource, verdicts, readOnly }: { resource: PoliciesView["resources"][number]; verdicts: Verdict[]; readOnly: boolean }) {
  const styles = useStyles();
  const [draft, setDraft] = useState<Policy>(resource.policy);
  const save = useMcpChange(mcpApi.policy);
  const pick = (label: string, value: Verdict | undefined, onPick: (v: Verdict) => void) => <VerdictSelect key={label} label={label} value={value} verdicts={verdicts} disabled={readOnly} onPick={onPick} />;
  return (
    <Card title={resource.name} subtitle={`Allow · Approval · Deny for what ${resource.name} is used for. Selection mode: ${resource.selection}.`}>
      <div className={styles.grid}>
        {pick(`${resource.name} default`, draft.default, (v) => setDraft({ ...draft, default: v }))}
        {resource.provides.map((cap) => pick(`${resource.name} ${cap}`, draft.capabilities[cap] ?? draft.default, (v) => setDraft({ ...draft, capabilities: { ...draft.capabilities, [cap]: v } })))}
        {(["read", "write"] as const).map((op) => pick(`${resource.name} ${op} tools`, draft.operations[op] ?? "allow", (v) => setDraft({ ...draft, operations: { ...draft.operations, [op]: v } })))}
      </div>
      {save.isError && <ErrorState error={save.error} title="Not saved" />}
      {save.isSuccess && (
        <MessageBar intent="success">
          <MessageBarBody>Saved. The router and every call apply it from now on.</MessageBarBody>
        </MessageBar>
      )}
      <div>
        <Button appearance="primary" disabled={readOnly || save.isPending} onClick={() => save.mutate({ id: resource.id, policy: draft })} aria-label={`Save the policy for ${resource.name}`}>
          {save.isPending ? "Saving…" : "Save policy"}
        </Button>
      </div>
    </Card>
  );
}

function VerdictSelect({ label, value, verdicts, disabled, onPick }: { label: string; value: Verdict | undefined; verdicts: Verdict[]; disabled: boolean; onPick: (v: Verdict) => void }) {
  return (
    <Field label={label.replace(/^\S+ /, "")}>
      <Select aria-label={label} value={value ?? "allow"} disabled={disabled} onChange={(_, d) => isVerdict(d.value) && onPick(d.value)}>
        {verdicts.map((v) => (
          <option key={v} value={v}>
            {VERDICT[v]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

interface Exception {
  key: number;
  skill: string;
  capability: string;
  verdict: Verdict;
}

let nextKey = 1;
const rowsOf = (workflows: PoliciesView["workflows"]): Exception[] => Object.entries(workflows).flatMap(([skill, caps]) => Object.entries(caps).map(([capability, verdict]) => ({ key: nextKey++, skill, capability, verdict })));
const tableOf = (rows: Exception[]) => rows.filter((r) => r.skill.trim() && r.capability.trim()).reduce<PoliciesView["workflows"]>((all, r) => ({ ...all, [r.skill.trim()]: { ...(all[r.skill.trim()] ?? {}), [r.capability.trim()]: r.verdict } }), {});

// For one skill and one capability, an exception to every server's policy:
// "orbit-code-review may never write to a repository". Nothing maps a skill to
// a server.
function Workflows({ view, readOnly }: { view: PoliciesView; readOnly: boolean }) {
  const styles = useStyles();
  const [rows, setRows] = useState<Exception[]>(() => rowsOf(view.workflows));
  const save = useMcpChange(mcpApi.workflows);
  const put = (key: number, patch: Partial<Exception>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Card title="Workflow exceptions" subtitle="The most specific rule: for one skill and one capability. Everything else follows each server's own policy.">
      {!rows.length && <Caption1 className={styles.muted}>No exceptions.</Caption1>}
      {rows.map((r) => (
        <div key={r.key} className={styles.exception}>
          <Field label="Skill">
            <Input aria-label="Exception skill" value={r.skill} disabled={readOnly} onChange={(_, d) => put(r.key, { skill: d.value })} placeholder="orbit-code-review" />
          </Field>
          <Field label="Capability">
            <Input aria-label="Exception capability" value={r.capability} disabled={readOnly} onChange={(_, d) => put(r.key, { capability: d.value })} placeholder="repository.write" />
          </Field>
          <VerdictSelect label="Exception verdict" value={r.verdict} verdicts={view.verdicts} disabled={readOnly} onPick={(v) => put(r.key, { verdict: v })} />
          <Button icon={<Delete20Regular />} appearance="subtle" disabled={readOnly} aria-label="Remove exception" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} />
        </div>
      ))}
      {save.isError && <ErrorState error={save.error} title="Not saved" />}
      <div>
        <Button icon={<Add20Regular />} disabled={readOnly} onClick={() => setRows([...rows, { key: nextKey++, skill: "", capability: "", verdict: "deny" }])}>
          Add exception
        </Button>{" "}
        <Button appearance="primary" disabled={readOnly || save.isPending} onClick={() => save.mutate(tableOf(rows))}>
          {save.isPending ? "Saving…" : "Save exceptions"}
        </Button>
      </div>
    </Card>
  );
}
