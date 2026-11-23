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
import { DecisionsIcon, PolicyIcon } from "../../components/SectionIcons";
import { ACTION_KINDS, ENVIRONMENTS, PRINCIPAL_TYPES, checkConstitution, type AccountPolicy, type Impact, type ImpactCell, type RiskLevel } from "@orbit-web/governance-core";
import type { PolicyOverview, RevisionSource, RevisionSummary, RevisionView, SimulateResult } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { EmployeeNetworkSection, splitNetwork, type EmployeeNetwork } from "./EmployeeNetwork";
import { PolicyTable } from "./PolicyTable";
import { Card, CleanSelect, ErrorBar, Word, byWhom, short, useParts, when } from "./parts";

// The states in which a revision is still a draft: it may be edited, validated, discarded -- and, validated, published.
const OPEN = new Set(["DRAFT", "VALIDATED"]);

const SOURCE_KEYS: Record<RevisionSource, MessageKey> = {
  owner: "governance.policy.source.owner",
  agent: "governance.policy.source.agent",
  default: "governance.policy.source.default",
  copy: "governance.policy.source.copy",
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
  if (id === null) return tr("governance.policy.revName.none");
  const r = revisions.find((x) => x.id === id);
  if (r === undefined) return tr("governance.policy.revName.unknown", { id: short(id, 13) });
  return r.revision !== null
    ? tr("governance.policy.revName.published", {
        revision: r.revision,
        published: r.publishedAt ? tr("governance.policy.revName.publishedAt", { at: when(r.publishedAt) }) : "",
      })
    : `${r.name} (${short(r.id, 13)})`;
}

