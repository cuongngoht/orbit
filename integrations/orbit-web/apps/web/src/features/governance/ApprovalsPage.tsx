// APPROVALS: the protected actions an agent or a person asked for, waiting for an operator who may decide them -- and
// what became of the decided ones. A push is carried out by Orbit Web the moment it is approved.
import { MessageBar, MessageBarBody, Select, Spinner, Text } from "@fluentui/react-components";
import type { ApprovalList } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { get } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { ApprovalCard } from "./ApprovalCard";
import { useParts } from "./parts";

export function ApprovalsPage({ item }: { item: string | null }) {
  const s = useParts();
  const [shown, setShown] = useState("pending");
  const list = useResource<ApprovalList>(() => get("/api/governance/approvals"), []);
  useAppEvent("approval.changed", () => void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label="Reading approvals…" />;
  const approvals = list.data.approvals.filter((a) => (item ? a.id === item : shown === "all" || a.state === shown));
  return (
    <div className={s.page}>
      <div className={s.between}>
        <Text>{item ? "One approval" : `${approvals.length} ${shown === "all" ? "" : shown} approval(s)`}</Text>
        {!item && (
          <Select aria-label="Show" value={shown} onChange={(_, d) => setShown(d.value)}>
            <option value="pending">waiting</option>
            <option value="granted">granted, not carried out</option>
            <option value="consumed">carried out</option>
            <option value="rejected">rejected</option>
            <option value="expired">expired</option>
            <option value="all">all</option>
          </Select>
        )}
      </div>
      {approvals.length === 0 && <Text className={s.muted}>Nothing here.</Text>}
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} onChanged={() => void list.reload()} />
      ))}
    </div>
  );
}
