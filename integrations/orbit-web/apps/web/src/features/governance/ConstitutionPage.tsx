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
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { LockClosed16Regular } from "@fluentui/react-icons";
import { ACTION_KINDS, ENVIRONMENTS, PRINCIPAL_TYPES, checkConstitution, type Constitution, type Impact } from "@orbit-web/governance-core";
import type { ConstitutionOverview, OperatorList, RevisionView, SimulateResult } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { useAppEvent } from "../../services/events/AppEvents";
import { ConstitutionTable } from "./ConstitutionTable";
import { Card, CleanSelect, Word, short, useParts, when, who } from "./parts";

const EDITABLE = new Set(["DRAFT", "VALIDATED", "REJECTED"]);

const useStyles = makeStyles({
  colRev: { width: "76px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  colNowrap: { whiteSpace: "nowrap" },
  colUpdated: { whiteSpace: "nowrap", color: tokens.colorNeutralForeground2 },
  colActions: { textAlign: "right", whiteSpace: "nowrap" },
  nameBtn: {
    justifyContent: "flex-start",
    minWidth: "unset",
    paddingLeft: 0,
    paddingRight: 0,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  rowSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  revList: { display: "flex", flexDirection: "column", gap: "8px" },
  revCard: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "12px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    paddingRight: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", "transparent"),
    minWidth: 0,
  },
  revCardActive: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
  },
  revTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
  revFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
  readOnlyRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorNeutralForeground3,
  },
  warnRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    flexWrap: "wrap",
    backgroundColor: tokens.colorPaletteMarigoldBackground1,
    ...shorthands.border("1px", "solid", tokens.colorPaletteMarigoldBorder1),
    borderRadius: "10px",
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    paddingRight: "12px",
  },
  historyList: { display: "flex", flexDirection: "column", gap: "8px", listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0 },
  historyItem: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" },
  historyDot: { width: "7px", height: "7px", borderRadius: "9999px", backgroundColor: tokens.colorBrandForeground1, flexShrink: 0, alignSelf: "center" },
  simGrid: {
    display: "grid",
    gridTemplateColumns: "124px minmax(180px, 1.15fr) minmax(210px, 1.35fr) 144px auto",
    gap: "10px",
    alignItems: "end",
    "@media (max-width: 959px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
    "@media (max-width: 639px)": { gridTemplateColumns: "1fr" },
  },
  simField: { minWidth: 0, width: "100%" },
  simResourceField: {
    minWidth: 0,
    width: "100%",
    "@media (max-width: 959px)": { gridColumn: "1 / -1" },
  },
  simControl: { width: "100%", minWidth: 0 },
  simInput: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
    minHeight: "36px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "42px" },
  },
  simBtnWrap: {
    minWidth: 0,
    "@media (max-width: 959px)": { gridColumn: "1 / -1" },
  },
  simBtn: {
    width: "100%",
    minHeight: "36px",
    borderRadius: "10px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "42px" },
  },
});

// The document as the table can show it: a Constitution the shared rules accept, or why it is not one.
function tableable(value: unknown): { document: Constitution | null; problem: string | null } {
  const checked = checkConstitution(value);
  return checked.ok ? { document: checked.value, problem: null } : { document: null, problem: checked.errors.join("; ") };
}

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
        <div className={s.inset}>
          <ul className={s.list}>
            {impact.reasons.map((r) => (
              <li key={r}>
                <Text>{r}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {impact.widened.length > 0 && (
        <div className={s.tableWrap}>
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
  const styles = useStyles();
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
    <Card title="Simulate a decision" description="Asks this revision what it would decide. Nothing is recorded and nothing is allowed by asking.">
      <div className={styles.simGrid}>
        <Field label="Who" className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={principalType} onChange={setPrincipalType} options={PRINCIPAL_TYPES.map((p) => ({ value: p, label: p }))} />}
        </Field>
        <Field label="Action" className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={action} onChange={setAction} options={ACTION_KINDS.map((a) => ({ value: a, label: a }))} />}
        </Field>
        <Field label="Resource" className={styles.simResourceField}>
          <Input className={styles.simInput} value={resource} onChange={(_, d) => setResource(d.value)} placeholder="e.g. api.anthropic.com:443" />
        </Field>
        <Field label="Environment" className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={environment} onChange={setEnvironment} options={ENVIRONMENTS.map((e) => ({ value: e, label: e }))} />}
        </Field>
        <div className={styles.simBtnWrap}>
          <Button className={styles.simBtn} appearance="secondary" onClick={ask}>
            Ask
          </Button>
        </div>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {result && (
        <div className={s.inset} aria-label="Simulated decision">
          <div className={s.row}>
            <Word value={result.evaluation.verdict} />
            <Text size={200}>held by: {result.evaluation.enforcement}</Text>
            <Text size={200} className={s.mono}>
              {result.evaluation.reasonCodes.join(", ")}
              {result.evaluation.matchedRules.length > 0 ? ` · ${result.evaluation.matchedRules.join(", ")}` : ""}
            </Text>
          </div>
        </div>
      )}
    </Card>
  );
}

