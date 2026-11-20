// DAILY REPORTS: one UTC day of the audit record, counted and cited, frozen when generated -- by a person here, or by
// Orbit Web shortly after a day ends when the Constitution asks for it. No model writes a word of it.
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text } from "@fluentui/react-components";
import type { ReportList, ReportView } from "@orbit-web/contracts";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, Word, short, useParts, when } from "./parts";

export function ReportsPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const { can } = useOperator();
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
      {can("reports.generate") && (
        <Card title="Generate a report">
          <div className={s.row}>
            <Field label="UTC day">
              <Input type="date" value={day} onChange={(_, d) => setDay(d.value)} />
            </Field>
            <Button appearance="primary" style={{ alignSelf: "flex-end" }} onClick={generate}>
              Generate
            </Button>
          </div>
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
        </Card>
      )}
      {item && report.data && (
        <Card title={`Report of ${report.data.day}`} actions={<Button as="a" href={`/api/governance/reports/${report.data.id}/markdown`}>Download</Button>}>
          <Markdown text={report.data.markdown} />
        </Card>
      )}
      <Card title="Reports">
        {list.data === null ? (
          <Spinner />
        ) : list.data.reports.length === 0 ? (
          <Text className={s.muted}>No report yet.</Text>
        ) : (
          <div className={s.scroll}>
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
                      {when(r.generatedAt)} by {r.generatedBy.startsWith("system:") ? "Orbit Web" : short(r.generatedBy, 16)}
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
