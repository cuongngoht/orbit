import { useNavigate, useParams, useSearchParams } from "react-router";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { mcpApi, useExternal, useManaged, useMcpChange, useTestDefinition } from "./mcp.api";
import type { ManagedInput, Policy, Verdict } from "./mcp.types";
import { draftOfExternal, draftOfManaged, emptyDraft, ManagedServerForm, type Draft } from "./ManagedServerForm";
import { managedPath, MCP_PATH } from "./paths";

// Add, then -- when the person chose one -- set the server's default policy:
// two changes to Orbit's own records, never one to a host's configuration.
function useAdd(fn: (input: ManagedInput) => Promise<{ id: string }>) {
  const navigate = useNavigate();
  const add = useMcpChange(async ({ input, policy }: { input: ManagedInput; policy: Verdict }) => {
    const added = await fn(input);
    if (policy !== "allow") await mcpApi.policy({ id: added.id, policy: { default: policy } });
    return added;
  });
  return { add, submit: (input: ManagedInput, policy: Verdict) => add.mutate({ input, policy }, { onSuccess: (s) => navigate(managedPath(s.id)) }) };
}

// `/mcp/new` -- and `/mcp/new?from=<id>`: "Add to Orbit" from a server the host
// has, prefilled with what the host SHOWS (names, masked values) and nothing
// it keeps. Test Connection runs one handshake against what is typed, and
// saves nothing.
export function AddMcpPage() {
  const [params] = useSearchParams();
  const from = params.get("from");
  if (from) return <FromExternal id={from} />;
  return <Adding title="Add a Orbit-managed MCP server" initial={emptyDraft()} />;
}

function FromExternal({ id }: { id: string }) {
  const server = useExternal(id);
  if (server.isPending) return <LoadingState label="Reading what the host shows…" />;
  if (server.isError) return <ErrorState error={server.error} title="Could not read that server" />;
  return <Adding title={`Add ${server.data.name} to Orbit`} initial={draftOfExternal(server.data)} note="A separate, Orbit-managed server: the host's copy stays external and unchanged, and no secret is copied from it." />;
}

function Adding({ title, initial, note }: { title: string; initial: Draft; note?: string }) {
  const navigate = useNavigate();
  const { add, submit } = useAdd(mcpApi.addCustom);
  const test = useTestDefinition();
  return (
    <>
      <PageHeader title={title} description={note ?? "Kept in the machine store, independent of any host. HTTP needs nothing installed; a stdio command is found on this machine. Secrets are named, and read from the environment when Orbit connects."} />
      <ManagedServerForm initial={initial} mode="add" busy={add.isPending} error={add.error} testing={test.isPending} check={test.data?.check ?? null} testError={test.error} onTest={(input) => test.mutate(input)} onSubmit={submit} onCancel={() => navigate(MCP_PATH)} />
    </>
  );
}

// `/mcp/managed/:id/edit`.
export function EditMcpPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const server = useManaged(id);
  const save = useMcpChange(async ({ input, policy }: { input: ManagedInput; policy: Policy }) => (await mcpApi.update({ id, definition: input }), mcpApi.policy({ id, policy })));
  const test = useTestDefinition();
  if (server.isPending) return <LoadingState label="Loading the server…" />;
  if (server.isError) return <ErrorState error={server.error} title="Could not load the server" onRetry={() => server.refetch()} />;
  return (
    <>
      <PageHeader title={`Edit ${server.data.name}`} description="A new definition for the same server in Orbit's records. No host configuration is involved." />
      <ManagedServerForm initial={draftOfManaged(server.data)} mode="edit" busy={save.isPending} error={save.error} testing={test.isPending} check={test.data?.check ?? null} testError={test.error} onTest={(input) => test.mutate(input)} onSubmit={(input, verdict) => save.mutate({ input, policy: { ...server.data.policy, default: verdict } }, { onSuccess: () => navigate(managedPath(id)) })} onCancel={() => navigate(managedPath(id))} />
    </>
  );
}