function RevisionDetail({ revision, names, onChanged }: { revision: RevisionView; names: ReadonlyMap<string, string>; onChanged: (r: RevisionView) => void }) {
  const s = useParts();
  const styles = useStyles();
  const { can } = useOperator();
  const [shown, setShown] = useState(() => tableable(revision.document));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "approve" | null>(null);
  const editable = EDITABLE.has(revision.state) && can("constitution.edit") && shown.document !== null;
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
  const save = () => act(`/api/governance/revisions/${revision.id}`, { document: shown.document, expectedDigest: revision.digest }, "PUT");
  const base = `/api/governance/revisions/${revision.id}`;
  return (
    <Card
      title={
        <>
          {revision.name} <Word value={revision.state} /> {revision.risk && <Word value={revision.risk} label={`${revision.risk} risk`} />} {revision.revision !== null && <Text>revision {revision.revision}</Text>}
        </>
      }
      description={
        <>
          Digest <span className={s.codeChip}>{short(revision.digest, 16)}</span> · from {revision.source}
          {revision.basedOn ? ` (${short(revision.basedOn, 13)})` : ""} · written by {revision.authors.map((a) => who(a, names)).join(", ")}
        </>
      }
    >
      {!editable && shown.document !== null && (
        <div className={styles.readOnlyRow}>
          <LockClosed16Regular aria-hidden />
          <Text size={200}>{can("constitution.edit") ? "Read-only — choose or start a draft above to edit." : "Read-only revision."}</Text>
        </div>
      )}
      {revision.errors.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>{revision.errors.join("; ")}</MessageBarBody>
        </MessageBar>
      )}
      {revision.warnings.map((w) => (
        <div key={`${w.ruleId}:${w.code}`} className={styles.warnRow}>
          <Word value="runtime" label={w.code.toLowerCase().replace(/_/g, " ")} />
          <Text size={200}>
            <span className={s.mono}>{w.ruleId}</span>: {w.message}
          </Text>
        </div>
      ))}
      {shown.document !== null ? (
        <ConstitutionTable document={shown.document} editable={editable} onChange={(next) => setShown({ document: next, problem: null })} />
      ) : (
        <MessageBar intent="warning">
          <MessageBarBody>This revision cannot be shown: {shown.problem}. Start a new draft from the one in effect.</MessageBarBody>
        </MessageBar>
      )}
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
        <div className={s.inset}>
          <Text weight="semibold" size={300}>
            Revision history
          </Text>
          <ul className={styles.historyList} aria-label="History">
            {revision.history.map((h) => (
              <li key={h.eventId} className={styles.historyItem}>
                <span className={styles.historyDot} aria-hidden />
                <Text size={200} weight="semibold">
                  {h.what}
                </Text>
                <Text size={200} className={s.muted}>
                  by {who(h.by, names)} · {when(h.at)}
                </Text>
                {h.digest && <span className={s.codeChip}>{short(h.digest)}</span>}
              </li>
            ))}
          </ul>
        </div>
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
  const styles = useStyles();
  const { isMobile } = useViewport();
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
  const activeId = item ?? o.effective?.id ?? null;
  return (
    <div className={s.page}>
      <Card
        title="Revisions"
        actions={
          can("constitution.edit") && (
            <Button appearance="primary" shape="circular" onClick={() => draft({})}>
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
        {isMobile ? (
          <div className={styles.revList} aria-label="Revisions">
            {o.revisions.map((r) => (
              <div key={r.id} className={mergeClasses(styles.revCard, r.id === activeId && styles.revCardActive)} aria-current={r.id === activeId ? "true" : undefined}>
                <div className={styles.revTop}>
                  <div className={s.row}>
                    <Button className={styles.nameBtn} appearance="transparent" onClick={() => go("constitution", r.id)}>
                      {r.name}
                    </Button>
                    <Text size={200} className={s.muted}>
                      {r.revision !== null ? `Revision ${r.revision}` : "Draft"}
                    </Text>
                  </div>
                  <div className={s.row}>
                    <Word value={r.state} />
                    {r.risk && <Word value={r.risk} />}
                  </div>
                </div>
                <div className={styles.revFoot}>
                  <Text size={200} className={s.muted}>
                    {when(r.updatedAt)}
                  </Text>
                  {r.state === "SUPERSEDED" && can("constitution.edit") && (
                    <Button size="small" shape="circular" onClick={() => draft({ from: r.id })}>
                      Roll back to this
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={s.tableWrap}>
            <Table size="small" aria-label="Revisions">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={styles.colRev}>Revision</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell className={styles.colNowrap}>State</TableHeaderCell>
                  <TableHeaderCell className={styles.colNowrap}>Risk</TableHeaderCell>
                  <TableHeaderCell className={styles.colNowrap}>Updated</TableHeaderCell>
                  <TableHeaderCell className={styles.colActions} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.revisions.map((r) => (
                  <TableRow key={r.id} className={r.id === activeId ? styles.rowSelected : undefined} aria-selected={r.id === activeId}>
                    <TableCell className={styles.colRev}>{r.revision ?? "—"}</TableCell>
                    <TableCell>
                      <Button className={styles.nameBtn} appearance="transparent" onClick={() => go("constitution", r.id)}>
                        {r.name}
                      </Button>
                    </TableCell>
                    <TableCell className={styles.colNowrap}>
                      <Word value={r.state} />
                    </TableCell>
                    <TableCell className={styles.colNowrap}>{r.risk ? <Word value={r.risk} /> : "—"}</TableCell>
                    <TableCell className={styles.colUpdated}>{when(r.updatedAt)}</TableCell>
                    <TableCell className={styles.colActions}>
                      {r.state === "SUPERSEDED" && can("constitution.edit") && (
                        <Button size="small" shape="circular" onClick={() => draft({ from: r.id })}>
                          Roll back to this
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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
