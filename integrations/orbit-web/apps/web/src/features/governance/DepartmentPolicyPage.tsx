// A DEPARTMENT'S POLICY (governance-core department.ts): what one department decides for ITS employees' assignments,
// under the company's policy and inside what the company delegated to it -- never a chat, a research question or a
// person, which the company's policy alone decides. The page says what is in effect for the department's employees, row
// by row against the company's (worked out by the API with the same evaluate() every decision uses), and their network
// access and models; and it takes the department's revisions through the same lifecycle as the company's: a draft,
// validated against the company's delegation in effect, reviewed, and confirmed by the owner against the department's
// revision in effect AND the company's -- refused, and read again, when either moved since. An agent may hand in a draft;
// only the owner publishes. A rollback is a copy of an earlier revision, taken through the whole lifecycle again.
import { Button, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowLeft16Regular } from "@fluentui/react-icons";
import { ACTIONS, checkDepartmentPolicy, type DepartmentPolicy, type DepartmentRow, type EffectiveEmployeeNetwork, type NetworkSource } from "@orbit-web/governance-core";
import type { CreateRevisionRequest, DepartmentPolicyOverview, DepartmentRevisionView } from "@orbit-web/contracts";
import { useState } from "react";
import { PolicyIcon, RosterIcon } from "../../components/SectionIcons";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type MessageKey } from "../../i18n";
import { errorText } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { departmentPolicy } from "./departmentApi";
import { DepartmentEditor, LOCK_KEYS } from "./DepartmentEditor";
import { LIMITS, inUnit } from "./EmployeeNetwork";
import { Card, ErrorBar, Word, short, useParts, when } from "./parts";
import { HistoryList, ImpactView, LifecycleBar, OPEN, RefusalBar, RevisionDescription, RevisionList, RevisionNotices, RevisionTitle, ReviewDialog, refusalOf, revisionName, type Refusal } from "./revisionParts";
import { Simulation } from "./Simulation";

const SOURCE_KEYS: Record<NetworkSource, MessageKey> = {
  company: "governance.deptPolicy.fromCompany",
  department: "governance.deptPolicy.fromDepartment",
};

