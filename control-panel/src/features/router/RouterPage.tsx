import { useState, type FormEvent } from "react";
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, Badge, Button, Caption1, Field, MessageBar, MessageBarBody, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular, CheckmarkCircle20Filled, Circle20Regular } from "@fluentui/react-icons";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { useResolve, useRouterResources } from "./router.api";
import type { FamilySummary, GraphNode, NodeStatus, PlanStep, Resolved, RouteEntry } from "./router.types";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(22rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  counts: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: tokens.spacingHorizontalXL, rowGap: tokens.spacingVerticalS, margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  result: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, marginTop: tokens.spacingVerticalL },
  entries: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  entry: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: tokens.spacingHorizontalS, alignItems: "start" },
  chips: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap" },
  node: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  good: { color: "var(--viz-good)" },
  muted: { color: tokens.colorNeutralForeground3 },
  pre: { whiteSpace: "pre-wrap", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, margin: 0 },
});

// What each family's line says: families where "enabled" is a person's switch
// count that; the rest count what is usable, and MCP also what may be chosen.
const FAMILY_LABEL: Record<FamilySummary["family"], string> = { skills: "Skills", agents: "Agents", mcp: "MCP", tools: "Tools", capabilities: "Capabilities" };
const KIND_LABEL: Record<RouteEntry["kind"], string> = { skill: "Skills", agent: "Agents", mcp: "MCP", tool: "Tools", capability: "Capabilities", requirement: "Requirements" };
const STATUS: Record<NodeStatus, { label: string; color: "success" | "warning" | "danger" | "subtle" | "informative" }> = {
  selected: { label: "Selected", color: "success" },
  approval: { label: "Approval required", color: "warning" },
  blocked: { label: "Blocked by policy", color: "danger" },
  missing: { label: "Missing", color: "danger" },
  unprovided: { label: "No provider", color: "subtle" },
  unknown: { label: "Not looked at yet", color: "subtle" },
  skipped: { label: "Not asked for", color: "subtle" },
};

export function RouterPage() {
  const styles = useStyles();
  const resources = useRouterResources();
  return (
    <>
      <PageHeader
        title="Router"
        description="What the prompt router sees before every prompt, and what it would decide for one. It plans and stops: nothing is started, called or installed from here."
        actions={
          <Button icon={<ArrowClockwise20Regular />} onClick={() => resources.refetch()} disabled={resources.isFetching}>
            {resources.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      <div className={styles.grid}>
        <Card title="Router Inspector" subtitle="Type a prompt to see the whole decision. The prompt is not stored.">
          <Inspector />
        </Card>
        <Card title="Effective resources" subtitle="From the same records and snapshots the router reads.">
          {resources.isPending && <LoadingState label="Loading resources…" />}
          {resources.isError && <ErrorState error={resources.error} title="Could not read the resources" onRetry={() => resources.refetch()} />}
          {resources.data && <Counts summary={resources.data.summary} />}
          {resources.data?.problems.map((p) => (
            <MessageBar key={p.family} intent="warning">
              <MessageBarBody>
                {FAMILY_LABEL[p.family] ?? p.family}: {p.why}
              </MessageBarBody>
            </MessageBar>
          ))}
        </Card>
      </div>
    </>
  );
}

function Counts({ summary }: { summary: FamilySummary[] }) {
  const styles = useStyles();
  return (
    <dl className={styles.counts} aria-label="Effective resources">
      {summary.map((f) => (
        <div key={f.family} style={{ display: "contents" }}>
          <dt>
            <Text weight="semibold">{FAMILY_LABEL[f.family] ?? f.family}</Text>
          </dt>
          <dd style={{ margin: 0 }}>{countLine(f)}</dd>
        </div>
      ))}
    </dl>
  );
}

const countLine = (f: FamilySummary) => (f.family === "skills" || f.family === "agents" ? `${f.enabled} / ${f.total} enabled` : f.family === "mcp" ? `${f.available} usable of ${f.total} · ${f.eligible} eligible` : `${f.available} usable of ${f.total}`);

function Inspector() {
  const styles = useStyles();
  const [prompt, setPrompt] = useState("");
  const resolve = useResolve();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) resolve.mutate(prompt);
  };
  return (
    <>
      <form className={styles.form} onSubmit={submit}>
        <Field label="Prompt">
          <Textarea value={prompt} onChange={(_, d) => setPrompt(d.value)} resize="vertical" rows={4} placeholder="Implement the Microsoft Graph subscription renewal handler" />
        </Field>
        <div>
          <Button appearance="primary" type="submit" disabled={!prompt.trim() || resolve.isPending}>
            {resolve.isPending ? "Resolving…" : "Resolve"}
          </Button>
        </div>
      </form>
      {resolve.isPending && <LoadingState label="Resolving…" />}
      {resolve.isError && <ErrorState error={resolve.error} title="Could not resolve the prompt" />}
      {resolve.data && <Decision resolved={resolve.data} />}
    </>
  );
}

