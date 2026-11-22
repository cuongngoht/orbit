// SECURITY FINDINGS: worked out from the audit record by rules, every time -- no model reads anything -- each naming the
// records it stands on (open them in the timeline) and saying how much they show: CONFIRMED (the records are the
// event), SUSPECTED (they fit it and something else), INCONCLUSIVE (a record that would settle it is missing). A
// finding says what was attempted; whether it was prevented is the decision's "held by".
import { Button, MessageBar, MessageBarBody, Spinner, Text } from "@fluentui/react-components";
import { FindingsIcon, ShieldClearIcon } from "../../components/SectionIcons";
import type { FindingList, FindingView } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, EmptyState, ErrorBar, Word, plural, short, useParts, when } from "./parts";

function Finding({ f, go, onChanged }: { f: FindingView; go: (page: GovernancePage, item?: string | null) => void; onChanged: () => void }) {
  const s = useParts();
  const [error, setError] = useState<string | null>(null);
  const resolve = (resolution: string) => {
    setError(null);
    void send("POST", `/api/governance/findings/${encodeURIComponent(f.id)}/resolve`, { resolution })
      .then(onChanged)
      .catch((err: unknown) => setError(errorText(err)));
  };
  return (
    <Card icon={<FindingsIcon size={18} />} tone={f.status === "CONFIRMED" ? "danger" : "warning"} title={<>{f.title} <Word value={f.status} /> <Word value={f.severity} /> {f.resolution !== "open" && <Word value={f.resolution} />}</>}>
      <Text>{f.summary}</Text>
      <Text size={200} className={s.muted}>
        {f.kind} · {plural(f.count, "record")} · {when(f.firstSeen)} – {when(f.lastSeen)}
      </Text>
      <div className={s.row}>
        {f.evidenceIds.slice(0, 12).map((id) => (
          <Button key={id} size="small" shape="circular" appearance="outline" onClick={() => go("audit", id)}>
            {short(id.replace(/^evt-/, ""), 8)}
          </Button>
        ))}
        {f.evidenceIds.length > 12 && <Text size={200}>+{f.evidenceIds.length - 12} more</Text>}
      </div>
      <div className={s.row}>
        {f.resolution !== "resolved" && (
          <Button size="small" onClick={() => resolve("resolved")}>
            Resolved
          </Button>
        )}
        {f.resolution !== "accepted" && (
          <Button size="small" onClick={() => resolve("accepted")}>
            Accept the risk
          </Button>
        )}
        {f.resolution !== "open" && (
          <Button size="small" onClick={() => resolve("open")}>
            Open again
          </Button>
        )}
      </div>
      <ErrorBar text={error} />
    </Card>
  );
}

export function FindingsPage({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const list = useResource<FindingList>(() => get("/api/governance/findings"), []);
  useAppEvent("governance.changed", (e) => (e.data.area === "audit" || e.data.area === "findings") && void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label="Reading the record…" />;
  return (
    <div className={s.page}>
      {!list.data.chain.ok && (
        <MessageBar intent="error">
          <MessageBarBody>The audit chain does not hold at record {list.data.chain.brokenAt}: findings after it stand on records that may have been changed.</MessageBarBody>
        </MessageBar>
      )}
      {list.data.findings.length === 0 && (
        <Card
          title="Security findings"
          icon={<FindingsIcon size={18} />}
          tone="danger"
          description="Deterministic checks run directly over your account's audit record, without any model reading your records."
        >
          <EmptyState
            icon={<ShieldClearIcon size={22} />}
            tone="success"
            title="No finding: nothing in the record fits a rule."
            body="If an unusual pattern or denied action appears in the audit record, it will surface here with links to the underlying events."
          />
        </Card>
      )}
      {list.data.findings.map((f) => (
        <Finding key={f.id} f={f} go={go} onChanged={() => void list.reload()} />
      ))}
    </div>
  );
}
