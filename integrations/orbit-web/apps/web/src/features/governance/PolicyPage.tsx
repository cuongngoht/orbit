// THE ACCOUNT'S POLICY: its revisions and their lifecycle -- draft, validated, published, superseded, discarded. The owner
// edits a draft in the table, validates it, reviews what publishing it would change against the revision in effect
// (worked out by the API from the two policies: what it loosens and what it narrows, its risk and why), and confirms the
// publication of exactly that content (its digest) against exactly that base, at the risk read. One person confirms;
// nobody else is asked, and an agent never confirms anything -- it may hand in a draft, which waits here like any other.
// A rollback is a copy of an earlier revision, taken through the whole lifecycle again. What the policy delegates to the
// company's departments is part of it (DelegationEditor); each department's own policy is on the Departments page.
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { PolicyIcon } from "../../components/SectionIcons";
import { checkConstitution, type AccountPolicy } from "@orbit-web/governance-core";
import type { PolicyOverview, RevisionSummary, RevisionView, Roster, SimulateResult } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { wholeRoster } from "../office/api";
import { DelegationEditor, delegationOf, withDelegation } from "./DelegationEditor";
import { EmployeeNetworkSection, splitNetwork, type EmployeeNetwork } from "./EmployeeNetwork";
import { PolicyTable } from "./PolicyTable";
import { Card, ErrorBar, useParts } from "./parts";
import { HistoryList, ImpactView, LifecycleBar, OPEN, RevisionDescription, RevisionList, RevisionNotices, RevisionTitle, ReviewDialog, revisionName } from "./revisionParts";
import { Simulation, peopleOf } from "./Simulation";

// The document as the table can show it: a policy the shared rules accept, or why it is not one.
function tableable(value: unknown): { document: AccountPolicy | null; problem: string | null } {
  const checked = checkConstitution(value);
  return checked.ok ? { document: checked.value, problem: null } : { document: null, problem: checked.errors.join("; ") };
}

// Asked of a revision of the account (a draft, an earlier one; the one in effect when none is open), as anybody -- or as
// one of the office's employees, chosen from its roster when there is one.
function CompanySimulation({ revisionId }: { revisionId: string | null }) {
  const { t } = useI18n();
  const roster = useResource<Roster>(() => wholeRoster(), []);
  return (
    <Simulation
      description={t("governance.policy.simDescription")}
      people={peopleOf(roster.data)}
      ask={(request) => send<SimulateResult>("POST", "/api/governance/simulate", { request, ...(revisionId ? { revisionId } : {}) })}
    />
  );
}

function RevisionDetail({ revision, revisions, onChanged }: { revision: RevisionView; revisions: readonly RevisionSummary[]; onChanged: (r: RevisionView) => void }) {
  const { t } = useI18n();
  // The employee network section edits its own part of the document; the table and the delegation edit the rest.
  const [shown, setShown] = useState(() => tableable(splitNetwork(revision.document).rest));
  const [network, setNetwork] = useState<EmployeeNetwork | null>(() => splitNetwork(revision.document).network);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const open = OPEN.has(revision.state);
  const document = shown.document;
  const editable = open && document !== null;
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
  const edit = (next: AccountPolicy) => {
    setShown({ document: next, problem: null });
    setDirty(true);
  };
  return (
    <Card title={<RevisionTitle revision={revision} />} description={<RevisionDescription revision={revision} />}>
      <RevisionNotices revision={revision} readable={document !== null} />
      {document !== null ? (
        <PolicyTable document={document} editable={editable} onChange={edit} />
      ) : (
        <MessageBar intent="warning">
          <MessageBarBody>{t("governance.policy.cannotShow", { problem: shown.problem ?? "" })}</MessageBarBody>
        </MessageBar>
      )}
      {document !== null && (
        <EmployeeNetworkSection
          value={network}
          editable={editable}
          onChange={(next) => {
            setNetwork(next);
            setDirty(true);
          }}
        />
      )}
      {document !== null && <DelegationEditor value={delegationOf(document)} editable={editable} onChange={(next) => edit(withDelegation(document, next))} />}
      <LifecycleBar
        revision={revision}
        editable={editable}
        dirty={dirty}
        busy={busy}
        onSave={() => act("PUT", path, { document: network !== null ? { ...document, employeeNetwork: network } : document, expectedDigest: revision.digest })}
        onValidate={() => act("POST", `${path}/validate`)}
        onReview={() => setReviewing(true)}
        onDiscard={() => act("POST", `${path}/discard`, { digest: revision.digest })}
      />
      <ErrorBar text={error} />
      {open && revision.impact && <ImpactView impact={revision.impact} />}
      <HistoryList history={revision.history} />
      {reviewing && (
        <ReviewDialog
          revision={revision}
          comparedWith={revisionName(revision.base, revisions)}
          intro={t("governance.policy.reviewIntro")}
          publish={(acknowledgedRisk) => send<RevisionView>("POST", `${path}/publish`, { digest: revision.digest, base: revision.base, acknowledgedRisk })}
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

export function PolicyPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
  const s = useParts();
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
        <RevisionList revisions={o.revisions} activeId={activeId} label={t("governance.policy.revisionsTitle")} onOpen={(id) => go("policy", id)} onDraft={draft} />
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
      <CompanySimulation revisionId={item} />
    </div>
  );
}
