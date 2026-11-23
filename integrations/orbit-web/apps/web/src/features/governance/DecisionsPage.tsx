// POLICY DECISIONS: every decision your account's policy made, newest first -- who asked (you, one of your agents,
// nobody verified), for what, under which revision and override, what it answered and why, and where it is held
// (boundary, control, runtime). Each is an audit record: its id opens it in the audit timeline.
import { Button, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DecisionsIcon } from "../../components/SectionIcons";
import type { DecisionList } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n, type MessageKey } from "../../i18n";
import { get } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, EmptyState, Word, principalOf, short, useParts, when } from "./parts";

const VERDICTS: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: "", labelKey: "governance.decisions.verdict.all" },
  { value: "allow", labelKey: "governance.decisions.verdict.allow" },
  { value: "require_approval", labelKey: "governance.decisions.verdict.require_approval" },
  { value: "deny", labelKey: "governance.decisions.verdict.deny" },
];

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
  const { t } = useI18n();
  const s = useParts();
  const st = useStyles();
  const [verdict, setVerdict] = useState("");
  const list = useResource<DecisionList>(() => get(`/api/governance/decisions?limit=200${verdict ? `&verdict=${verdict}` : ""}`), [verdict]);
  useAppEvent("governance.changed", (e) => e.data.area === "audit" && void list.reload());
  return (
    <div className={s.page}>
      <Card
        title={t("governance.decisions.title")}
        icon={<DecisionsIcon size={18} />}
        tone="brand"
        actions={
          <div className={s.pillBar} role="group" aria-label={t("governance.decisions.verdictAria")}>
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
                {t(v.labelKey)}
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
          <EmptyState icon={<DecisionsIcon size={22} />} tone="brand" title={t("governance.decisions.emptyTitle")} body={t("governance.decisions.emptyBody")} />
        ) : (
          <div className={s.tableWrap}>
            <Table size="small" aria-label={t("governance.decisions.title")}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={st.nowrap}>{t("governance.decisions.colWhen")}</TableHeaderCell>
                  <TableHeaderCell className={st.nowrap}>{t("governance.decisions.colWho")}</TableHeaderCell>
                  <TableHeaderCell>{t("governance.decisions.colAction")}</TableHeaderCell>
                  <TableHeaderCell className={st.nowrap}>{t("governance.decisions.colVerdict")}</TableHeaderCell>
                  <TableHeaderCell className={st.nowrap}>{t("governance.decisions.colHeldBy")}</TableHeaderCell>
                  <TableHeaderCell>{t("governance.decisions.colWhy")}</TableHeaderCell>
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
                          {t("governance.decisions.recordBtn", { id: short(d.eventId.replace(/^evt-/, ""), 8) })}
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
          {t("governance.decisions.heldByNote")}
        </Text>
      </Card>
    </div>
  );
}
