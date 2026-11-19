// Orbit's own account of the session's work, in Orbit's words: the task, its stage, the checks the change is held
// to, the verification rows, what still blocks completion, approvals waiting at a protected boundary, and Orbit's
// verdict -- shown as Verified only when Orbit says so, Unknown when it has not spoken.
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular } from "@fluentui/react-icons";
import type { OrbitPanel as Panel } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { errorText, get } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  grid: { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "10px", rowGap: "3px" },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflowWrap: "anywhere" },
  section: { display: "flex", flexDirection: "column", gap: "4px" },
  list: { margin: 0, paddingLeft: "18px" },
});

const VERDICT_COLOR = { verified: "success", not_verified: "danger", unknown: "subtle" } as const;

const STATE_COLOR = (state: string): "success" | "danger" | "warning" | "informative" | "subtle" =>
  ["passed", "satisfied"].includes(state) ? "success" : ["regressed", "violated", "failed"].includes(state) ? "danger" : ["failed-as-before", "blocked", "owed", "unstarted"].includes(state) ? "warning" : state === "running" ? "informative" : "subtle";

// Whichever of two readings of Orbit is the more recent.
const latest = (a: Panel | null, b: Panel | null): Panel | null => (a === null ? b : b === null ? a : b.checkedAt > a.checkedAt ? b : a);

export function OrbitPanel({ sessionId, live }: { sessionId: string; live: Panel | null }) {
  const s = useStyles();
  const [fetched, setFetched] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const panel = latest(fetched, live);

  const ask = (): Promise<void> =>
    get<Panel>(`/api/sessions/${sessionId}/verification`).then(
      (p) => {
        setFetched(p);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );

  const read = async () => {
    setLoading(true);
    await ask();
    setLoading(false);
  };

  useEffect(() => {
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per session; the stream brings later changes
  }, [sessionId]);

  if (error) return <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>;
  if (panel === null) return <Spinner size="tiny" label="Asking Orbit…" />;
  return (
    <div className={s.root}>
      <div className={s.row}>
        <Badge size="large" appearance="filled" color={VERDICT_COLOR[panel.verdict.word]} aria-label="Orbit verdict">
          {panel.verdict.label}
        </Badge>
        <Button appearance="subtle" size="small" icon={loading ? <Spinner size="extra-tiny" /> : <ArrowClockwise16Regular />} onClick={() => void read()} aria-label="Ask Orbit again" />
      </div>
      <Text size={200} className={s.muted}>
        {panel.verdict.source}
      </Text>
      {panel.state !== "available" && <Text size={200}>{panel.reason}</Text>}
      {panel.task && (
        <div className={s.grid}>
          <Text size={200}>Task</Text>
          <Text className={s.mono}>{panel.task.id}</Text>
          {panel.task.objective && (
            <>
              <Text size={200}>Objective</Text>
              <Text size={200}>{panel.task.objective}</Text>
            </>
          )}
          <Text size={200}>Lifecycle</Text>
          <Text className={s.mono}>{panel.task.lifecycle ?? "?"}</Text>
          <Text size={200}>Stage</Text>
          <Text className={s.mono}>{panel.task.stage ?? "?"}</Text>
          {panel.task.attempt !== null && (
            <>
              <Text size={200}>Attempt</Text>
              <Text className={s.mono}>
                {panel.task.attempt}
                {panel.task.attemptLimit !== null ? ` of ${panel.task.attemptLimit}` : ""}
              </Text>
            </>
          )}
          {panel.task.stopReason && (
            <>
              <Text size={200}>Stopped</Text>
              <Text className={s.mono}>{panel.task.stopReason}</Text>
            </>
          )}
        </div>
      )}
      {panel.work && (
        <Text size={200}>
          Work evidence: <strong>{panel.work.evidence ?? "none"}</strong>
          {panel.work.evidenceSays ? ` — ${panel.work.evidenceSays}` : ""}
        </Text>
      )}
      {panel.checks.length > 0 && (
        <div className={s.section}>
          <Text weight="semibold" size={300}>
            Checks this change is held to{panel.planWord ? ` (${panel.planWord})` : ""}
          </Text>
          {panel.checks.map((c) => (
            <div key={c.id} className={s.row}>
              <Badge size="small" appearance="tint" color={STATE_COLOR(c.state)}>
                {c.state}
              </Badge>
              <Text className={s.mono}>{c.declaredAs ?? c.id}</Text>
              {c.purpose && <Text size={200} className={s.muted}>{c.purpose}</Text>}
            </div>
          ))}
        </div>
      )}
      {panel.missing.length > 0 && (
        <div className={s.section}>
          <Text weight="semibold" size={300}>Missing checks</Text>
          <ul className={s.list}>
            {panel.missing.map((m) => (
              <li key={m}>
                <Text size={200}>{m}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {panel.verification.length > 0 && (
        <div className={s.section}>
          <Text weight="semibold" size={300}>Verification</Text>
          {panel.verification.map((v, i) => (
            <div key={i} className={s.row}>
              <Badge size="small" appearance="tint" color={STATE_COLOR(v.state)}>
                {v.state}
              </Badge>
              <Text size={200}>{v.obligation}</Text>
            </div>
          ))}
        </div>
      )}
      {panel.completion && panel.completion.length > 0 && (
        <div className={s.section}>
          <Text weight="semibold" size={300}>Not yet complete</Text>
          <ul className={s.list}>
            {panel.completion.map((r) => (
              <li key={r.id}>
                <Text size={200}>
                  <span className={s.mono}>{r.id}</span> — {r.says}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {panel.failure && (
        <div className={s.section}>
          <Text weight="semibold" size={300}>
            Latest failure ({panel.failure.failureClass ?? "unclassified"})
          </Text>
          <pre className={s.mono}>{panel.failure.excerpt.join("\n")}</pre>
        </div>
      )}
      {panel.approvals.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>
            Waiting for a person at a protected boundary: {panel.approvals.map((a) => `${a.title ?? a.id}${a.boundary ? ` (${a.boundary})` : ""}`).join(", ")}. Orbit grants an approval only in Orbit Control, which proves a person with its own token on this container's loopback; Orbit Web shows it and cannot grant it.
          </MessageBarBody>
        </MessageBar>
      )}
      {panel.stop && <Text size={200}>Stopped: {panel.stop.says}</Text>}
      {panel.sessionChecks.length > 0 && (
        <div className={s.section}>
          <Text weight="semibold" size={300}>Checks Orbit saw this session run</Text>
          {panel.sessionChecks.map((c, i) => (
            <div key={i} className={s.row}>
              <Badge size="small" appearance="tint" color={c.ok === true ? "success" : c.ok === false ? "danger" : "subtle"}>
                {c.ok === true ? "exit ok" : c.ok === false ? "exit error" : "unknown"}
              </Badge>
              <Text className={s.mono}>{c.program ?? "?"}</Text>
              <Text size={200} className={s.muted}>
                named like a {c.kind ?? "check"}
              </Text>
            </div>
          ))}
        </div>
      )}
      <Text size={200} className={s.muted}>
        Checked {new Date(panel.checkedAt).toLocaleTimeString()}. Claude finishing a run is not a verification; this panel repeats only what Orbit itself recorded.
      </Text>
    </div>
  );
}
