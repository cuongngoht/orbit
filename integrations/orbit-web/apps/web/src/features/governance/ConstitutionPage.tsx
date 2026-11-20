// THE COMPANY CONSTITUTION: its revisions and their lifecycle -- draft, validated, pending approval, approved,
// published, superseded -- each move one permission's, on the content the person read (its digest). What publishing a
// revision would change is worked out by the API from the two policies and shown before anybody approves or publishes
// it; a high-risk change is approved by somebody who wrote none of it. A rollback is a copy of an earlier revision,
// published anew.
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
} from "@fluentui/react-components";
import { ACTION_KINDS, ENVIRONMENTS, PRINCIPAL_TYPES, type Impact } from "@orbit-web/governance-core";
import type { ConstitutionOverview, OperatorList, RevisionView, SimulateResult } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, Word, short, useParts, when, who } from "./parts";

const EDITABLE = new Set(["DRAFT", "VALIDATED", "REJECTED"]);

function ImpactView({ impact }: { impact: Impact }) {
  const s = useParts();
  return (
    <div className={s.page} aria-label="What publishing it changes">
      <div className={s.row}>
        <Text weight="semibold">Security impact</Text>
        <Word value={impact.risk} label={`${impact.risk} risk`} />
      </div>
      {impact.reasons.length === 0 ? (
        <Text className={s.muted}>It loosens nothing against the revision in effect{impact.narrowed.length > 0 ? `, and narrows ${impact.narrowed.length} answer(s)` : ""}.</Text>
      ) : (
        <ul className={s.list}>
          {impact.reasons.map((r) => (
            <li key={r}>
              <Text>{r}</Text>
            </li>
          ))}
        </ul>
      )}
      {impact.widened.length > 0 && (
        <div className={s.scroll}>
          <Table size="small" aria-label="What it loosens">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Action</TableHeaderCell>
                <TableHeaderCell>For</TableHeaderCell>
                <TableHeaderCell>Resource</TableHeaderCell>
                <TableHeaderCell>From → to</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {impact.widened.map((c) => (
                <TableRow key={`${c.action}|${c.principalType}|${c.resource}|${c.before}|${c.after}`}>
                  <TableCell className={s.mono}>{c.action}</TableCell>
                  <TableCell>{c.principalType}</TableCell>
                  <TableCell className={s.mono}>{c.resource === "*" ? "any other" : c.resource}</TableCell>
                  <TableCell>
                    <Word value={c.before} /> → <Word value={c.after} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {impact.obligations.length > 0 && (
        <ul className={s.list}>
          {impact.obligations.map((o) => (
            <li key={o.field}>
              <Text>
                {o.field}: {o.before} → {o.after} {o.weakened && <Word value="high" label="weakened" />}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {impact.rules.length > 0 && (
        <Text size={200} className={s.muted}>
          Rules: {impact.rules.map((r) => `${r.change} ${r.id}`).join(" · ")}
        </Text>
      )}
    </div>
  );
}

function Simulation({ revisionId }: { revisionId: string | null }) {
  const s = useParts();
  const [principalType, setPrincipalType] = useState<string>("agent");
  const [action, setAction] = useState<string>("repository.push");
  const [resource, setResource] = useState("");
  const [environment, setEnvironment] = useState<string>("development");
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = () => {
    setError(null);
    void send<SimulateResult>("POST", "/api/governance/simulate", { request: { principalType, action, resource, environment, workspaceId: null, agentId: null, projectId: null }, ...(revisionId ? { revisionId } : {}) })
      .then(setResult)
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <Card title="Simulate a decision">
      <Text size={200} className={s.muted}>
        Asks this revision what it would decide. Nothing is recorded and nothing is allowed by asking.
      </Text>
      <div className={s.row}>
        <Field label="Who">
          <Select value={principalType} onChange={(_, d) => setPrincipalType(d.value)}>
            {PRINCIPAL_TYPES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field label="Action">
          <Select value={action} onChange={(_, d) => setAction(d.value)}>
            {ACTION_KINDS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Resource">
          <Input value={resource} onChange={(_, d) => setResource(d.value)} placeholder="e.g. api.anthropic.com:443" />
        </Field>
        <Field label="Environment">
          <Select value={environment} onChange={(_, d) => setEnvironment(d.value)}>
            {ENVIRONMENTS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </Select>
        </Field>
        <Button onClick={ask} style={{ alignSelf: "flex-end" }}>
          Ask
        </Button>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {result && (
        <div className={s.row} aria-label="Simulated decision">
          <Word value={result.evaluation.verdict} />
          <Text size={200}>held by: {result.evaluation.enforcement}</Text>
          <Text size={200} className={s.mono}>
            {result.evaluation.reasonCodes.join(", ")}
            {result.evaluation.matchedRules.length > 0 ? ` · ${result.evaluation.matchedRules.join(", ")}` : ""}
          </Text>
        </div>
      )}
    </Card>
  );
}

function RevisionDetail({ revision, names, onChanged }: { revision: RevisionView; names: ReadonlyMap<string, string>; onChanged: (r: RevisionView) => void }) {
  const s = useParts();
  const { can } = useOperator();
  const [text, setText] = useState(() => JSON.stringify(revision.document, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "approve" | null>(null);
  const editable = EDITABLE.has(revision.state) && can("constitution.edit");
  const act = (path: string, body?: unknown, method: "POST" | "PUT" = "POST") => {
    setBusy(true);
    setError(null);
    void send<RevisionView>(method, path, body)
      .then(onChanged)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => {
        setBusy(false);
        setConfirm(null);
      });
  };
  const save = () => {
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch (err) {
      setError(`The document is not JSON: ${errorText(err)}`);
      return;
    }
    act(`/api/governance/revisions/${revision.id}`, { document, expectedDigest: revision.digest }, "PUT");
  };
  const base = `/api/governance/revisions/${revision.id}`;
  return (
    <Card
      title={
        <>
          {revision.name} <Word value={revision.state} /> {revision.risk && <Word value={revision.risk} label={`${revision.risk} risk`} />} {revision.revision !== null && <Text>revision {revision.revision}</Text>}
        </>
      }
    >
      <Text size={200} className={s.muted}>
        Digest <span className={s.mono}>{revision.digest}</span> · from {revision.source}
        {revision.basedOn ? ` (${short(revision.basedOn, 13)})` : ""} · written by {revision.authors.map((a) => who(a, names)).join(", ")}
      </Text>
      {revision.errors.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>{revision.errors.join("; ")}</MessageBarBody>
        </MessageBar>
      )}
      {revision.warnings.map((w) => (
        <Text key={`${w.ruleId}:${w.code}`} size={200}>
          <Word value="runtime" label={w.code.toLowerCase().replace(/_/g, " ")} /> {w.ruleId}: {w.message}
        </Text>
      ))}
      <Field label={editable ? "Document (JSON)" : "Document"}>
        <Textarea value={text} onChange={(_, d) => setText(d.value)} readOnly={!editable} resize="vertical" textarea={{ style: { fontFamily: "monospace", minHeight: 280, fontSize: 12 } }} />
      </Field>
      <div className={s.row}>
        {editable && (
          <Button onClick={save} disabled={busy}>
            Save draft
          </Button>
        )}
        {revision.state === "DRAFT" && can("constitution.edit") && (
          <Button onClick={() => act(`${base}/validate`)} disabled={busy}>
            Validate
          </Button>
        )}
        {revision.state === "VALIDATED" && can("constitution.edit") && (
          <Button appearance="primary" onClick={() => act(`${base}/request-approval`)} disabled={busy}>
            Request approval
          </Button>
        )}
        {revision.state === "PENDING_APPROVAL" && can("constitution.approve") && (
          <>
            <Button appearance="primary" onClick={() => setConfirm("approve")} disabled={busy}>
              Approve…
            </Button>
            <Button onClick={() => act(`${base}/reject`, { digest: revision.digest })} disabled={busy}>
              Reject
            </Button>
          </>
        )}
        {revision.state === "APPROVED" && can("constitution.publish") && (
          <Button appearance="primary" onClick={() => setConfirm("publish")} disabled={busy}>
            Publish…
          </Button>
        )}
        {(revision.state === "PENDING_APPROVAL" || revision.state === "APPROVED") && can("constitution.edit") && (
          <Button onClick={() => act(`${base}/withdraw`)} disabled={busy}>
            Withdraw to draft
          </Button>
        )}
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {revision.impact && <ImpactView impact={revision.impact} />}
      {revision.history.length > 0 && (
        <ul className={s.list} aria-label="History">
          {revision.history.map((h) => (
            <li key={h.eventId}>
              <Text size={200}>
                {when(h.at)} · {h.what} by {who(h.by, names)}
                {h.digest ? ` · ${short(h.digest)}` : ""}
              </Text>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={confirm !== null} onOpenChange={(_, d) => !d.open && setConfirm(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{confirm === "publish" ? "Publish this revision?" : "Approve this revision?"}</DialogTitle>
            <DialogContent>
              <Text block>
                {confirm === "publish" ? "It becomes the Constitution in effect at once, for every governed workspace and every decision." : "You approve exactly this content:"} digest{" "}
                <span className={s.mono}>{revision.digest}</span>.
              </Text>
              {revision.impact && <ImpactView impact={revision.impact} />}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button appearance="primary" disabled={busy} onClick={() => act(`${base}/${confirm === "publish" ? "publish" : "approve"}`, { digest: revision.digest })}>
                {confirm === "publish" ? "Publish" : "Approve"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Card>
  );
}

export function ConstitutionPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const { can } = useOperator();
  const overview = useResource<ConstitutionOverview>(() => get("/api/governance/constitution"), []);
  const operators = useResource<OperatorList>(can("operators.read") ? () => get("/api/governance/operators") : null, []);
  const selected = useResource<RevisionView>(item ? () => get(`/api/governance/revisions/${encodeURIComponent(item)}`) : null, [item]);
  const [error, setError] = useState<string | null>(null);
  useAppEvent("governance.changed", (e) => {
    if (e.data.area !== "constitution" && e.data.area !== "overlays") return;
    void overview.reload();
    if (item) void selected.reload();
  });
  const names = useMemo(() => new Map((operators.data?.operators ?? []).map((o) => [o.id, o.username])), [operators.data]);
  const draft = (body: object) => {
    setError(null);
    void send<RevisionView>("POST", "/api/governance/revisions", body)
      .then((r) => go("constitution", r.id))
      .catch((err: unknown) => setError(errorText(err)));
  };

  if (overview.data === null) return overview.error ? <MessageBar intent="error"><MessageBarBody>{overview.error}</MessageBarBody></MessageBar> : <Spinner label="Reading the Constitution…" />;
  const o = overview.data;
  return (
    <div className={s.page}>
      <Card
        title="Revisions"
        actions={
          can("constitution.edit") && (
            <Button appearance="primary" onClick={() => draft({})}>
              {o.effective ? "New draft from the one in effect" : "Start from the default Constitution"}
            </Button>
          )
        }
      >
        {o.effective === null && (
          <MessageBar intent="warning">
            <MessageBarBody>Nothing is published yet. Start from the default Constitution, read it, and take it through validation, approval and publication.</MessageBarBody>
          </MessageBar>
        )}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.scroll}>
          <Table size="small" aria-label="Revisions">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Revision</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>State</TableHeaderCell>
                <TableHeaderCell>Risk</TableHeaderCell>
                <TableHeaderCell>Updated</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.revisions.map((r) => (
                <TableRow key={r.id} aria-selected={r.id === item}>
                  <TableCell>{r.revision ?? "—"}</TableCell>
                  <TableCell>
                    <Button appearance="transparent" onClick={() => go("constitution", r.id)}>
                      {r.name}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Word value={r.state} />
                  </TableCell>
                  <TableCell>{r.risk ? <Word value={r.risk} /> : "—"}</TableCell>
                  <TableCell>{when(r.updatedAt)}</TableCell>
                  <TableCell>
                    {r.state === "SUPERSEDED" && can("constitution.edit") && (
                      <Button size="small" onClick={() => draft({ from: r.id })}>
                        Roll back to this
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
      {item && selected.data && (
        <RevisionDetail
          key={`${selected.data.id}:${selected.data.digest}:${selected.data.state}`}
          revision={selected.data}
          names={names}
          onChanged={(r) => {
            selected.set(r);
            void overview.reload();
          }}
        />
      )}
      {item && selected.error && (
        <MessageBar intent="error">
          <MessageBarBody>{selected.error}</MessageBarBody>
        </MessageBar>
      )}
      {!item && o.effective && <RevisionDetail key={o.effective.id} revision={o.effective} names={names} onChanged={() => void overview.reload()} />}
      <Simulation revisionId={item} />
    </div>
  );
}
