// POLICY DECISIONS: every decision your account's policy made, newest first -- who asked (you, one of your agents,
// nobody verified), for what, under which revision and override, what it answered and why, and where it is held
// (boundary, control, runtime). Each is an audit record: its id opens it in the audit timeline.
import { Button, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DecisionsIcon } from "../../components/SectionIcons";
import type { DecisionList } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { get } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, EmptyState, Word, principalOf, short, useParts, when } from "./parts";

const VERDICTS = [
  { value: "", label: "All verdicts" },
  { value: "allow", label: "Allow" },
  { value: "require_approval", label: "Requires approval" },
  { value: "deny", label: "Deny" },
] as const;

const useStyles = makeStyles({
  table: { minWidth: "960px" },
  nowrap: { whiteSpace: "nowrap" },
  actionName: { whiteSpace: "nowrap", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  resourceText: { maxWidth: "260px", overflowWrap: "anywhere", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  whyCell: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", minWidth: "240px" },
  whyText: { whiteSpace: "normal", overflowWrap: "break-word", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  recordBtn: { minHeight: "24px", paddingTop: "1px", paddingBottom: "1px" },
});

export function DecisionsPage({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const st = useStyles();
  const [verdict, setVerdict] = useState("");
  const list = useResource<DecisionList>(() => get(`/api/governance/decisions?limit=200${verdict ? `&verdict=${verdict}` : ""}`), [verdict]);
  useAppEvent("governance.changed", (e) => e.data.area === "audit" && void list.reload());
  return (
    <div className={s.page}>
      <Card
        title="Decisions"
        icon={<DecisionsIcon size={18} />}
        tone="brand"
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
          <EmptyState icon={<DecisionsIcon size={22} />} tone="brand" title="No decision yet." body="Policy evaluations for agent and account actions will appear here." />
        ) : (
          <div className={s.tableWrap}>
            <Table size="small" aria-label="Decisions" className={st.table}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={st.nowrap}>When</TableHeaderCell>
                  <TableHeaderCell className={st.nowrap}>Who</TableHeaderCell>
                  <TableHeaderCell>Action · resource</TableHeaderCell>
                  <TableHeaderCell className={st.nowrap}>Verdict</TableHeaderCell>
                  <TableHeaderCell className={st.nowrap}>Held by</TableHeaderCell>
                  <TableHeaderCell>Why</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.decisions.map((d) => (
                  <TableRow key={d.eventId}>
                    <TableCell className={st.nowrap}>{when(d.at)}</TableCell>
                    <TableCell className={st.nowrap}>
                      <Text size={200}>{principalOf(d.principalType, d.principalId, d.agentId)}</Text>
                    </TableCell>
                    <TableCell>
                      <Text className={st.actionName} block>
                        {d.action}
                      </Text>
                      <Text size={200} className={st.resourceText} block>
                        {d.resource}
                      </Text>
                    </TableCell>
                    <TableCell className={st.nowrap}>
                      <Word value={d.verdict} />
                    </TableCell>
                    <TableCell className={st.nowrap}>
                      <Word value={d.enforcement} />
                    </TableCell>
                    <TableCell>
                      <div className={st.whyCell}>
                        <Text size={200} className={st.whyText}>
                          {d.reasonCodes.join(", ")}
                          {d.matchedRules.length > 0 ? ` · ${d.matchedRules.join(", ")}` : ""}
                        </Text>
                        <Button size="small" shape="circular" appearance="outline" className={st.recordBtn} onClick={() => go("audit", d.eventId)}>
                          Record {short(d.eventId.replace(/^evt-/, ""), 8)}
                        </Button>
                      </div>
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
