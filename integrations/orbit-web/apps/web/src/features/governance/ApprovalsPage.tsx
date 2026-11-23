// APPROVALS: the protected actions your account's agents (or you) asked for, waiting for you to decide them -- you
// alone, the account's owner -- and what became of the decided ones. A push is carried out by Orbit Web the moment it is
// approved.
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { ApprovalsIcon, ShieldClearIcon } from "../../components/SectionIcons";
import type { ApprovalList } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n, type MessageKey } from "../../i18n";
import { get } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { ApprovalCard } from "./ApprovalCard";
import { Card, EmptyState, plural, useParts } from "./parts";

const FILTERS: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: "pending", labelKey: "governance.approvals.filter.pending" },
  { value: "granted", labelKey: "governance.approvals.filter.granted" },
  { value: "consumed", labelKey: "governance.approvals.filter.consumed" },
  { value: "rejected", labelKey: "governance.approvals.filter.rejected" },
  { value: "expired", labelKey: "governance.approvals.filter.expired" },
  { value: "all", labelKey: "governance.approvals.filter.all" },
];

export function ApprovalsPage({ item }: { item: string | null }) {
  const { t } = useI18n();
  const s = useParts();
  const [shown, setShown] = useState("pending");
  const list = useResource<ApprovalList>(() => get("/api/governance/approvals"), []);
  useAppEvent("approval.changed", () => void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label={t("governance.approvals.reading")} />;
  const all = list.data.approvals;
  const approvals = all.filter((a) => (item ? a.id === item : shown === "all" || a.state === shown));
  const label = item
    ? t("governance.approvals.oneApproval")
    : plural(approvals.length, shown === "all" ? t("governance.approvals.countNounAll") : t("governance.approvals.countNounFiltered", { state: shown }));
  return (
    <div className={s.page}>
      <Card
        title={t("governance.approvals.title")}
        icon={<ApprovalsIcon size={18} />}
        tone="warning"
        description={label}
        actions={
          !item ? (
            <div className={s.pillBar} role="group" aria-label={t("governance.approvals.showAria")}>
              {FILTERS.map((f) => {
                const count = f.value === "all" ? all.length : all.filter((a) => a.state === f.value).length;
                const text = t(f.labelKey);
                return (
                  <Button
                    key={f.value}
                    size="small"
                    shape="circular"
                    appearance={shown === f.value ? "primary" : "subtle"}
                    className={s.filterPill}
                    aria-pressed={shown === f.value}
                    onClick={() => setShown(f.value)}
                  >
                    {count > 0 ? `${text} (${count})` : text}
                  </Button>
                );
              })}
            </div>
          ) : undefined
        }
      >
        {approvals.length === 0 && (
          <EmptyState
            icon={<ShieldClearIcon size={22} />}
            tone="success"
            title={t("governance.approvals.emptyTitle")}
            body={t("governance.approvals.emptyBody")}
          />
        )}
      </Card>
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} onChanged={() => void list.reload()} />
      ))}
    </div>
  );
}
