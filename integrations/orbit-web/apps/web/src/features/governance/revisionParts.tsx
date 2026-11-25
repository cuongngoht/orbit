// A POLICY'S REVISIONS, as a page shows them -- the company's policy (PolicyPage) and a department's
// (DepartmentPolicyPage) alike: the list of revisions and their states, a revision's name, notices and history, the steps
// of a draft, what publishing it would change (worked out by the API from the two policies: what it loosens and what it
// narrows, its risk and why), and the owner's confirmation of exactly that content against exactly that base, at the
// risk read. Each page says what a revision is compared with and sends its publication itself; nobody else is asked, and
// an agent never confirms anything -- it may hand in a draft, which waits like any other.
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
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
import { ENVIRONMENTS, type Impact, type ImpactCell, type RiskLevel } from "@orbit-web/governance-core";
import type { RevisionSource, RevisionStep, RevisionSummary, RevisionView } from "@orbit-web/contracts";
import { useState, type ReactNode } from "react";
import { useViewport } from "../../hooks/useViewport";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { ApiError, errorText } from "../../services/api";
import { Word, byWhom, short, useParts, when } from "./parts";

// The states in which a revision is still a draft: it may be edited, validated, discarded -- and, validated, published.
export const OPEN = new Set(["DRAFT", "VALIDATED"]);

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
  problems: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px", marginBottom: 0, paddingLeft: "18px", overflowWrap: "anywhere" },
});

// How a revision is named where another names it: its number once published, otherwise its name and id. `none` says
// what there is to compare with when no revision is in effect.
export function revisionName(id: string | null, revisions: readonly RevisionSummary[], none: string = tr("governance.policy.revName.none")): string {
  if (id === null) return none;
  const r = revisions.find((x) => x.id === id);
  if (r === undefined) return tr("governance.policy.revName.unknown", { id: short(id, 13) });
  return r.revision !== null
    ? tr("governance.policy.revName.published", {
        revision: r.revision,
        published: r.publishedAt ? tr("governance.policy.revName.publishedAt", { at: when(r.publishedAt) }) : "",
      })
    : `${r.name} (${short(r.id, 13)})`;
}

// ---- a refusal ----------------------------------------------------------------------------------------------------------

// What the API refuses because something read moved on since: the revision itself, the policy in effect it was compared
// with, or -- for a department's -- the company's policy in effect.
const MOVED = new Set(["stale_revision", "stale_base", "stale_company_policy"]);

export interface Refusal {
  text: string;
  // Each problem the API named, for a draft it refused as invalid (422).
  problems: string[];
  // Something read moved on since: read it again.
  moved: boolean;
}

function problemsOf(err: unknown): string[] {
  if (!(err instanceof ApiError) || err.status !== 422) return [];
  const errors = typeof err.details === "object" && err.details !== null ? (err.details as { errors?: unknown }).errors : undefined;
  return Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string") : [];
}

// A refusal as the API said it: its own sentence -- without the problems it names, listed one by one below it -- and
// whether something read moved on.
export function refusalOf(err: unknown): Refusal {
  const text = errorText(err);
  const problems = problemsOf(err);
  const listed = `: ${problems.join("; ")}`;
  return {
    text: problems.length > 0 && text.endsWith(listed) ? `${text.slice(0, -listed.length)}:` : text,
    problems,
    moved: err instanceof ApiError && err.status === 409 && MOVED.has(err.code),
  };
}

