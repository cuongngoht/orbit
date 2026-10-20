import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Caption1, Field, MessageBar, MessageBarBody, MessageBarTitle, Select, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDownload20Regular, Checkmark20Regular, Delete20Regular, Edit20Regular, PlugConnected20Regular } from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatDateTime, formatRelative } from "../../shared/format";
import { routerKeys } from "../router/router.api";
import { mcpApi, mcpKeys, useManaged, useManagedTools, useMcpChange } from "./mcp.api";
import type { ManagedServer } from "./mcp.types";
import { isSelection, SELECTIONS } from "./guards";
import { CheckResult } from "./ManagedServerForm";
import { connectionLine, RUNTIME, SELECTION, StateBadge, VERDICT } from "./McpStatus";
import { managedEditPath, MCP_PATH } from "./paths";

export const useDetailStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  facts: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: tokens.spacingHorizontalXL, rowGap: tokens.spacingVerticalS, margin: 0 },
  dd: { margin: 0, overflowWrap: "anywhere" },
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, marginBottom: tokens.spacingVerticalL },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  muted: { color: tokens.colorNeutralForeground3 },
  wide: { gridColumn: "1 / -1" },
});

// `/mcp/managed/:id`: one server Orbit owns. Machine state, connection and
// selection are three different lines, and "connected" only ever comes from a
// test somebody ran. Nothing on this page reaches a host's configuration.
export function McpDetailPage() {
  const { id = "" } = useParams();
  const server = useManaged(id);
  if (server.isPending) return <LoadingState label="Loading the server…" />;
  if (server.isError) return <ErrorState error={server.error} title="Could not load the server" onRetry={() => server.refetch()} />;
  return <Detail server={server.data} />;
}

function Detail({ server }: { server: ManagedServer }) {
  const styles = useDetailStyles();
  const navigate = useNavigate();
  const readOnly = !mutationToken();
  const test = useMcpChange(mcpApi.test);
  const toggle = useMcpChange((on: boolean) => (on ? mcpApi.enable(server.id) : mcpApi.disable(server.id)));
  const install = useMcpChange(mcpApi.install);
  const approve = useMcpChange(mcpApi.approve);
  const remove = useRemove();
  const [removing, setRemoving] = useState(false);
  const busy = test.isPending || toggle.isPending || install.isPending;
  return (
    <>
      <PageHeader
        title={server.name}
        description={server.description || undefined}
        badges={<StateBadge state={server.state} />}
        actions={
          <>
            <Button icon={<PlugConnected20Regular />} disabled={readOnly || busy || server.runtime.kind === "managed" && !server.runtime.present} onClick={() => test.mutate(server.id)}>
              {test.isPending ? "Testing…" : "Test Connection"}
            </Button>
            {server.runtime.kind === "managed" && (
              <Button icon={<ArrowDownload20Regular />} disabled={readOnly || busy || !server.install.supported} onClick={() => install.mutate(server.id)}>
                {install.isPending ? "Installing…" : server.runtime.present ? "Reinstall" : "Install runtime"}
              </Button>
            )}
            <Button disabled={readOnly || busy} onClick={() => toggle.mutate(!server.enabled)}>
              {server.enabled ? "Disable" : "Enable"}
            </Button>
            <Button icon={<Edit20Regular />} disabled={readOnly} onClick={() => navigate(managedEditPath(server.id))}>
              Edit
            </Button>
            <Button icon={<Delete20Regular />} disabled={readOnly || remove.isSuccess} onClick={() => setRemoving(true)}>
              Remove from Orbit
            </Button>
          </>
        }
      />
      <div className={styles.stack}>
        {remove.isSuccess && <Removed name={server.name} runtimeKept={remove.data.runtimeKept} id={server.id} readOnly={readOnly} />}
        {server.state !== "ready" && server.why && (
          <MessageBar intent={server.state === "disabled" ? "info" : "warning"}>
            <MessageBarBody>{server.why}</MessageBarBody>
          </MessageBar>
        )}
        {test.data && <CheckResult check={test.data.check} />}
        {install.data && (
          <MessageBar intent="success">
            <MessageBarBody>{install.data.receipt?.reused ? "The runtime already in the machine store was reused." : `Installed ${install.data.receipt?.version ?? ""} into the machine store and verified.`}</MessageBarBody>
          </MessageBar>
        )}
        {[test, toggle, install, approve].map((m, at) => m.isError && <ErrorState key={at} error={m.error} title="That did not work" />)}
        {needsApproval(server) && <Approval server={server} readOnly={readOnly} onApprove={(minutes) => approve.mutate({ id: server.id, minutes })} busy={approve.isPending} />}
      </div>
      <div className={styles.grid}>
        <Card title="Server">
          <Facts rows={factsOf(server)} />
        </Card>
        <Card title="Selection" subtitle="Whether the resolver may choose it. Enabled only means it may be considered.">
          <SelectionPicker server={server} readOnly={readOnly} />
        </Card>
        <Card title="Secrets" subtitle="Named, never kept: each value is read from the environment at the moment Orbit connects.">
          <Secrets server={server} />
        </Card>
        <Card title="Provides" subtitle="Capabilities. The resolver matches them to what a task needs.">
          <Words words={server.provides} empty="Nothing declared — the resolver will never choose it." />
        </Card>
        <Card title="Potential consumers" subtitle="Skills and agents that need or can use what it provides — derived now, never stored.">
          <Consumers server={server} />
        </Card>
        <Tools id={server.id} />
      </div>
      <ConfirmDialog
        open={removing}
        title={`Remove ${server.name} from Orbit?`}
        confirmLabel="Remove from Orbit"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate(server.id, { onSuccess: () => setRemoving(false) })}
        onCancel={() => {
          remove.reset();
          setRemoving(false);
        }}
      >
        <Text as="p" block>
          This removes Orbit's record of it, its policy and any approval. {server.runtime.receipt ? "The runtime Orbit installed stays in the machine store until you delete it." : ""} Nothing in any host's configuration changes.
        </Text>
        {remove.isError && <ErrorState error={remove.error} title="Not removed" />}
      </ConfirmDialog>
    </>
  );
}

