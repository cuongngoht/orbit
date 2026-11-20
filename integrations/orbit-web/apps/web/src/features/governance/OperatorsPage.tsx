// USERS & ROLES: the people who administer governance. An owner adds an operator with a first password (they change it
// once signed in), gives and takes roles -- never their own --, suspends an operator (their sessions end at once) and
// ends an operator's sessions. Roles are read on every request: a change holds from the very next one.
import { Button, Checkbox, Field, Input, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, tokens } from "@fluentui/react-components";
import { OPERATOR_ROLES, type OperatorRole } from "@orbit-web/governance-core";
import type { OperatorList, OperatorView } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, Word, useParts, when } from "./parts";

const roleName = (r: string): string => r.replace(/_/g, " ");

function NewOperator({ onCreated }: { onCreated: () => void }) {
  const s = useParts();
  const { can } = useOperator();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<OperatorRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    setError(null);
    void send("POST", "/api/governance/operators", { username, displayName: displayName || username, password, roles })
      .then(() => {
        setUsername("");
        setDisplayName("");
        setPassword("");
        setRoles([]);
        onCreated();
      })
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <Card title="Add an operator">
      <div className={s.row}>
        <Field label="Username">
          <Input value={username} onChange={(_, d) => setUsername(d.value.toLowerCase())} />
        </Field>
        <Field label="Name">
          <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
        </Field>
        <Field label="First password" hint="At least 12 characters">
          <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} autoComplete="new-password" />
        </Field>
      </div>
      {can("roles.manage") && (
        <div className={s.row} role="group" aria-label="Roles">
          {OPERATOR_ROLES.map((r) => (
            <Checkbox key={r} label={roleName(r)} checked={roles.includes(r)} onChange={(_, d) => setRoles(d.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
          ))}
        </div>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div>
        <Button appearance="primary" onClick={create} disabled={username.length < 2 || password.length < 12}>
          Add operator
        </Button>
      </div>
    </Card>
  );
}

function Row({ o, self, onChanged }: { o: OperatorView; self: boolean; onChanged: () => void }) {
  const { can } = useOperator();
  const s = useParts();
  const [error, setError] = useState<string | null>(null);
  const act = (path: string, body?: unknown) => {
    setError(null);
    void send("POST", `/api/governance/operators/${o.id}${path}`, body)
      .then(onChanged)
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <TableRow>
      <TableCell>
        <Text weight="semibold">{o.username}</Text>
        <Text size={200} className={s.muted} block>
          {o.displayName}
          {self ? " (you)" : ""}
        </Text>
      </TableCell>
      <TableCell>
        <div className={s.row}>
          {OPERATOR_ROLES.map((r) =>
            can("roles.manage") && !self ? (
              <Checkbox key={r} label={roleName(r)} checked={o.roles.includes(r)} onChange={(_, d) => act("/roles", d.checked ? { grant: [r] } : { revoke: [r] })} />
            ) : o.roles.includes(r) ? (
              <Word key={r} value="informative" label={roleName(r)} />
            ) : null,
          )}
        </div>
        {error && (
          <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
            {error}
          </Text>
        )}
      </TableCell>
      <TableCell>
        <Word value={o.status} />
      </TableCell>
      <TableCell>{when(o.createdAt)}</TableCell>
      <TableCell>
        {can("operators.manage") && !self && (
          <div className={s.row}>
            {o.status === "active" ? <Button size="small" onClick={() => act("/suspend")}>Suspend</Button> : <Button size="small" onClick={() => act("/reinstate")}>Reinstate</Button>}
            <Button size="small" onClick={() => act("/sessions/revoke")}>
              End sessions
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function OperatorsPage() {
  const s = useParts();
  const { can, state } = useOperator();
  const list = useResource<OperatorList>(() => get("/api/governance/operators"), []);
  useAppEvent("governance.changed", (e) => e.data.area === "operators" && void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label="Reading the operators…" />;
  const me = state?.session?.operator.id ?? null;
  return (
    <div className={s.page}>
      <Card title="Operators">
        <div className={s.tableWrap}>
          <Table size="small" aria-label="Operators">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Operator</TableHeaderCell>
                <TableHeaderCell>Roles</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Since</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.operators.map((o) => (
                <Row key={o.id} o={o} self={o.id === me} onChanged={() => void list.reload()} />
              ))}
            </TableBody>
          </Table>
        </div>
        <Text size={200} className={s.muted}>
          An operator never changes their own roles, and the organization always keeps one active owner. An agent is never an operator.
        </Text>
      </Card>
      {can("operators.manage") && <NewOperator onCreated={() => void list.reload()} />}
    </div>
  );
}
