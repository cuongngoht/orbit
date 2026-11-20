// THE AUDIT TIMELINE: every governance record, newest first, each with everything it says -- who (a person, an agent,
// nobody verified, Orbit Web itself), the workspace, the run, the revision and decision it stands on, why, and its place
// in the hash chain. Read only: no page and no route changes or removes a record.
import { Button, MessageBar, MessageBarBody, Select, Spinner, Text } from "@fluentui/react-components";
import { AUDIT_EVENTS, type AuditEvent } from "@orbit-web/governance-core";
import type { AuditPage as Page, ChainVerification } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, Word, short, useParts, when } from "./parts";

function Record({ event, open: initiallyOpen }: { event: AuditEvent; open: boolean }) {
  const s = useParts();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <li id={event.eventId} aria-label={event.eventType}>
      <Card>
        <div className={s.between}>
          <div className={s.row}>
            <Text size={200} className={s.muted}>
              #{event.seq} · {when(event.occurredAt)}
            </Text>
            <Text weight="semibold" className={s.mono}>
              {event.eventType}
            </Text>
            <Word value={event.outcome} label={event.outcome} />
          </div>
          <Button size="small" appearance="subtle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Less" : "Everything it says"}
          </Button>
        </div>
        <Text size={200}>
          {event.principalType} {short(event.agentId ?? event.principalId, 24)}
          {event.workspaceId ? ` · workspace ${short(event.workspaceId, 8)}` : ""}
          {event.reasonCodes.length > 0 ? ` · ${event.reasonCodes.join(", ")}` : ""}
        </Text>
        {open && <pre className={s.pre}>{JSON.stringify(event, null, 2)}</pre>}
      </Card>
    </li>
  );
}

export function AuditPage({ item }: { item: string | null }) {
  const s = useParts();
  const { can } = useOperator();
  const [type, setType] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const one = useResource<AuditEvent>(item ? () => get(`/api/governance/audit/${encodeURIComponent(item)}`) : null, [item]);
  const page = useResource<Page>(() => get(`/api/governance/audit?limit=50${type ? `&type=${type}` : ""}${before !== null ? `&before=${before}` : ""}`), [type, before]);
  useAppEvent("governance.changed", (e) => e.data.area === "audit" && before === null && void page.reload());
  useEffect(() => {
    if (item) document.getElementById(item)?.scrollIntoView({ block: "center" });
  }, [item, one.data]);
  const verify = () => {
    setError(null);
    void send<ChainVerification>("POST", "/api/governance/audit/verify")
      .then(setVerification)
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <div className={s.page}>
      <div className={s.between}>
        <Select
          aria-label="Record type"
          value={type}
          onChange={(_, d) => {
            setBefore(null);
            setType(d.value);
          }}
        >
          <option value="">every record</option>
          {Object.keys(AUDIT_EVENTS).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        {can("audit.verify") && <Button onClick={verify}>Verify the chain</Button>}
      </div>
      {verification && (
        <MessageBar intent={verification.ok ? "success" : "error"}>
          <MessageBarBody>{verification.ok ? `The chain holds: ${verification.count} record(s), head ${short(verification.head, 16)}.` : `The chain does NOT hold at record ${verification.brokenAt} (${verification.problem}).`}</MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {item && one.data && (
        <ul className={s.list} aria-label="The record asked for">
          <Record event={one.data} open />
        </ul>
      )}
      {page.data === null ? (
        page.error ? (
          <MessageBar intent="error">
            <MessageBarBody>{page.error}</MessageBarBody>
          </MessageBar>
        ) : (
          <Spinner />
        )
      ) : (
        <>
          <ul className={s.list} aria-label="Audit records">
            {page.data.events.map((e) => (
              <Record key={e.eventId} event={e} open={false} />
            ))}
          </ul>
          <div className={s.row}>
            {before !== null && <Button onClick={() => setBefore(null)}>Newest</Button>}
            {page.data.next !== null && <Button onClick={() => setBefore(page.data?.next ?? null)}>Older</Button>}
          </div>
        </>
      )}
    </div>
  );
}