const needsApproval = (s: ManagedServer) => s.selection === "approval" || s.policy.default === "approval" || Object.values(s.policy.capabilities).includes("approval");

// Removing leaves THIS page mounted, saying so, rather than navigating away as
// the dialog closes: a Fluent modal whose owner unmounts while it closes leaves
// the whole page aria-hidden. So only the lists are refetched, not this server.
function useRemove() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: mcpApi.remove,
    onSuccess: () => Promise.all([mcpKeys.overview(), mcpKeys.catalog(), mcpKeys.policies(), routerKeys.all].map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

function Removed({ name, runtimeKept, id, readOnly }: { name: string; runtimeKept: boolean; id: string; readOnly: boolean }) {
  const navigate = useNavigate();
  const runtime = useMutation({ mutationFn: mcpApi.deleteRuntime });
  return (
    <MessageBar intent="success" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>Removed {name} from Orbit.</MessageBarTitle>
        {runtimeKept && !runtime.isSuccess && "Its runtime files are still in the machine store. "}
        {runtime.isSuccess && "Its runtime files were deleted from the machine store. "}
        {runtimeKept && !runtime.isSuccess && (
          <Button size="small" disabled={readOnly || runtime.isPending} onClick={() => runtime.mutate(id)}>
            Delete runtime files
          </Button>
        )}{" "}
        <Button size="small" onClick={() => navigate(MCP_PATH)}>
          Back to MCP
        </Button>
      </MessageBarBody>
    </MessageBar>
  );
}

function Approval({ server, readOnly, onApprove, busy }: { server: ManagedServer; readOnly: boolean; onApprove: (minutes: number) => void; busy: boolean }) {
  const revoke = useMcpChange(mcpApi.revoke);
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>Needs a person's approval</MessageBarTitle>
        {server.approval ? `Approved until ${formatDateTime(server.approval.until)}. ` : "Calls that need approval are refused until you approve them here. "}
        <Button size="small" icon={<Checkmark20Regular />} disabled={readOnly || busy} onClick={() => onApprove(60)}>
          Approve for 1 hour
        </Button>{" "}
        {server.approval && (
          <Button size="small" disabled={readOnly || revoke.isPending} onClick={() => revoke.mutate(server.id)}>
            Revoke
          </Button>
        )}
      </MessageBarBody>
    </MessageBar>
  );
}

function SelectionPicker({ server, readOnly }: { server: ManagedServer; readOnly: boolean }) {
  const pick = useMcpChange(mcpApi.selection);
  return (
    <>
      <Field label="Selection mode" hint={SELECTION[server.selection].hint}>
        <Select aria-label="Selection mode" value={server.selection} disabled={readOnly || pick.isPending} onChange={(_, d) => isSelection(d.value) && pick.mutate({ id: server.id, selection: d.value })}>
          {SELECTIONS.map((s) => (
            <option key={s} value={s}>
              {SELECTION[s].label}
            </option>
          ))}
        </Select>
      </Field>
      <Caption1>
        Resolver eligible: <b>{server.eligible ? "Yes" : "No"}</b> · Policy: {VERDICT[server.policy.default]}
        {Object.keys(server.policy.capabilities).length ? ` (${Object.entries(server.policy.capabilities).map(([c, v]) => `${c}: ${VERDICT[v]}`).join(", ")})` : ""}
      </Caption1>
      {pick.isError && <ErrorState error={pick.error} title="Not changed" />}
    </>
  );
}