function Decision({ resolved }: { resolved: Resolved }) {
  const styles = useStyles();
  const { decision } = resolved;
  return (
    <section className={styles.result} aria-label="Route decision">
      <div>
        <Caption1 className={styles.muted}>Intent</Caption1>
        <div>
          <Text weight="semibold" size={400}>
            {decision.intent.id}
          </Text>{" "}
          <Badge appearance="tint" color={decision.intent.confidence === "high" ? "brand" : "informative"}>
            {decision.intent.confidence} confidence
          </Badge>
        </div>
      </div>
      <div>
        <Caption1 className={styles.muted}>Requirements</Caption1>
        <div className={styles.chips}>
          {decision.requirements.length ? decision.requirements.map((r) => <Badge key={r} appearance="outline">{r}</Badge>) : <Text className={styles.muted}>none — this prompt asks nothing of any resource</Text>}
        </div>
      </div>
      <Graph nodes={decision.graph.nodes} cycles={decision.graph.cycles} />
      <Entries title="Selected resources" entries={decision.selected} usable />
      <Entries title="Approval required" entries={decision.approval} usable={false} />
      <Entries title="Blocked" entries={decision.blocked} usable={false} />
      <Entries title="Missing" entries={decision.missing} usable={false} />
      <Plan steps={decision.plan} />
      <Caption1 className={styles.muted}>No resource was executed.</Caption1>
      {resolved.context && (
        <Accordion collapsible>
          <AccordionItem value="context">
            <AccordionHeader>What the hook would add beside the prompt</AccordionHeader>
            <AccordionPanel>
              <pre className={styles.pre}>{resolved.context}</pre>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}
    </section>
  );
}

const depthOf = (node: GraphNode, nodes: GraphNode[], seen = new Set<string>()): number => (!node.from.length || seen.has(node.requirement) ? 0 : (seen.add(node.requirement), 1 + depthOf(nodes.find((n) => n.requirement === node.from[0]) ?? { ...node, from: [] }, nodes, seen)));

// Every requirement, why it is there, what became of it -- and every provider
// weighed for it: eligible or not, the policy verdict, and why not.
function Graph({ nodes, cycles }: { nodes: GraphNode[]; cycles: string[][] }) {
  const styles = useStyles();
  if (!nodes.length) return null;
  return (
    <div>
      <Text weight="semibold">Requirement graph</Text>
      <Accordion collapsible multiple aria-label="Requirement graph">
        {nodes.map((n) => (
          <AccordionItem key={n.requirement} value={n.requirement}>
            <AccordionHeader>
              <span className={styles.node} style={{ paddingLeft: `${depthOf(n, nodes) * 1.25}rem` }}>
                <Text weight="semibold">{n.requirement}</Text>
                <Badge appearance="outline" size="small">
                  {n.level}
                </Badge>
                <Badge appearance="tint" size="small" color={STATUS[n.status].color}>
                  {STATUS[n.status].label}
                </Badge>
                {n.provider && <Caption1>→ {n.provider.id}</Caption1>}
                {n.via && <Caption1 className={styles.muted}>for {n.from.join(", ")}</Caption1>}
              </span>
            </AccordionHeader>
            <AccordionPanel>
              <Candidates node={n} />
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
      {cycles.length > 0 && <Caption1 className={styles.muted}>Cycle recorded and not followed: {cycles.map((c) => c.join(" → ")).join("; ")}</Caption1>}
    </div>
  );
}

function Candidates({ node }: { node: GraphNode }) {
  const styles = useStyles();
  if (!node.candidates.length) return <Caption1 className={styles.muted}>Nothing here provides {node.requirement}{node.why ? ` — ${node.why}` : ""}.</Caption1>;
  return (
    <Table size="small" aria-label={`Candidates for ${node.requirement}`}>
      <TableHeader>
        <TableRow>
          {["Candidate", "Owner", "Eligible", "Policy", "Why not"].map((h) => (
            <TableHeaderCell key={h}>{h}</TableHeaderCell>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {node.candidates.map((c) => (
          <TableRow key={`${c.kind}:${c.key}`}>
            <TableCell>
              {c.id} <Caption1 className={styles.muted}>({c.kind})</Caption1>
              {c.signals.length > 0 && <Caption1 className={styles.muted}> · mentions {c.signals.join(", ")}</Caption1>}
            </TableCell>
            <TableCell>{c.ownership}</TableCell>
            <TableCell>{c.eligible ? "Yes" : "No"}</TableCell>
            <TableCell>{c.verdict}</TableCell>
            <TableCell>{c.selectable ? (node.provider?.key === c.key ? "chosen" : "ranked lower") : c.why ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Plan({ steps }: { steps: PlanStep[] }) {
  const styles = useStyles();
  if (!steps.length) return null;
  return (
    <div>
      <Text weight="semibold">Execution plan</Text>
      <ol aria-label="Execution plan" style={{ margin: 0 }}>
        {steps.map((s) => (
          <li key={`${s.kind}:${s.key}`}>
            <Text>{s.id}</Text> <Caption1 className={styles.muted}>({s.kind}) for {s.requirement}</Caption1>
            {s.approval && <Badge appearance="tint" color="warning" size="small">approval</Badge>}
            {s.implicit && <Caption1 className={styles.muted}> — the session already has it</Caption1>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Entries({ title, entries, usable }: { title: string; entries: RouteEntry[]; usable: boolean }) {
  const styles = useStyles();
  const kinds = [...new Set(entries.map((e) => e.kind))];
  return (
    <div>
      <Text weight="semibold">{title}</Text>
      {!entries.length && (
        <div className={styles.entry}>
          <Circle20Regular aria-hidden className={styles.muted} />
          <Text className={styles.muted}>none</Text>
        </div>
      )}
      {kinds.map((kind) => (
        <div key={kind}>
          <Caption1 className={styles.muted}>{KIND_LABEL[kind] ?? kind}</Caption1>
          <ul className={styles.entries} aria-label={`${title}: ${KIND_LABEL[kind] ?? kind}`}>
            {entries.filter((e) => e.kind === kind).map((e) => (
              <li key={`${e.kind}:${e.key}`} className={styles.entry}>
                {usable ? <CheckmarkCircle20Filled aria-label="usable" className={styles.good} /> : <Circle20Regular aria-label="not usable" className={styles.muted} />}
                <span>
                  <Text weight="semibold">{e.id}</Text>
                  {e.key.startsWith("managed:") && <Caption1 className={styles.muted}> (Orbit-managed)</Caption1>}
                  {e.summary && <Text> — {e.summary}</Text>}
                  <br />
                  <Caption1 className={styles.muted}>{e.reason}</Caption1>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
