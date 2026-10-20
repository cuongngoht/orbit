import { Badge, Button, Caption1, Link, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatInstant } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { useTurns } from "./trace.api";
import type { PathStep, TurnRow } from "./trace.types";
import { DAYS, FOLLOWED, OUTCOME, formatSpent, isDays, turnPath, type Days } from "./traceWords";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  path: { display: "flex", flexWrap: "wrap", columnGap: tokens.spacingHorizontalXS, rowGap: tokens.spacingVerticalXXS, alignItems: "baseline", paddingBlock: tokens.spacingVerticalXS },
  // A tool name can be one 60-character word: it wraps inside its own cell.
  step: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflowWrap: "anywhere" },
  failed: { color: tokens.colorPaletteRedForeground1 },
  scroll: { overflowX: "auto" },
  // The table never narrows below what its columns need: the five fixed ones
  // add up to 43rem (48rem with their padding), and "Suggested" keeps at least 7rem
  // of its own (its text wraps anywhere). 55rem still fits the card beside the open sidebar at 1280px;
  // under it the container scrolls sideways instead of crushing a column to
  // nothing and printing its text over the next one.
  table: { minWidth: "55rem" },
  // Fixed layout: each column as wide as its content needs; "Suggested" takes
  // what is left.
  suggested: { overflowWrap: "anywhere" },
  when: { width: "12.5rem" },
  intent: { width: "9rem" },
  followed: { width: "9rem" },
  outcome: { width: "8rem" },
  took: { width: "4.5rem" },
  // A turn's path sits on its own line under its row, across the whole table:
  // it is the point of the page, and a column would squeeze it to a word.
  head: { borderBottomStyle: "none", "& > td": { paddingBottom: 0 } },
  pathRow: { "& > td": { paddingTop: 0, paddingBottom: tokens.spacingVerticalS } },
});

const COLUMNS = [
  { label: "When", width: "when" },
  { label: "Intent", width: "intent" },
  { label: "Suggested", width: "suggested" },
  { label: "Followed?", width: "followed" },
  { label: "Outcome", width: "outcome" },
  { label: "Took", width: "took" },
] as const;

// One row per prompt: what the prompt router decided, and the path the session
// then took. It shows what HAPPENED -- a hook is shown the tools a session used,
// never why a model chose them -- and it never shows a prompt's text: the trail
// keeps a salted fingerprint and a length, nothing more.
export function TracePage() {
  const [days, setDays] = useState<Days>(1);
  const turns = useTurns(days);
  return (
    <>
      <PageHeader
        title="Trace"
        description="Each prompt as Orbit saw it: what the router decided, which skills and agents started, which commands ran, and whether the session followed the suggestion. Recorded on this machine only — never a prompt's text, an argument or an output."
        actions={
          <Button icon={<ArrowClockwise20Regular />} onClick={() => turns.refetch()} disabled={turns.isFetching}>
            Refresh
          </Button>
        }
      />
      <TabList
        selectedValue={days}
        onTabSelect={(_, data) => {
          if (isDays(data.value)) setDays(data.value);
        }}
        aria-label="How far back"
      >
        {DAYS.map((d) => (
          <Tab key={d} value={d}>
            {d === 1 ? "Last 24 hours" : `Last ${d} days`}
          </Tab>
        ))}
      </TabList>
      {turns.isPending && <LoadingState label="Reading the session trail…" />}
      {turns.isError && <ErrorState error={turns.error} title="Could not read the session trail" onRetry={() => turns.refetch()} />}
      {turns.data && <Turns rows={turns.data.turns} />}
    </>
  );
}

function Turns({ rows }: { rows: TurnRow[] }) {
  const styles = useStyles();
  if (rows.length === 0) {
    return (
      <Card title="No prompts in this window">
        <Text className={styles.muted}>The trail fills from the next prompt of a session with the plugin enabled, unless its Trace option is switched off.</Text>
      </Card>
    );
  }
  return (
    <Card title={`${rows.length} prompt${rows.length === 1 ? "" : "s"}`} subtitle="Newest first. Open one to see the router's whole decision and every step.">
      <div className={styles.scroll} role="region" aria-label="Prompts, scrolls sideways when narrow" tabIndex={0}>
        <Table aria-label="Prompts and the path each took" size="small" className={styles.table}>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableHeaderCell key={c.label} className={styles[c.width]}>
                  {c.label}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TurnLine key={t.id} turn={t} />
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function TurnLine({ turn: t }: { turn: TurnRow }) {
  const styles = useStyles();
  const follow = useFollow();
  return (
    <>
      <TableRow className={styles.head}>
        <TableCell>
        <Link href={turnPath(t.id)} onClick={follow(turnPath(t.id))}>
          {formatInstant(t.at)}
        </Link>
      </TableCell>
        <TableCell>{t.intent ? `${t.intent}${t.confidence ? ` (${t.confidence})` : ""}` : <Caption1 className={styles.muted}>{t.routing === "off" ? "router off" : "no prompt seen"}</Caption1>}</TableCell>
        <TableCell className={styles.suggested}>{t.suggested.map((s) => s.id).join(", ") || "—"}</TableCell>
        <TableCell>
          <Badge appearance="tint" color={FOLLOWED[t.followed.verdict].color}>
            {FOLLOWED[t.followed.verdict].label}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge appearance="outline" color={OUTCOME[t.outcome].color}>
            {OUTCOME[t.outcome].label}
          </Badge>
        </TableCell>
        <TableCell>{formatSpent(t.ms)}</TableCell>
      </TableRow>
      <TableRow className={styles.pathRow}>
        <TableCell colSpan={COLUMNS.length}>
          <span className="visually-hidden">Path: </span>
          <Path steps={t.path} />
        </TableCell>
      </TableRow>
    </>
  );
}

export function Path({ steps }: { steps: PathStep[] }) {
  const styles = useStyles();
  if (steps.length === 0) return <Caption1 className={styles.muted}>no steps</Caption1>;
  return (
    <span className={styles.path}>
      {steps.map((s, at) => (
        <span key={`${s.label}-${at}`} className={s.ok === false ? `${styles.step} ${styles.failed}` : styles.step}>
          {at > 0 ? "→ " : ""}
          {s.label}
          {s.times > 1 ? ` ×${s.times}` : ""}
          {s.ok === null ? " (unknown)" : s.ok ? "" : " (failed)"}
        </span>
      ))}
    </span>
  );
}
