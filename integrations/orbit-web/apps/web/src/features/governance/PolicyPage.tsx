// THE ACCOUNT'S POLICY: its revisions and their lifecycle -- draft, validated, published, superseded, discarded. The owner
// edits a draft in the table, validates it, reviews what publishing it would change against the revision in effect
// (worked out by the API from the two policies: what it loosens and what it narrows, its risk and why), and confirms the
// publication of exactly that content (its digest) against exactly that base, at the risk read. One person confirms;
// nobody else is asked, and an agent never confirms anything -- it may hand in a draft, which waits here like any other.
// A rollback is a copy of an earlier revision, taken through the whole lifecycle again.
import {
  Button,
  Checkbox,
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
import { ACTION_KINDS, ENVIRONMENTS, PRINCIPAL_TYPES, checkConstitution, type AccountPolicy, type Impact, type ImpactCell, type RiskLevel } from "@orbit-web/governance-core";
import type { PolicyOverview, RevisionSource, RevisionSummary, RevisionView, SimulateResult } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { PolicyTable } from "./PolicyTable";
import { Card, CleanSelect, ErrorBar, Word, byWhom, short, useParts, when } from "./parts";

// The states in which a revision is still a draft: it may be edited, validated, discarded -- and, validated, published.
const OPEN = new Set(["DRAFT", "VALIDATED"]);

const SOURCES: Record<RevisionSource, string> = {
  owner: "written by you",
  agent: "handed in by an agent",
  default: "the default policy",
  copy: "a copy",
};

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
  reviewSurface: { width: "min(760px, 96vw)", maxWidth: "min(760px, 96vw)" },
  reviewBody: { display: "flex", flexDirection: "column", gap: "12px" },
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

// The document as the table can show it: a policy the shared rules accept, or why it is not one.
function tableable(value: unknown): { document: AccountPolicy | null; problem: string | null } {
  const checked = checkConstitution(value);
  return checked.ok ? { document: checked.value, problem: null } : { document: null, problem: checked.errors.join("; ") };
}

// How a revision is named where another names it: its number once published, otherwise its name and id.
function revisionName(id: string | null, revisions: readonly RevisionSummary[]): string {
  if (id === null) return "nothing: no policy is in effect, so it is compared with the deployment's default policy";
  const r = revisions.find((x) => x.id === id);
  if (r === undefined) return `revision ${short(id, 13)}`;
  return r.revision !== null ? `revision ${r.revision}${r.publishedAt ? `, published ${when(r.publishedAt)}` : ""}` : `${r.name} (${short(r.id, 13)})`;
}

function Cells({ label, cells }: { label: string; cells: ImpactCell[] }) {
  const s = useParts();
  if (cells.length === 0) return null;
  return (
    <div className={s.tableWrap}>
      <Table size="small" aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Action</TableHeaderCell>
            <TableHeaderCell>For</TableHeaderCell>
            <TableHeaderCell>Resource</TableHeaderCell>
            <TableHeaderCell>Where</TableHeaderCell>
            <TableHeaderCell>From → to</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cells.map((c) => (
            <TableRow key={`${c.action}|${c.principalType}|${c.resource}|${c.environments.join(",")}|${c.before}|${c.after}`}>
              <TableCell className={s.mono}>{c.action}</TableCell>
              <TableCell>{c.principalType === "human" ? "you" : `${c.principalType}s`}</TableCell>
              <TableCell className={s.mono}>{c.resource === "*" ? "any other" : c.resource}</TableCell>
              <TableCell>{c.environments.length === ENVIRONMENTS.length ? "anywhere" : c.environments.join(", ")}</TableCell>
              <TableCell>
                <Word value={c.before} /> → <Word value={c.after} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// What publishing a revision would change, as the API worked it out from the two policies.
function ImpactView({ impact }: { impact: Impact }) {
  const s = useParts();
  return (
    <div className={s.page} aria-label="What publishing it changes">
      <div className={s.row}>
        <Text weight="semibold">What it changes</Text>
        <Word value={impact.risk} label={`${impact.risk} risk`} />
      </div>
      {impact.reasons.length === 0 ? (
        <Text className={s.muted}>
          It loosens nothing against the revision in effect{impact.narrowed.length > 0 ? `, and narrows ${impact.narrowed.length} answer(s)` : ""}.
        </Text>
      ) : (
        <div className={s.inset}>
          <ul className={s.list} aria-label="Why it carries this risk">
            {impact.reasons.map((r) => (
              <li key={r}>
                <Text>{r}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {impact.widened.length > 0 && (
        <Text weight="semibold" size={300}>
          It loosens
        </Text>
      )}
      <Cells label="What it loosens" cells={impact.widened} />
      {impact.narrowed.length > 0 && (
        <Text weight="semibold" size={300}>
          It narrows
        </Text>
      )}
      <Cells label="What it narrows" cells={impact.narrowed} />
      {impact.obligations.length > 0 && (
        <ul className={s.list} aria-label="Obligations it changes">
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

// THE OWNER'S CONFIRMATION: what publishing would change, the base it was compared with, and -- above a low risk -- an
// explicit acknowledgement of the risk the API worked out. What is sent names exactly what was read.
function ReviewDialog({ revision, revisions, onClose, onPublished }: { revision: RevisionView; revisions: readonly RevisionSummary[]; onClose: () => void; onPublished: (r: RevisionView) => void }) {
  const s = useParts();
  const styles = useStyles();
  // A change whose impact could not be worked out is confirmed as the API treats it: a high-risk one.
  const risk: RiskLevel = revision.impact?.risk ?? "high";
  const needsAcknowledgement = risk !== "low";
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    setBusy(true);
    setError(null);
    void send<RevisionView>("POST", `/api/governance/revisions/${encodeURIComponent(revision.id)}/publish`, { digest: revision.digest, base: revision.base, acknowledgedRisk: risk })
      .then(onPublished)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={styles.reviewSurface}>
        <DialogBody>
          <DialogTitle>Review changes</DialogTitle>
          <DialogContent className={styles.reviewBody}>
            <Text block>Publishing makes exactly this content your policy in effect at once, for every chat and research workspace of your account and every decision. You confirm it yourself: nobody else is asked.</Text>
            <div className={s.inset}>
              <Text size={200}>
                Content: <span className={s.codeChip}>{revision.digest}</span>
              </Text>
              <Text size={200}>Compared with: {revisionName(revision.base, revisions)}</Text>
            </div>
            {revision.impact ? (
              <ImpactView impact={revision.impact} />
            ) : (
              <MessageBar intent="warning">
                <MessageBarBody>What it would change could not be worked out: it is confirmed as a high-risk change.</MessageBarBody>
              </MessageBar>
            )}
            {needsAcknowledgement && <Checkbox checked={acknowledged} onChange={(_, d) => setAcknowledged(d.checked === true)} label={`I have read what it changes and accept its ${risk} risk`} />}
            <ErrorBar text={error} />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" disabled={busy || (needsAcknowledgement && !acknowledged)} onClick={confirm}>
              {busy ? "Publishing…" : "Confirm and publish"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
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
    void send<SimulateResult>("POST", "/api/governance/simulate", { request: { principalType, action, resource, environment, workspaceId: null, researchWorkspaceId: null }, ...(revisionId ? { revisionId } : {}) })
      .then(setResult)
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <Card title="Simulate a decision" description="Asks this revision what it would decide. Nothing is recorded and nothing is allowed by asking.">
      <div className={styles.simGrid}>
        <Field label="Who" className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={principalType} onChange={setPrincipalType} options={PRINCIPAL_TYPES.map((p) => ({ value: p, label: p === "human" ? "you" : p }))} />}
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
      <ErrorBar text={error} />
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

function RevisionDetail({ revision, revisions, onChanged }: { revision: RevisionView; revisions: readonly RevisionSummary[]; onChanged: (r: RevisionView) => void }) {
  const s = useParts();
  const styles = useStyles();
  const [shown, setShown] = useState(() => tableable(revision.document));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const open = OPEN.has(revision.state);
  const editable = open && shown.document !== null;
  const path = `/api/governance/revisions/${encodeURIComponent(revision.id)}`;
  const act = (method: "POST" | "PUT", to: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    void send<RevisionView>(method, to, body)
      .then((r) => {
        setDirty(false);
        onChanged(r);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  const authors = [...new Set(revision.authors.map(byWhom))];
  return (
    <Card
      title={
        <>
          {revision.name} <Word value={revision.state} /> {revision.risk && <Word value={revision.risk} label={`${revision.risk} risk`} />} {revision.revision !== null && <Text>revision {revision.revision}</Text>}
        </>
      }
      description={
        <>
          Digest <span className={s.codeChip}>{short(revision.digest, 16)}</span> · {SOURCES[revision.source]}
          {revision.basedOn ? ` (from ${short(revision.basedOn, 13)})` : ""} · by {authors.join(", ")}
          {revision.publishedAt ? ` · published ${when(revision.publishedAt)} by ${byWhom(revision.publishedBy)}` : ""}
        </>
      }
    >
      {revision.source === "agent" && open && (
        <MessageBar intent="info">
          <MessageBarBody>An agent handed in this draft. Nothing in it is in effect: read it, and only you can validate, confirm and publish it.</MessageBarBody>
        </MessageBar>
      )}
      {!open && shown.document !== null && (
        <div className={styles.readOnlyRow}>
          <LockClosed16Regular aria-hidden />
          <Text size={200}>Read only: a {revision.state === "DISCARDED" ? "discarded" : "published"} revision never changes. Start a new draft to change your policy.</Text>
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
        <PolicyTable
          document={shown.document}
          editable={editable}
          onChange={(next) => {
            setShown({ document: next, problem: null });
            setDirty(true);
          }}
        />
      ) : (
        <MessageBar intent="warning">
          <MessageBarBody>This revision cannot be shown: {shown.problem}. Start a new draft from the policy in effect.</MessageBarBody>
        </MessageBar>
      )}
      {open && (
        <div className={s.row}>
          {editable && (
            <Button onClick={() => act("PUT", path, { document: shown.document, expectedDigest: revision.digest })} disabled={busy || !dirty}>
              Save draft
            </Button>
          )}
          {revision.state === "DRAFT" && (
            <Button onClick={() => act("POST", `${path}/validate`)} disabled={busy || dirty}>
              Validate
            </Button>
          )}
          {revision.state === "VALIDATED" && (
            <Button appearance="primary" onClick={() => setReviewing(true)} disabled={busy || dirty}>
              Review changes…
            </Button>
          )}
          <Button appearance="subtle" onClick={() => act("POST", `${path}/discard`, { digest: revision.digest })} disabled={busy}>
            Discard
          </Button>
          {dirty && (
            <Text size={200} className={s.muted}>
              Save the draft before you validate or publish it.
            </Text>
          )}
        </div>
      )}
      <ErrorBar text={error} />
      {open && revision.impact && <ImpactView impact={revision.impact} />}
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
                  by {byWhom(h.by)} · {when(h.at)}
                </Text>
                {h.digest && <span className={s.codeChip}>{short(h.digest)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reviewing && (
        <ReviewDialog
          revision={revision}
          revisions={revisions}
          onClose={() => setReviewing(false)}
          onPublished={(r) => {
            setReviewing(false);
            onChanged(r);
          }}
        />
      )}
    </Card>
  );
}

function RevisionAction({ r, draft }: { r: RevisionSummary; draft: (body: object) => void }) {
  if (r.state === "SUPERSEDED")
    return (
      <Button size="small" shape="circular" onClick={() => draft({ from: r.id })}>
        Roll back to this
      </Button>
    );
  if (r.state === "DISCARDED")
    return (
      <Button size="small" shape="circular" onClick={() => draft({ from: r.id })}>
        Start again from this
      </Button>
    );
  return null;
}

export function PolicyPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const styles = useStyles();
  const { isMobile } = useViewport();
  const overview = useResource<PolicyOverview>(() => get("/api/governance/policy"), []);
  const selected = useResource<RevisionView>(item ? () => get(`/api/governance/revisions/${encodeURIComponent(item)}`) : null, [item]);
  const [error, setError] = useState<string | null>(null);
  useAppEvent("governance.changed", (e) => {
    if (e.data.area !== "policy") return;
    void overview.reload();
    if (item) void selected.reload();
  });
  const draft = (body: object) => {
    setError(null);
    void send<RevisionView>("POST", "/api/governance/revisions", body)
      .then((r) => go("policy", r.id))
      .catch((err: unknown) => setError(errorText(err)));
  };

  if (overview.data === null)
    return overview.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{overview.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label="Reading your policy…" />
    );
  const o = overview.data;
  const activeId = item ?? o.effective?.id ?? null;
  return (
    <div className={s.page}>
      <Card
        title="Revisions"
        description="Your account's policy: a draft is validated, reviewed and confirmed by you before it is in effect."
        actions={
          <Button appearance="primary" shape="circular" onClick={() => draft({})}>
            {o.effective ? "New draft from the policy in effect" : "Start from the default policy"}
          </Button>
        }
      >
        {o.effective === null && (
          <MessageBar intent="warning">
            <MessageBarBody>No policy is in effect: nothing a run asks is allowed until you publish one.</MessageBarBody>
          </MessageBar>
        )}
        <ErrorBar text={error} />
        {isMobile ? (
          <div className={styles.revList} aria-label="Revisions">
            {o.revisions.map((r) => (
              <div key={r.id} className={mergeClasses(styles.revCard, r.id === activeId && styles.revCardActive)} aria-current={r.id === activeId ? "true" : undefined}>
                <div className={styles.revTop}>
                  <div className={s.row}>
                    <Button className={styles.nameBtn} appearance="transparent" onClick={() => go("policy", r.id)}>
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
                  <RevisionAction r={r} draft={draft} />
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
                      <Button className={styles.nameBtn} appearance="transparent" onClick={() => go("policy", r.id)}>
                        {r.name}
                      </Button>
                    </TableCell>
                    <TableCell className={styles.colNowrap}>
                      <Word value={r.state} />
                    </TableCell>
                    <TableCell className={styles.colNowrap}>{r.risk ? <Word value={r.risk} /> : "—"}</TableCell>
                    <TableCell className={styles.colUpdated}>{when(r.updatedAt)}</TableCell>
                    <TableCell className={styles.colActions}>
                      <RevisionAction r={r} draft={draft} />
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
          revisions={o.revisions}
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
      {!item && o.effective && <RevisionDetail key={`${o.effective.id}:${o.effective.digest}`} revision={o.effective} revisions={o.revisions} onChanged={() => void overview.reload()} />}
      <Simulation revisionId={item} />
    </div>
  );
}
