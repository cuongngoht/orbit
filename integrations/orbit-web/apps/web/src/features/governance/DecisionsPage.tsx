// POLICY DECISIONS: every decision the Constitution made, newest first -- who asked (a person, an agent, nobody
// verified), for what, under which revision, what it answered and why, and where it is held (boundary, control,
// runtime). Each is an audit record: its id opens it in the audit timeline.
import { Button, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text } from "@fluentui/react-components";
import type { DecisionList } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { get } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, Word, short, useParts, when } from "./parts";

const VERDICTS = [
  { value: "", label: "All verdicts" },
  { value: "allow", label: "Allow" },
  { value: "require_approval", label: "Requires approval" },
  { value: "deny", label: "Deny" },
] as const;

export function DecisionsPage({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const [verdict, setVerdict] = useState("");
  const list = useResource<DecisionList>(() => get(`/api/governance/decisions?limit=200${verdict ? `&verdict=${verdict}` : ""}`), [verdict]);
  useAppEvent("governance.changed", (e) => e.data.area === "audit" && void list.reload());
  return (
    <div className={s.page}>
      <Card
        title="Decisions"
        actions={
          <div className={s.pillBar} role="group" aria-label="Verdict">
            {VERDICTS.map((v) => (
              <Button
                key={v.value || "all"}
                size="small"
                shape="circular"
                appearance={verdict === v.value ? "primary" : "subtle"}
                className={s.filterPill}
                aria-pressed={verdict === v.value}
                onClick={() => setVerdict(v.value)}
              >
                {v.label}
              </Button>
            ))}
          </div>
        }
      >
        {list.data === null ? (
          list.error ? (
            <MessageBar intent="error">
              <MessageBarBody>{list.error}</MessageBarBody>
            </MessageBar>
          ) : (
            <Spinner />
          )
        ) : list.data.decisions.length === 0 ? (
          <div className={s.empty}>
            <Text>No decision yet.</Text>
          </div>
        ) : (
          <div className={s.tableWrap}>
            <Table size="small" aria-label="Decisions">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Who</TableHeaderCell>
                  <TableHeaderCell>Action · resource</TableHeaderCell>
                  <TableHeaderCell>Verdict</TableHeaderCell>
                  <TableHeaderCell>Held by</TableHeaderCell>
                  <TableHeaderCell>Why</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.decisions.map((d) => (
                  <TableRow key={d.eventId}>
                    <TableCell>{when(d.at)}</TableCell>
                    <TableCell>
                      <Text size={200}>
                        {d.principalType} {d.agentId ? short(d.agentId, 16) : short(d.principalId, 16)}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Text className={s.mono}>{d.action}</Text>
                      <Text size={200} className={s.mono} block>
                        {d.resource}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Word value={d.verdict} />
                    </TableCell>
                    <TableCell>
                      <Word value={d.enforcement} />
                    </TableCell>
                    <TableCell>
                      <Text size={200} className={s.mono}>
                        {d.reasonCodes.join(", ")}
                        {d.matchedRules.length > 0 ? ` · ${d.matchedRules.join(", ")}` : ""}
                      </Text>
                      <Button size="small" appearance="transparent" onClick={() => go("audit", d.eventId)}>
                        Record {short(d.eventId.replace(/^evt-/, ""), 8)}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Text size={200} className={s.muted}>
          “Held by” says what stands behind a decision: boundary (the container, the broker or the proxy: the agent cannot change it), control (Orbit Web's API), runtime (the agent runtime's own configuration: defence in depth, not a boundary).
        </Text>
      </Card>
    </div>
  );
}
