// DAILY REPORTS: one UTC day of the account's audit record, counted and cited, frozen when generated -- by you here, or
// by Orbit Web shortly after a day ends when your policy asks for it. No model writes a word of it, and it holds the
// account's own records alone.
import { Button, Field, Input, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text } from "@fluentui/react-components";
import type { ReportList, ReportView } from "@orbit-web/contracts";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, ErrorBar, Word, byWhom, useParts, when } from "./parts";

export function ReportsPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
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
      <Card title="Generate a report">
        <div className={s.row}>
          <Field label="UTC day">
            <Input type="date" value={day} onChange={(_, d) => setDay(d.value)} />
          </Field>
          <Button appearance="primary" style={{ alignSelf: "flex-end" }} onClick={generate}>
            Generate
          </Button>
        </div>
        <ErrorBar text={error} />
      </Card>
      {item && report.data && (
        <Card title={`Report of ${report.data.day}`} actions={<Button as="a" href={`/api/governance/reports/${report.data.id}/markdown`}>Download</Button>}>
          <Markdown text={report.data.markdown} />
        </Card>
      )}
      {item && <ErrorBar text={report.error} />}
      <Card title="Reports">
        {list.data === null ? (
          list.error ? (
            <ErrorBar text={list.error} />
          ) : (
            <Spinner />
          )
        ) : list.data.reports.length === 0 ? (
          <div className={s.empty}>
            <Text>No report yet.</Text>
          </div>
        ) : (
          <div className={s.tableWrap}>
            <Table size="small" aria-label="Reports">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Day</TableHeaderCell>
                  <TableHeaderCell>Generated</TableHeaderCell>
                  <TableHeaderCell>Findings</TableHeaderCell>
                  <TableHeaderCell>Denied</TableHeaderCell>
                  <TableHeaderCell>Chain</TableHeaderCell>
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
                      {when(r.generatedAt)} by {byWhom(r.generatedBy)}
                    </TableCell>
                    <TableCell>{r.findings}</TableCell>
                    <TableCell>{r.denied}</TableCell>
                    <TableCell>
                      <Word value={r.integrityOk ? "allow" : "deny"} label={r.integrityOk ? "holds" : "broken"} />
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
