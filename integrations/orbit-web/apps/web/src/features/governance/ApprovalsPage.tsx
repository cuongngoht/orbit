// APPROVALS: the protected actions your account's agents (or you) asked for, waiting for you to decide them -- you
// alone, the account's owner -- and what became of the decided ones. A push is carried out by Orbit Web the moment it is
// approved.
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { ApprovalsIcon, ShieldClearIcon } from "../../components/SectionIcons";
import type { ApprovalList } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { get } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { ApprovalCard } from "./ApprovalCard";
import { Card, EmptyState, plural, useParts } from "./parts";

const FILTERS = [
  { value: "pending", label: "Waiting" },
  { value: "granted", label: "Granted" },
  { value: "consumed", label: "Carried out" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "all", label: "All" },
] as const;

export function ApprovalsPage({ item }: { item: string | null }) {
  const s = useParts();
  const [shown, setShown] = useState("pending");
  const list = useResource<ApprovalList>(() => get("/api/governance/approvals"), []);
  useAppEvent("approval.changed", () => void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label="Reading approvals…" />;
  const all = list.data.approvals;
  const approvals = all.filter((a) => (item ? a.id === item : shown === "all" || a.state === shown));
  const label = item ? "One approval" : plural(approvals.length, shown === "all" ? "approval" : `${shown} approval`);
  return (
    <div className={s.page}>
      <Card
        title="Approvals"
        icon={<ApprovalsIcon size={18} />}
        tone="warning"
        description={label}
        actions={
          !item ? (
            <div className={s.pillBar} role="group" aria-label="Show">
              {FILTERS.map((f) => {
                const count = f.value === "all" ? all.length : all.filter((a) => a.state === f.value).length;
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
                    {count > 0 ? `${f.label} (${count})` : f.label}
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
            title="Nothing here."
            body="Protected actions — pushes, deploys, or policy gates waiting for your approval — will appear here."
          />
        )}
      </Card>
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} onChanged={() => void list.reload()} />
      ))}
    </div>
  );
}