function Cells({ label, cells }: { label: string; cells: ImpactCell[] }) {
  const { t } = useI18n();
  const s = useParts();
  if (cells.length === 0) return null;
  return (
    <div className={s.tableWrap}>
      <Table size="small" aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>{t("governance.policy.colAction")}</TableHeaderCell>
            <TableHeaderCell>{t("governance.policy.colFor")}</TableHeaderCell>
            <TableHeaderCell>{t("governance.policy.colResource")}</TableHeaderCell>
            <TableHeaderCell>{t("governance.policy.colWhere")}</TableHeaderCell>
            <TableHeaderCell>{t("governance.policy.colFromTo")}</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cells.map((c) => (
            <TableRow key={`${c.action}|${c.principalType}|${c.resource}|${c.environments.join(",")}|${c.before}|${c.after}`}>
              <TableCell className={s.mono}>{c.action}</TableCell>
              <TableCell>{c.principalType === "human" ? t("governance.parts.principal.you") : t("governance.policy.principalPlural", { type: c.principalType })}</TableCell>
              <TableCell className={s.mono}>{c.resource === "*" ? t("governance.policy.anyOtherResource") : c.resource}</TableCell>
              <TableCell>{c.environments.length === ENVIRONMENTS.length ? t("governance.policy.anywhere") : c.environments.join(", ")}</TableCell>
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
  const { t } = useI18n();
  const s = useParts();
  return (
    <div className={s.page} aria-label={t("governance.policy.impactAria")}>
      <div className={s.row}>
        <Text weight="semibold">{t("governance.policy.whatItChanges")}</Text>
        <Word value={impact.risk} label={t("governance.policy.riskBadge", { risk: impact.risk })} />
      </div>
      {impact.reasons.length === 0 ? (
        <Text className={s.muted}>
          {t("governance.policy.loosensNothing", {
            narrowed: impact.narrowed.length > 0 ? t("governance.policy.narrowsCount", { count: impact.narrowed.length }) : "",
          })}
        </Text>
      ) : (
        <div className={s.inset}>
          <ul className={s.list} aria-label={t("governance.policy.whyRiskAria")}>
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
          {t("governance.policy.itLoosens")}
        </Text>
      )}
      <Cells label={t("governance.policy.whatItLoosens")} cells={impact.widened} />
      {impact.narrowed.length > 0 && (
        <Text weight="semibold" size={300}>
          {t("governance.policy.itNarrows")}
        </Text>
      )}
      <Cells label={t("governance.policy.whatItNarrows")} cells={impact.narrowed} />
      {impact.obligations.length > 0 && (
        <ul className={s.list} aria-label={t("governance.policy.obligationsAria")}>
          {impact.obligations.map((o) => (
            <li key={o.field}>
              <Text>
                {o.field}: {o.before} → {o.after} {o.weakened && <Word value="high" label={t("governance.policy.weakened")} />}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {impact.rules.length > 0 && (
        <Text size={200} className={s.muted}>
          {t("governance.policy.rulesLine", { rules: impact.rules.map((r) => `${r.change} ${r.id}`).join(" · ") })}
        </Text>
      )}
    </div>
  );
}

// THE OWNER'S CONFIRMATION: what publishing would change, the base it was compared with, and -- above a low risk -- an
// explicit acknowledgement of the risk the API worked out. What is sent names exactly what was read.
function ReviewDialog({ revision, revisions, onClose, onPublished }: { revision: RevisionView; revisions: readonly RevisionSummary[]; onClose: () => void; onPublished: (r: RevisionView) => void }) {
  const { t } = useI18n();
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
          <DialogTitle>{t("governance.policy.reviewTitle")}</DialogTitle>
          <DialogContent className={styles.reviewBody}>
            <Text block>{t("governance.policy.reviewIntro")}</Text>
            <div className={s.inset}>
              <Text size={200}>
                {t("governance.policy.contentPrefix")}
                <span className={s.codeChip}>{revision.digest}</span>
              </Text>
              <Text size={200}>{t("governance.policy.comparedWith", { name: revisionName(revision.base, revisions) })}</Text>
            </div>
            {revision.impact ? (
              <ImpactView impact={revision.impact} />
            ) : (
              <MessageBar intent="warning">
                <MessageBarBody>{t("governance.policy.impactUnread")}</MessageBarBody>
              </MessageBar>
            )}
            {needsAcknowledgement && <Checkbox checked={acknowledged} onChange={(_, d) => setAcknowledged(d.checked === true)} label={t("governance.policy.ackRisk", { risk })} />}
            <ErrorBar text={error} />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("governance.approval.cancel")}</Button>
            <Button appearance="primary" disabled={busy || (needsAcknowledgement && !acknowledged)} onClick={confirm}>
              {busy ? t("governance.policy.publishing") : t("governance.policy.confirmAndPublish")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function Simulation({ revisionId }: { revisionId: string | null }) {
  const { t } = useI18n();
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
    <Card title={t("governance.policy.simTitle")} icon={<DecisionsIcon size={18} />} tone="teal" description={t("governance.policy.simDescription")}>
      <div className={styles.simGrid}>
        <Field label={t("governance.policy.simWho")} className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={principalType} onChange={setPrincipalType} options={PRINCIPAL_TYPES.map((p) => ({ value: p, label: p === "human" ? t("governance.parts.principal.you") : p }))} />}
        </Field>
        <Field label={t("governance.policy.simAction")} className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={action} onChange={setAction} options={ACTION_KINDS.map((a) => ({ value: a, label: a }))} />}
        </Field>
        <Field label={t("governance.policy.simResource")} className={styles.simResourceField}>
          <Input className={styles.simInput} value={resource} onChange={(_, d) => setResource(d.value)} placeholder={t("governance.policy.simResourcePlaceholder")} />
        </Field>
        <Field label={t("governance.policy.simEnv")} className={styles.simField}>
          {(fp) => <CleanSelect className={styles.simControl} fieldProps={fp} value={environment} onChange={setEnvironment} options={ENVIRONMENTS.map((e) => ({ value: e, label: e }))} />}
        </Field>
        <div className={styles.simBtnWrap}>
          <Button className={styles.simBtn} appearance="secondary" onClick={ask}>
            {t("governance.policy.simAsk")}
          </Button>
        </div>
      </div>
      <ErrorBar text={error} />
      {result && (
        <div className={s.inset} aria-label={t("governance.policy.simResultAria")}>
          <div className={s.row}>
            <Word value={result.evaluation.verdict} />
            <Text size={200}>{t("governance.policy.simHeldBy", { enforcement: result.evaluation.enforcement })}</Text>
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
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  // The employee network section edits its own part of the document; the table edits the rest.
  const [shown, setShown] = useState(() => tableable(splitNetwork(revision.document).rest));
  const [network, setNetwork] = useState<EmployeeNetwork | null>(() => splitNetwork(revision.document).network);
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
          {revision.name} <Word value={revision.state} /> {revision.risk && <Word value={revision.risk} label={t("governance.policy.riskBadge", { risk: revision.risk })} />} {revision.revision !== null && <Text>{t("governance.policy.revBadge", { revision: revision.revision })}</Text>}
        </>
      }
      description={
        <>
          {t("governance.policy.digestPrefix")}
          <span className={s.codeChip}>{short(revision.digest, 16)}</span> · {t(SOURCE_KEYS[revision.source])}
          {revision.basedOn ? t("governance.policy.fromShort", { id: short(revision.basedOn, 13) }) : ""}
          {(!revision.publishedAt || byWhom(revision.publishedBy) !== authors.join(", ")) && t("governance.policy.byAuthors", { authors: authors.join(", ") })}
          {revision.publishedAt ? t("governance.policy.publishedBy", { at: when(revision.publishedAt), by: byWhom(revision.publishedBy) }) : ""}
        </>
      }
    >
      {revision.source === "agent" && open && (
        <MessageBar intent="info">
          <MessageBarBody>{t("governance.policy.agentDraftBanner")}</MessageBarBody>
        </MessageBar>
      )}
      {!open && shown.document !== null && (
        <div className={styles.readOnlyRow}>
          <LockClosed16Regular aria-hidden />
          <Text size={200}>{t("governance.policy.readOnlyBanner", { kind: t(revision.state === "DISCARDED" ? "governance.policy.kindDiscarded" : "governance.policy.kindPublished") })}</Text>
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
          <MessageBarBody>{t("governance.policy.cannotShow", { problem: shown.problem ?? "" })}</MessageBarBody>
        </MessageBar>
      )}
      {shown.document !== null && (
        <EmployeeNetworkSection
          value={network}
          editable={editable}
          onChange={(next) => {
            setNetwork(next);
            setDirty(true);
          }}
        />
      )}
      {open && (
        <div className={s.row}>
          {editable && (
            <Button onClick={() => act("PUT", path, { document: network !== null ? { ...shown.document, employeeNetwork: network } : shown.document, expectedDigest: revision.digest })} disabled={busy || !dirty}>
              {t("governance.policy.saveDraft")}
            </Button>
          )}
          {revision.state === "DRAFT" && (
            <Button onClick={() => act("POST", `${path}/validate`)} disabled={busy || dirty}>
              {t("governance.policy.validate")}
            </Button>
          )}
          {revision.state === "VALIDATED" && (
            <Button appearance="primary" onClick={() => setReviewing(true)} disabled={busy || dirty}>
              {t("governance.policy.reviewChangesEllipsis")}
            </Button>
          )}
          <Button appearance="subtle" onClick={() => act("POST", `${path}/discard`, { digest: revision.digest })} disabled={busy}>
            {t("governance.policy.discard")}
          </Button>
          {dirty && (
            <Text size={200} className={s.muted}>
              {t("governance.policy.dirtyHint")}
            </Text>
          )}
        </div>
      )}
      <ErrorBar text={error} />
      {open && revision.impact && <ImpactView impact={revision.impact} />}
      {revision.history.length > 0 && (
        <div className={s.inset}>
          <Text weight="semibold" size={300}>
            {t("governance.policy.historyTitle")}
          </Text>
          <ul className={styles.historyList} aria-label={t("governance.policy.historyAria")}>
            {revision.history.map((h) => (
              <li key={h.eventId} className={styles.historyItem}>
                <span className={styles.historyDot} aria-hidden />
                <Text size={200} weight="semibold">
                  {h.what}
                </Text>
                <Text size={200} className={s.muted}>
                  {t("governance.policy.historyBy", { by: byWhom(h.by), at: when(h.at) })}
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
  const { t } = useI18n();
  if (r.state === "SUPERSEDED")
    return (
      <Button size="small" shape="circular" onClick={() => draft({ from: r.id })}>
        {t("governance.policy.rollback")}
      </Button>
    );
  if (r.state === "DISCARDED")
    return (
      <Button size="small" shape="circular" onClick={() => draft({ from: r.id })}>
        {t("governance.policy.startAgain")}
      </Button>
    );
  return null;
}

export function PolicyPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
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
      <Spinner label={t("governance.policy.reading")} />
    );
  const o = overview.data;
  const activeId = item ?? o.effective?.id ?? null;
  return (
    <div className={s.page}>
      <Card
        title={t("governance.policy.revisionsTitle")}
        icon={<PolicyIcon size={18} />}
        tone="brand"
        description={t("governance.policy.revisionsDesc")}
        actions={
          <Button appearance="primary" shape="circular" style={{ flexShrink: 0 }} onClick={() => draft({})}>
            {o.effective ? t("governance.policy.newDraft") : t("governance.policy.startFromDefault")}
          </Button>
        }
      >
        {o.effective === null && (
          <MessageBar intent="warning">
            <MessageBarBody>{t("governance.overview.noPolicy")}</MessageBarBody>
          </MessageBar>
        )}
        <ErrorBar text={error} />
        {isMobile ? (
          <div className={styles.revList} aria-label={t("governance.policy.revisionsTitle")}>
            {o.revisions.map((r) => (
              <div key={r.id} className={mergeClasses(styles.revCard, r.id === activeId && styles.revCardActive)} aria-current={r.id === activeId ? "true" : undefined}>
                <div className={styles.revTop}>
                  <div className={s.row}>
                    <Button className={styles.nameBtn} appearance="transparent" onClick={() => go("policy", r.id)}>
                      {r.name}
                    </Button>
                    <Text size={200} className={s.muted}>
                      {r.revision !== null ? t("governance.policy.revisionNumber", { revision: r.revision }) : t("governance.policy.draftWord")}
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
            <Table size="small" aria-label={t("governance.policy.revisionsTitle")}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={styles.colRev}>{t("governance.policy.colRevision")}</TableHeaderCell>
                  <TableHeaderCell>{t("governance.policy.colName")}</TableHeaderCell>
                  <TableHeaderCell className={styles.colNowrap}>{t("governance.policy.colState")}</TableHeaderCell>
                  <TableHeaderCell className={styles.colNowrap}>{t("governance.policy.colRisk")}</TableHeaderCell>
                  <TableHeaderCell className={styles.colNowrap}>{t("governance.policy.colUpdated")}</TableHeaderCell>
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
