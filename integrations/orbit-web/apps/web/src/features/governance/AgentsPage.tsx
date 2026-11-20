// AGENTS & WORKSPACES: the agents a person registered, and the chats placed under governance -- each with one agent and
// the strict profile. A workspace nobody governs runs as Orbit Web always did (legacy); a governed one runs only as the
// Constitution allows, bound to its agent. Moving a governed workspace to another agent, or releasing it, is an
// administrator's.
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text } from "@fluentui/react-components";
import type { AgentList, WorkspaceList } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, CleanSelect, Word, short, useParts, when } from "./parts";

export function AgentsPage() {
  const s = useParts();
  const { can } = useOperator();
  const agents = useResource<AgentList>(() => get("/api/governance/agents"), []);
  const workspaces = useResource<WorkspaceList>(() => get("/api/governance/workspaces"), []);
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useAppEvent("governance.changed", (e) => {
    if (e.data.area === "agents") void agents.reload();
    if (e.data.area === "workspaces") void workspaces.reload();
  });
  useAppEvent("session.summary", () => void workspaces.reload());
  const act = (method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) => {
    setError(null);
    void send(method, path, body)
      .then(() => Promise.all([agents.reload(), workspaces.reload()]))
      .catch((err: unknown) => setError(errorText(err)));
  };
  if (agents.data === null || workspaces.data === null) return agents.error || workspaces.error ? <MessageBar intent="error"><MessageBarBody>{agents.error ?? workspaces.error}</MessageBarBody></MessageBar> : <Spinner label="Reading agents and workspaces…" />;
  const active = agents.data.agents.filter((a) => a.status === "active");
  const agentOptions = active.map((a) => ({ value: a.id, label: a.name }));
  return (
    <div className={s.page}>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <Card title="Agents">
        <div className={s.tableWrap}>
          <Table size="small" aria-label="Agents">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Agent</TableHeaderCell>
                <TableHeaderCell>Runtime</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Registered</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.data.agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Text weight="semibold">{a.name}</Text>
                    <Text size={200} className={s.mono} block>
                      {a.id}
                    </Text>
                  </TableCell>
                  <TableCell>{a.runtime}</TableCell>
                  <TableCell>
                    <Word value={a.status} />
                  </TableCell>
                  <TableCell>{when(a.createdAt)}</TableCell>
                  <TableCell>
                    {can("agents.manage") && (
                      <Button size="small" onClick={() => act("POST", `/api/governance/agents/${a.id}/${a.status === "active" ? "suspend" : "reinstate"}`)}>
                        {a.status === "active" ? "Suspend" : "Reinstate"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {can("agents.manage") && (
          <div className={s.row}>
            <Field label="Register an agent">
              <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="e.g. Claude Code (builds)" />
            </Field>
            <Button
              style={{ alignSelf: "flex-end" }}
              disabled={name.trim() === ""}
              onClick={() => {
                act("POST", "/api/governance/agents", { name });
                setName("");
              }}
            >
              Register
            </Button>
          </div>
        )}
      </Card>
      <Card
        title="Workspaces"
        description="A governed workspace runs only where its agent's isolation was shown (or the Constitution says it is optional), bound to its agent and the revision in effect."
      >
        <div className={s.tableWrap}>
          <Table size="small" aria-label="Workspaces">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Chat</TableHeaderCell>
                <TableHeaderCell>Scope</TableHeaderCell>
                <TableHeaderCell>Agent</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.data.workspaces.map((w) => (
                <TableRow key={w.sessionId}>
                  <TableCell>
                    <Text weight="semibold">{w.title}</Text>
                    <Text size={200} className={s.muted} block>
                      {w.repository ?? "no repository"} · {short(w.sessionId, 8)} · {w.status}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Word value={w.scope} />
                  </TableCell>
                  <TableCell>{w.agentId ? (agents.data?.agents.find((a) => a.id === w.agentId)?.name ?? w.agentId) : "—"}</TableCell>
                  <TableCell>
                    <div className={s.row}>
                      {can("workspaces.govern") && w.status !== "deleted" && active.length > 0 && (
                        <>
                          <CleanSelect
                            ariaLabel={`Agent for ${w.title}`}
                            value={choice[w.sessionId] ?? w.agentId ?? active[0]?.id ?? ""}
                            options={agentOptions}
                            onChange={(value) => setChoice({ ...choice, [w.sessionId]: value })}
                          />
                          <Button size="small" onClick={() => act("PUT", `/api/governance/workspaces/${w.sessionId}`, { agentId: choice[w.sessionId] ?? w.agentId ?? active[0]?.id, profile: "strict" })}>
                            {w.scope === "GOVERNED_WORKSPACE" ? "Update" : "Govern"}
                          </Button>
                        </>
                      )}
                      {w.scope === "GOVERNED_WORKSPACE" && w.status !== "deleted" && can("agents.manage") && (
                        <Button size="small" onClick={() => act("DELETE", `/api/governance/workspaces/${w.sessionId}`)}>
                          Release
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
