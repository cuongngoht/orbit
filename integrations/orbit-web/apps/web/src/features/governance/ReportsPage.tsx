// DAILY REPORTS: one UTC day of the account's audit record, counted and cited, frozen when generated -- by you here, or
// by Orbit Web shortly after a day ends when your policy asks for it. No model writes a word of it, and it holds the
// account's own records alone.
import { Button, Field, Input, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@fluentui/react-components";
import { ReportsIcon } from "../../components/SectionIcons";
import type { ReportList, ReportView } from "@orbit-web/contracts";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, EmptyState, ErrorBar, Word, byWhom, useParts, when } from "./parts";

export function ReportsPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
  const s = useParts();
  const list = useResource<ReportList>(() => get("/api/governance/reports"), []);
  const report = useResource<ReportView>(item ? () => get(`/api/governance/reports/${encodeURIComponent(item)}`) : null, [item]);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  useAppEvent("governance.changed", (e) => e.data.area === "reports" && void list.reload());
  const generate = () => {
    setError(null);
    void send<ReportView>("POST", "/api/governance/reports", { day })
      .then((r) => go("reports", r.id))
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <div className={s.page}>
      <Card title={t("governance.reports.generateTitle")} icon={<ReportsIcon size={18} />} tone="teal" description={t("governance.reports.generateDesc")}>
        <div className={s.row} style={{ alignItems: "flex-end" }}>
          <Field label={t("governance.reports.utcDay")}>
            <Input type="date" value={day} onChange={(_, d) => setDay(d.value)} />
          </Field>
          <Button appearance="primary" onClick={generate}>
            {t("governance.reports.generate")}
          </Button>
        </div>
        <ErrorBar text={error} />
      </Card>
      {item && report.data && (
        <Card title={t("governance.reports.reportOf", { day: report.data.day })} icon={<ReportsIcon size={18} />} tone="teal" actions={<Button as="a" href={`/api/governance/reports/${report.data.id}/markdown`}>{t("governance.reports.download")}</Button>}>
          <Markdown text={report.data.markdown} />
        </Card>
      )}
      {item && <ErrorBar text={report.error} />}
      <Card title={t("governance.reports.title")} icon={<ReportsIcon size={18} />} tone="teal">
        {list.data === null ? (
          list.error ? (
            <ErrorBar text={list.error} />
          ) : (
            <Spinner />
          )
        ) : list.data.reports.length === 0 ? (
          <EmptyState
            icon={<ReportsIcon size={22} />}
            tone="teal"
            title={t("governance.reports.emptyTitle")}
            body={t("governance.reports.emptyBody")}
          />
        ) : (
          <div className={s.tableWrap}>
            <Table size="small" aria-label={t("governance.reports.title")}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t("governance.reports.colDay")}</TableHeaderCell>
                  <TableHeaderCell>{t("governance.reports.colGenerated")}</TableHeaderCell>
                  <TableHeaderCell>{t("governance.reports.colFindings")}</TableHeaderCell>
                  <TableHeaderCell>{t("governance.reports.colDenied")}</TableHeaderCell>
                  <TableHeaderCell>{t("governance.reports.colChain")}</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Button appearance="transparent" onClick={() => go("reports", r.id)}>
                        {r.day}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {t("governance.reports.generatedMeta", { at: when(r.generatedAt), by: byWhom(r.generatedBy) })}
                    </TableCell>
                    <TableCell>{r.findings}</TableCell>
                    <TableCell>{r.denied}</TableCell>
                    <TableCell>
                      <Word value={r.integrityOk ? "allow" : "deny"} label={t(r.integrityOk ? "governance.reports.holds" : "governance.reports.broken")} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