function factsOf(s: ManagedServer): [string, string][] {
  const location = s.runtime.kind === "remote" ? "Remote" : s.runtime.kind === "managed" ? "Orbit Machine Store" : "This machine's PATH";
  const receipt = s.runtime.receipt;
  return [
    ["Ownership", "Orbit Managed"],
    ["Added", s.origin === "catalog" ? "From Orbit's catalog" : "Custom"],
    ["Runtime", RUNTIME[s.runtime.kind]],
    ["Runtime location", location],
    ...(receipt ? ([["Version", receipt.version], ["Receipt", receipt.verified ? `Verified · ${receipt.checksum ?? "no checksum"}` : "Its runtime is missing from the machine store"]] as [string, string][]) : []),
    ["Machine state", s.state === "ready" ? "Ready" : s.why ?? s.state],
    ["Enabled", s.enabled ? "Yes" : "No"],
    ["Connection", connectionLine(s)],
    ["Last checked", s.checkedAt ? `${formatDateTime(s.checkedAt)} (${formatRelative(s.checkedAt)})` : "Never — run Test Connection"],
    [s.definition.transport === "stdio" ? "Command" : "URL", s.definition.transport === "stdio" ? [s.definition.commandRef ? "(the runtime Orbit installed)" : s.definition.command, ...(s.definition.args ?? [])].filter(Boolean).join(" ") : s.definition.url ?? "—"],
  ];
}

export function Facts({ rows }: { rows: [string, string][] }) {
  const styles = useDetailStyles();
  return (
    <dl className={styles.facts}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>
            <Text weight="semibold">{k}</Text>
          </dt>
          <dd className={styles.dd}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Secrets({ server }: { server: ManagedServer }) {
  const styles = useDetailStyles();
  const names = [...(server.definition.requiredHeaders ?? []).map((h) => ({ label: `${h.name} header`, env: h.env, set: h.set })), ...(server.definition.requiredEnv ?? []).map((e) => ({ label: "environment", env: e.name, set: e.set }))];
  if (!names.length) return <Text className={styles.muted}>None needed.</Text>;
  return (
    <ul className={styles.list}>
      {names.map((n) => (
        <li key={`${n.label}:${n.env}`}>
          <Text weight="semibold">{n.env}</Text> <Caption1 className={styles.muted}>({n.label})</Caption1>{" "}
          <Badge appearance="tint" color={n.set ? "success" : "warning"}>
            {n.set ? "Set" : "Not set"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function Words({ words, empty }: { words: string[]; empty: string }) {
  const styles = useDetailStyles();
  if (!words.length) return <Text className={styles.muted}>{empty}</Text>;
  return (
    <ul className={styles.list}>
      {words.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

function Consumers({ server }: { server: ManagedServer }) {
  const styles = useDetailStyles();
  const consumers = server.consumers ?? [];
  if (!consumers.length) return <Text className={styles.muted}>No shipped skill or agent names what it provides.</Text>;
  return (
    <ul className={styles.list} aria-label="Potential consumers">
      {consumers.map((c) => (
        <li key={`${c.id}:${c.requirement}`}>
          <Text weight="semibold">{c.id}</Text> <Caption1 className={styles.muted}>— {c.level === "required" ? "needs" : "can use"} {c.requirement}</Caption1>
        </li>
      ))}
    </ul>
  );
}

function Tools({ id }: { id: string }) {
  const styles = useDetailStyles();
  const tools = useManagedTools(id);
  const known = tools.data?.tools;
  return (
    <Card className={styles.wide} title="Tools" subtitle={tools.data?.checkedAt ? `As found by the test ${formatRelative(tools.data.checkedAt)}${tools.data.fresh ? "" : " — out of date"}.` : "Found by Test Connection; nothing has been tested yet."}>
      {tools.isError && <ErrorState error={tools.error} title="Could not read the tools" />}
      {!known && <Text className={styles.muted}>Tools: Unknown — run Test Connection to find out.</Text>}
      {known && !known.length && <Text className={styles.muted}>The server offers no tools.</Text>}
      {known && known.length > 0 && (
        <ul className={styles.list}>
          {known.map((t) => (
            <li key={t.name}>
              <Text weight="semibold">{t.name}</Text>
              {t.description && <Caption1 className={styles.muted}> — {t.description}</Caption1>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