export function RefusalBar({ refusal, onReload }: { refusal: Refusal | null; onReload?: () => void }) {
  const { t } = useI18n();
  const styles = useStyles();
  if (refusal === null) return null;
  const reload = refusal.moved && onReload !== undefined;
  return (
    <MessageBar intent={reload ? "warning" : "error"} layout="multiline">
      <MessageBarBody>
        {refusal.text}
        {refusal.problems.length > 0 && (
          <ul className={styles.problems} aria-label={t("governance.revisions.problemsAria")}>
            {refusal.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </MessageBarBody>
      {reload && (
        <MessageBarActions>
          <Button size="small" onClick={onReload}>
            {t("governance.revisions.readAgain")}
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}

// ---- what publishing would change -----------------------------------------------------------------------------------------

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
export function ImpactView({ impact }: { impact: Impact }) {
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

// THE OWNER'S CONFIRMATION: what publishing would change, what it was compared with, and -- above a low risk -- an
// explicit acknowledgement of the risk the API worked out. `publish` sends exactly what was read; a refusal because
// something read moved on offers to read it all again (`onReload`).
export function ReviewDialog<R extends RevisionView>({
  revision,
  comparedWith,
  intro,
  extra,
  publish,
  onClose,
  onPublished,
  onReload,
}: {
  revision: RevisionView;
  comparedWith: string;
  intro: string;
  extra?: ReactNode;
  publish: (acknowledgedRisk: RiskLevel) => Promise<R>;
  onClose: () => void;
  onPublished: (r: R) => void;
  onReload?: () => void;
}) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  // A change whose impact could not be worked out is confirmed as the API treats it: a high-risk one.
  const risk: RiskLevel = revision.impact?.risk ?? "high";
  const needsAcknowledgement = risk !== "low";
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const confirm = () => {
    setBusy(true);
    setRefusal(null);
    void publish(risk)
      .then(onPublished)
      .catch((err: unknown) => setRefusal(refusalOf(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={styles.reviewSurface}>
        <DialogBody>
          <DialogTitle>{t("governance.policy.reviewTitle")}</DialogTitle>
          <DialogContent className={styles.reviewBody}>
            <Text block>{intro}</Text>
            <div className={s.inset}>
              <Text size={200}>
                {t("governance.policy.contentPrefix")}
                <span className={s.codeChip}>{revision.digest}</span>
              </Text>
              <Text size={200}>{t("governance.policy.comparedWith", { name: comparedWith })}</Text>
              {extra}
            </div>
            {revision.impact ? (
              <ImpactView impact={revision.impact} />
            ) : (
              <MessageBar intent="warning">
                <MessageBarBody>{t("governance.policy.impactUnread")}</MessageBarBody>
              </MessageBar>
            )}
            {needsAcknowledgement && <Checkbox checked={acknowledged} onChange={(_, d) => setAcknowledged(d.checked === true)} label={t("governance.policy.ackRisk", { risk })} />}
            <RefusalBar refusal={refusal} onReload={onReload} />
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

// ---- one revision ---------------------------------------------------------------------------------------------------------

export function RevisionTitle({ revision }: { revision: RevisionView }) {
  const { t } = useI18n();
  return (
    <>
      {revision.name} <Word value={revision.state} /> {revision.risk && <Word value={revision.risk} label={t("governance.policy.riskBadge", { risk: revision.risk })} />} {revision.revision !== null && <Text>{t("governance.policy.revBadge", { revision: revision.revision })}</Text>}
    </>
  );
}

export function RevisionDescription({ revision }: { revision: RevisionView }) {
  const { t } = useI18n();
  const s = useParts();
  const authors = [...new Set(revision.authors.map((a) => byWhom(a)))];
  return (
    <>
      {t("governance.policy.digestPrefix")}
      <span className={s.codeChip}>{short(revision.digest, 16)}</span> · {t(SOURCE_KEYS[revision.source])}
      {revision.basedOn ? t("governance.policy.fromShort", { id: short(revision.basedOn, 13) }) : ""}
      {(!revision.publishedAt || byWhom(revision.publishedBy) !== authors.join(", ")) && t("governance.policy.byAuthors", { authors: authors.join(", ") })}
      {revision.publishedAt ? t("governance.policy.publishedBy", { at: when(revision.publishedAt), by: byWhom(revision.publishedBy) }) : ""}
    </>
  );
}

// What a revision says about itself before it is read: an agent's draft waits for the owner; one that is no longer a draft
// never changes (said when it can be shown); what is wrong with it; what a valid one still cannot do.
export function RevisionNotices({ revision, readable }: { revision: RevisionView; readable: boolean }) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  const open = OPEN.has(revision.state);
  return (
    <>
      {revision.source === "agent" && open && (
        <MessageBar intent="info">
          <MessageBarBody>{t("governance.policy.agentDraftBanner")}</MessageBarBody>
        </MessageBar>
      )}
      {!open && readable && (
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
    </>
  );
}

// The steps of a draft: save what was changed, validate what was saved, review and confirm what was validated, or
// discard it. Nothing for a revision that is no longer a draft.
export function LifecycleBar({
  revision,
  editable,
  dirty,
  busy,
  onSave,
  onValidate,
  onReview,
  onDiscard,
}: {
  revision: RevisionView;
  editable: boolean;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onValidate: () => void;
  onReview: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  const s = useParts();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  if (!OPEN.has(revision.state)) return null;
  return (
    <div
      className={s.row}
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 5,
        backgroundColor: "var(--orbit-card-bg)",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingTop: "10px",
        paddingBottom: "6px",
      }}
    >
      {editable && (
        <Button onClick={onSave} disabled={busy || !dirty}>
          {t("governance.policy.saveDraft")}
        </Button>
      )}
      {revision.state === "DRAFT" && (
        <Button onClick={onValidate} disabled={busy || dirty}>
          {t("governance.policy.validate")}
        </Button>
      )}
      {revision.state === "VALIDATED" && (
        <Button appearance="primary" onClick={onReview} disabled={busy || dirty}>
          {t("governance.policy.reviewChangesEllipsis")}
        </Button>
      )}
      <Button appearance="subtle" onClick={() => setConfirmDiscard(true)} disabled={busy}>
        {t("governance.policy.discard")}
      </Button>
      {dirty && (
        <Text size={200} className={s.muted}>
          {t("governance.policy.dirtyHint")}
        </Text>
      )}
      <Dialog open={confirmDiscard} onOpenChange={(_, d) => !busy && setConfirmDiscard(d.open)}>
        <DialogSurface className="orbit-touch">
          <DialogBody>
            <DialogTitle>{t("governance.policy.confirmDiscardTitle")}</DialogTitle>
            <DialogContent>
              <Text>{t("governance.policy.confirmDiscardBody")}</Text>
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={() => setConfirmDiscard(false)}>
                {t("governance.approval.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={busy}
                style={{ backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundOnBrand }}
                onClick={() => {
                  setConfirmDiscard(false);
                  onDiscard();
                }}
              >
                {t("governance.policy.discard")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

export function HistoryList({ history }: { history: readonly RevisionStep[] }) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  if (history.length === 0) return null;
  return (
    <div className={s.inset}>
      <Text weight="semibold" size={300}>
        {t("governance.policy.historyTitle")}
      </Text>
      <ul className={styles.historyList} aria-label={t("governance.policy.historyAria")}>
        {history.map((h) => (
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
  );
}

// ---- the revisions --------------------------------------------------------------------------------------------------------

// A revision that is no longer in effect, or was discarded, is where a new draft may start: a rollback is a copy of it,
// taken through the whole lifecycle again.
function RevisionAction({ r, onDraft }: { r: RevisionSummary; onDraft: (body: { from: string }) => void }) {
  const { t } = useI18n();
  if (r.state === "SUPERSEDED")
    return (
      <Button size="small" shape="circular" onClick={() => onDraft({ from: r.id })}>
        {t("governance.policy.rollback")}
      </Button>
    );
  if (r.state === "DISCARDED")
    return (
      <Button size="small" shape="circular" onClick={() => onDraft({ from: r.id })}>
        {t("governance.policy.startAgain")}
      </Button>
    );
  return null;
}

// Every revision, newest first as the API lists them: a table, or on a phone one card each.
export function RevisionList({ revisions, activeId, label, onOpen, onDraft }: { revisions: readonly RevisionSummary[]; activeId: string | null; label: string; onOpen: (id: string) => void; onDraft: (body: { from: string }) => void }) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  const { isMobile } = useViewport();
  if (isMobile)
    return (
      <div className={styles.revList} aria-label={label}>
        {revisions.map((r) => (
          <div key={r.id} className={mergeClasses(styles.revCard, r.id === activeId && styles.revCardActive)} aria-current={r.id === activeId ? "true" : undefined}>
            <div className={styles.revTop}>
              <div className={s.row}>
                <Button className={styles.nameBtn} appearance="transparent" onClick={() => onOpen(r.id)}>
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
              <RevisionAction r={r} onDraft={onDraft} />
            </div>
          </div>
        ))}
      </div>
    );
  return (
    <div className={s.tableWrap}>
      <Table size="small" aria-label={label}>
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
          {revisions.map((r) => (
            <TableRow key={r.id} className={r.id === activeId ? styles.rowSelected : undefined} aria-selected={r.id === activeId}>
              <TableCell className={styles.colRev}>{r.revision ?? "—"}</TableCell>
              <TableCell>
                <Button className={styles.nameBtn} appearance="transparent" onClick={() => onOpen(r.id)}>
                  {r.name}
                </Button>
              </TableCell>
              <TableCell className={styles.colNowrap}>
                <Word value={r.state} />
              </TableCell>
              <TableCell className={styles.colNowrap}>{r.risk ? <Word value={r.risk} /> : "—"}</TableCell>
              <TableCell className={styles.colUpdated}>{when(r.updatedAt)}</TableCell>
              <TableCell className={styles.colActions}>
                <RevisionAction r={r} onDraft={onDraft} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