const useStyles = makeStyles({
  colAction: { minWidth: "220px", width: "30%" },
  colNowrap: { whiteSpace: "nowrap" },
  colWhy: { minWidth: "200px" },
  action: { display: "flex", flexDirection: "column", gap: "2px", paddingTop: "6px", paddingBottom: "6px", minWidth: 0 },
  id: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  note: { color: tokens.colorNeutralForeground3, lineHeight: "1.45" },
  cell: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
  why: { display: "flex", flexDirection: "column", gap: "2px" },
  mobileList: { display: "flex", flexDirection: "column", gap: "8px", listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0 },
  mobileRow: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "12px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    paddingRight: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  facts: { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: "10px", rowGap: "6px", alignItems: "center" },
  chips: { display: "flex", flexWrap: "wrap", gap: "6px", listStyleType: "none", marginTop: 0, marginBottom: 0, paddingLeft: 0, minWidth: 0 },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

// The document as the rows can show it: a department's policy the shared rules accept, or why it is not one.
function readable(value: unknown): { document: DepartmentPolicy | null; problem: string | null } {
  const checked = checkDepartmentPolicy(value);
  return checked.ok ? { document: checked.value, problem: null } : { document: null, problem: checked.errors.join("; ") };
}

// ---- what is in effect for its employees -------------------------------------------------------------------------------

function CompanyCell({ row }: { row: DepartmentRow }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <div className={s.cell}>
      <Word value={row.company.effect} />
      {row.company.stated ? (
        <Word value={row.company.binding ?? "mandatory"} />
      ) : (
        <Text size={200} className={s.note}>
          {t("governance.deptPolicy.byDefault")}
        </Text>
      )}
    </div>
  );
}

function CapCell({ row }: { row: DepartmentRow }) {
  const { t } = useI18n();
  const s = useStyles();
  if (row.cap === null)
    return (
      <Text size={200} className={s.note}>
        {t("governance.deptPolicy.notDelegated")}
      </Text>
    );
  return <Word value={row.cap} />;
}

function DepartmentCell({ row }: { row: DepartmentRow }) {
  const { t } = useI18n();
  const s = useStyles();
  if (row.department === null)
    return (
      <Text size={200} className={s.note}>
        {t("governance.deptPolicy.inheritsShort")}
      </Text>
    );
  return <Word value={row.department} />;
}

// Why the department cannot loosen a row, and whether its own answer was held to the delegation.
function Why({ row }: { row: DepartmentRow }) {
  const { t } = useI18n();
  const s = useStyles();
  if (row.locked === null && !row.capped) return null;
  return (
    <div className={s.why}>
      {row.locked !== null && (
        <Text size={200} className={s.note}>
          {t(LOCK_KEYS[row.locked])}
        </Text>
      )}
      {row.capped && (
        <Text size={200} weight="semibold" className={s.warn}>
          {t("governance.deptPolicy.capped")}
        </Text>
      )}
    </div>
  );
}

function InEffect({ rows }: { rows: readonly DepartmentRow[] }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const { isMobile } = useViewport();
  const label = t("governance.deptPolicy.rowsTitle");
  if (rows.length === 0) return null;
  if (isMobile)
    return (
      <ul className={s.mobileList} aria-label={label}>
        {rows.map((row) => (
          <li key={row.action} className={s.mobileRow}>
            <div className={s.action}>
              <Text weight="semibold">{ACTIONS[row.action].summary}</Text>
              <span className={s.id}>{row.action}</span>
            </div>
            <div className={s.facts}>
              <Text size={200} className={p.muted}>
                {t("governance.deptPolicy.colCompany")}
              </Text>
              <CompanyCell row={row} />
              <Text size={200} className={p.muted}>
                {t("governance.deptPolicy.colCap")}
              </Text>
              <CapCell row={row} />
              <Text size={200} className={p.muted}>
                {t("governance.deptPolicy.colDepartment")}
              </Text>
              <DepartmentCell row={row} />
              <Text size={200} className={p.muted}>
                {t("governance.deptPolicy.colEffective")}
              </Text>
              <div className={s.cell}>
                <Word value={row.effective} />
              </div>
            </div>
            <Why row={row} />
          </li>
        ))}
      </ul>
    );
  return (
    <div className={p.tableWrap}>
      <Table size="small" aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell className={s.colAction}>{t("governance.policy.colAction")}</TableHeaderCell>
            <TableHeaderCell>{t("governance.deptPolicy.colCompany")}</TableHeaderCell>
            <TableHeaderCell className={s.colNowrap}>{t("governance.deptPolicy.colCap")}</TableHeaderCell>
            <TableHeaderCell className={s.colNowrap}>{t("governance.deptPolicy.colDepartment")}</TableHeaderCell>
            <TableHeaderCell className={s.colNowrap}>{t("governance.deptPolicy.colEffective")}</TableHeaderCell>
            <TableHeaderCell className={s.colWhy}>{t("governance.deptPolicy.colWhy")}</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.action}>
              <TableCell className={s.colAction}>
                <div className={s.action}>
                  <Text>{ACTIONS[row.action].summary}</Text>
                  <span className={s.id}>{row.action}</span>
                </div>
              </TableCell>
              <TableCell>
                <CompanyCell row={row} />
              </TableCell>
              <TableCell className={s.colNowrap}>
                <CapCell row={row} />
              </TableCell>
              <TableCell className={s.colNowrap}>
                <DepartmentCell row={row} />
              </TableCell>
              <TableCell className={s.colNowrap}>
                <Word value={row.effective} />
              </TableCell>
              <TableCell className={s.colWhy}>
                <Why row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NetworkInEffect({ network }: { network: EffectiveEmployeeNetwork | null }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const title = t("governance.deptPolicy.networkTitle");
  const limits = LIMITS.flatMap((spec) => {
    const value = network?.limits?.[spec.key];
    return value === undefined ? [] : [{ spec, value }];
  });
  return (
    <Card label={title} title={title} description={t("governance.deptPolicy.networkDesc")}>
      {network === null ? (
        <Text size={200} className={p.muted}>
          {t("governance.deptPolicy.nothingInEffect")}
        </Text>
      ) : (
        <>
          <div className={p.row}>
            <Text weight="semibold" size={300}>
              {t("governance.network.modeLabel")}
            </Text>
            <Word value={network.mode} />
            <Text size={200} className={p.muted}>
              {t(SOURCE_KEYS[network.from.mode])}
            </Text>
          </div>
          <div className={p.inset}>
            <div className={p.row}>
              <Text weight="semibold" size={300}>
                {t("governance.network.allowedHosts")}
                {network.mode === "AUTONOMOUS" ? t("governance.network.allowedHostsInactiveSuffix") : ""}
              </Text>
              <Text size={200} className={p.muted}>
                {t(SOURCE_KEYS[network.from.allow])}
              </Text>
            </div>
            {network.allow.length === 0 ? (
              <Text size={200} className={p.muted}>
                {network.mode === "RESTRICTED" ? t("governance.network.noneRestricted") : t("governance.network.noneListed")}
              </Text>
            ) : (
              <ul className={s.chips} aria-label={t("governance.network.allowedHosts")}>
                {network.allow.map((h) => (
                  <li key={h}>
                    <span className={p.codeChip}>{h}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={p.inset}>
            <Text weight="semibold" size={300}>
              {t("governance.network.limits")}
            </Text>
            {limits.length === 0 ? (
              <Text size={200} className={p.muted}>
                {t("governance.deptPolicy.noLimit")}
              </Text>
            ) : (
              <ul className={p.list} aria-label={t("governance.network.limits")}>
                {limits.map(({ spec, value }) => (
                  <li key={spec.key}>
                    <Text size={200}>{t("governance.deptPolicy.limitLine", { label: t(spec.labelKey), value: inUnit(spec, value), from: t(SOURCE_KEYS[network.from.limits[spec.key] ?? "company"]) })}</Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {network.capped.length > 0 && (
            <MessageBar intent="warning" layout="multiline">
              <MessageBarBody>{t("governance.deptPolicy.networkCapped", { fields: network.capped.join(", ") })}</MessageBarBody>
            </MessageBar>
          )}
          {network.mode === "AUTONOMOUS" && (
            <Text size={200} weight="semibold" className={s.warn}>
              {t("office.shared.networkDisclosure")}
            </Text>
          )}
        </>
      )}
    </Card>
  );
}

function ModelsInEffect({ models }: { models: DepartmentPolicyOverview["models"] }) {
  const { t } = useI18n();
  const p = useParts();
  const s = useStyles();
  const title = t("governance.deptPolicy.modelsTitle");
  return (
    <Card label={title} title={title} description={t("governance.deptPolicy.modelsDesc")}>
      {models.allow === null ? (
        <Text>{t("governance.deptPolicy.anyModel")}</Text>
      ) : models.allow.length === 0 ? (
        <Text>{t("governance.deptPolicy.noModel")}</Text>
      ) : (
        <ul className={s.chips} aria-label={title}>
          {models.allow.map((m) => (
            <li key={m}>
              <span className={p.codeChip}>{m}</span>
            </li>
          ))}
        </ul>
      )}
      {models.capped && (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>{t("governance.deptPolicy.modelsCapped")}</MessageBarBody>
        </MessageBar>
      )}
    </Card>
  );
}

// What holds the department's employees' attempts in the kernel now, and who set it (ADR 0063).
function RuntimeInEffect({ runtime }: { runtime: DepartmentPolicyOverview["runtimeSecurity"] }) {
  const { t } = useI18n();
  if (runtime === null) return null;
  const e = runtime.effective;
  const from = e.from.mode === "deployment" ? t("governance.deptPolicy.fromDeployment") : t(SOURCE_KEYS[e.from.mode]);
  const title = t("governance.deptPolicy.runtimeTitle");
  return (
    <Card label={title} title={title} description={t("governance.deptPolicy.runtimeDesc")}>
      <Text>{t("governance.deptPolicy.runtimeMode", { mode: e.mode, from })}</Text>
      <Text size={200}>{e.controls.length === 0 ? t("governance.deptPolicy.runtimeNoControl") : t("governance.deptPolicy.runtimeControls", { controls: e.controls.join(", ") })}</Text>
    </Card>
  );
}

function Header({ o }: { o: DepartmentPolicyOverview }) {
  const { t } = useI18n();
  const p = useParts();
  return (
    <Card label={o.departmentName} title={o.departmentName} icon={<RosterIcon size={18} />} tone="teal" description={t("governance.deptPolicy.headerDesc")}>
      <div className={p.inset}>
        <Text>{o.companyRevision === null ? t("governance.deptPolicy.noCompanyRevision") : t("governance.deptPolicy.companyRevision", { revision: o.companyRevision.revision ?? short(o.companyRevision.id, 13) })}</Text>
        <Text>{o.effective === null ? t("governance.deptPolicy.inherits") : t("governance.deptPolicy.ownInEffect", { revision: o.effective.revision ?? short(o.effective.id, 13), at: when(o.effective.publishedAt) })}</Text>
      </div>
      {o.companyRevision === null && (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>{t("governance.deptPolicy.noCompanyPolicy")}</MessageBarBody>
        </MessageBar>
      )}
      <MessageBar intent="info" layout="multiline">
        <MessageBarBody>{t("governance.deptPolicy.scopeNote")}</MessageBarBody>
      </MessageBar>
    </Card>
  );
}

// ---- one revision of its policy ---------------------------------------------------------------------------------------

function RevisionDetail({ o, revision, onChanged, onReload }: { o: DepartmentPolicyOverview; revision: DepartmentRevisionView; onChanged: (r: DepartmentRevisionView) => void; onReload: () => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(() => readable(revision.document));
  const [dirty, setDirty] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const open = OPEN.has(revision.state);
  const document = shown.document;
  const editable = open && document !== null;
  const departmentId = o.departmentId;
  // What a publication is confirmed against: the department's revision in effect and the company's, as this page read them.
  const base = o.effective?.id ?? null;
  const companyBase = o.companyRevision?.id ?? null;
  const act = (work: () => Promise<DepartmentRevisionView>) => {
    setBusy(true);
    setRefusal(null);
    void work()
      .then((r) => {
        setDirty(false);
        onChanged(r);
      })
      .catch((err: unknown) => setRefusal(refusalOf(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Card title={<RevisionTitle revision={revision} />} description={<RevisionDescription revision={revision} />}>
      <RevisionNotices revision={revision} readable={document !== null} />
      {document !== null ? (
        <DepartmentEditor
          document={document}
          rows={o.rows}
          runtime={o.runtimeSecurity?.company ?? null}
          editable={editable}
          onChange={(next) => {
            setShown({ document: next, problem: null });
            setDirty(true);
          }}
        />
      ) : (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>{t("governance.deptPolicy.cannotShow", { problem: shown.problem ?? "" })}</MessageBarBody>
        </MessageBar>
      )}
      <LifecycleBar
        revision={revision}
        editable={editable}
        dirty={dirty}
        busy={busy}
        onSave={() => act(() => departmentPolicy.save(departmentId, revision, document))}
        onValidate={() => act(() => departmentPolicy.validate(departmentId, revision.id))}
        onReview={() => setReviewing(true)}
        onDiscard={() => act(() => departmentPolicy.discard(departmentId, revision))}
      />
      <RefusalBar refusal={refusal} onReload={onReload} />
      {open && revision.impact && <ImpactView impact={revision.impact} />}
      <HistoryList history={revision.history} />
      {reviewing && (
        <ReviewDialog
          revision={revision}
          comparedWith={revisionName(base, o.revisions, t("governance.deptPolicy.revName.none"))}
          intro={t("governance.deptPolicy.reviewIntro", { name: o.departmentName })}
          extra={<Text size={200}>{t("governance.deptPolicy.companyRead", { name: o.companyRevision === null ? t("governance.deptPolicy.noneInEffect") : t("governance.policy.revName.published", { revision: o.companyRevision.revision ?? short(o.companyRevision.id, 13), published: "" }) })}</Text>}
          publish={(acknowledgedRisk) => departmentPolicy.publish(departmentId, revision.id, { digest: revision.digest, base, companyBase, acknowledgedRisk })}
          onClose={() => setReviewing(false)}
          onPublished={(r) => {
            setReviewing(false);
            onChanged(r);
          }}
          onReload={() => {
            setReviewing(false);
            onReload();
          }}
        />
      )}
    </Card>
  );
}

export function DepartmentPolicyPage({ departmentId, go }: { departmentId: string; go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
  const p = useParts();
  const overview = useResource<DepartmentPolicyOverview>(() => departmentPolicy.overview(departmentId), [departmentId]);
  // The revision opened below the list (none: what is in effect is shown above it, row by row).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useResource<DepartmentRevisionView>(selectedId !== null ? () => departmentPolicy.revision(departmentId, selectedId) : null, [departmentId, selectedId]);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    void overview.reload();
    if (selectedId !== null) void selected.reload();
  };
  useAppEvent("governance.changed", (e) => e.data.area === "policy" && reload());
  // Renamed or archived in the Office: its name and what may still change here are read again.
  useAppEvent("office.changed", (e) => e.data.areas.includes("roster") && void overview.reload());
  const draft = (body: CreateRevisionRequest) => {
    setError(null);
    void departmentPolicy
      .draft(departmentId, body)
      .then((r) => {
        selected.set(r);
        setSelectedId(r.id);
        void overview.reload();
      })
      .catch((err: unknown) => setError(errorText(err)));
  };
  const back = (
    <div>
      <Button appearance="subtle" shape="circular" icon={<ArrowLeft16Regular />} onClick={() => go("departments")}>
        {t("governance.departments.all")}
      </Button>
    </div>
  );
  if (overview.data === null)
    return (
      <div className={p.page}>
        {back}
        {overview.error ? <ErrorBar text={overview.error} /> : <Spinner label={t("governance.deptPolicy.reading")} />}
      </div>
    );
  const o = overview.data;
  const shown = selectedId !== null && selected.data?.id === selectedId ? selected.data : null;
  return (
    <div className={p.page}>
      {back}
      <Header o={o} />
      {o.rows.length > 0 && (
        <Card title={t("governance.deptPolicy.rowsTitle")} icon={<PolicyIcon size={18} />} tone="brand" description={t("governance.deptPolicy.rowsDesc")}>
          <InEffect rows={o.rows} />
        </Card>
      )}
      <div className={p.bento}>
        <NetworkInEffect network={o.network} />
        <ModelsInEffect models={o.models} />
        <RuntimeInEffect runtime={o.runtimeSecurity} />
      </div>
      <Card
        title={t("governance.deptPolicy.revisionsTitle")}
        icon={<PolicyIcon size={18} />}
        tone="brand"
        description={t("governance.deptPolicy.revisionsDesc")}
        actions={
          <Button appearance="primary" shape="circular" style={{ flexShrink: 0 }} onClick={() => draft({})}>
            {o.effective ? t("governance.deptPolicy.newDraft") : t("governance.deptPolicy.startDraft")}
          </Button>
        }
      >
        <ErrorBar text={error} />
        {o.revisions.length === 0 ? (
          <Text size={200} className={p.muted}>
            {t("governance.deptPolicy.noRevision")}
          </Text>
        ) : (
          <RevisionList revisions={o.revisions} activeId={selectedId ?? o.effective?.id ?? null} label={t("governance.deptPolicy.revisionsTitle")} onOpen={setSelectedId} onDraft={draft} />
        )}
      </Card>
      {shown !== null && (
        <RevisionDetail
          key={`${shown.id}:${shown.digest}:${shown.state}`}
          o={o}
          revision={shown}
          onChanged={(r) => {
            selected.set(r);
            void overview.reload();
          }}
          onReload={reload}
        />
      )}
      {selectedId !== null && selected.error && <ErrorBar text={selected.error} />}
      <Simulation
        who={false}
        description={t("governance.deptPolicy.simDescription", { name: o.departmentName, which: shown !== null ? t("governance.deptPolicy.simOpen") : t("governance.deptPolicy.simInEffect") })}
        ask={(request) => departmentPolicy.simulate(departmentId, { request, ...(selectedId !== null ? { revisionId: selectedId } : {}) })}
      />
    </div>
  );
}
