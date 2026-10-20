import { Caption1, Subtitle1, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { CheckmarkCircle24Filled, Warning24Filled } from "@fluentui/react-icons";
import { useState } from "react";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { formatCount } from "../../../shared/format";
import { useUsage } from "../../trace/trace.api";
import type { Recording, UsageResponse } from "../../trace/trace.types";
import { TRACE_PATH } from "../../trace/traceWords";
import { BarChart } from "../components/BarChart";
import { StatTile } from "../components/StatTile";

export const USAGE_DAYS = [7, 30, 90] as const;
export type UsageDays = (typeof USAGE_DAYS)[number];

const isUsageDays = (value: unknown): value is UsageDays => value === 7 || value === 30 || value === 90;

const useStyles = makeStyles({
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, marginTop: tokens.spacingVerticalXXL },
  head: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: tokens.spacingHorizontalL, flexWrap: "wrap" },
  titles: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, maxWidth: "70ch" },
  muted: { color: tokens.colorNeutralForeground3 },
  tiles: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))" },
  halves: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fill, minmax(26rem, 1fr))", alignItems: "start" },
  list: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflowWrap: "anywhere" },
  numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  good: { color: "var(--viz-good)" },
  warn: { color: "var(--viz-warning)" },
});

// USAGE: how sessions on this machine actually used Orbit -- how many commands
// ran, which ones, and how a session flowed through them -- read off the
// session trail the hooks append to (the server's usage projection). Every
// ratio carries its denominator, and what the trail does not know is said,
// never filled in.
export function UsageSection() {
  const styles = useStyles();
  const [days, setDays] = useState<UsageDays>(30);
  const usage = useUsage(days);
  return (
    <section className={styles.section} aria-labelledby="usage-heading">
      <div className={styles.head}>
        <div className={styles.titles}>
          <Subtitle1 as="h2" id="usage-heading">
            Usage
          </Subtitle1>
          <Caption1 className={styles.muted}>What sessions on this machine ran, read off the local session trail.</Caption1>
        </div>
        <TabList
          size="small"
          selectedValue={days}
          onTabSelect={(_, data) => {
            if (isUsageDays(data.value)) setDays(data.value);
          }}
          aria-label="Usage window"
        >
          {USAGE_DAYS.map((d) => (
            <Tab key={d} value={d}>{`${d} days`}</Tab>
          ))}
        </TabList>
      </div>
      {usage.isPending && <LoadingState label="Reading the session trail…" />}
      {usage.isError && <ErrorState error={usage.error} title="Could not read the session trail" onRetry={() => usage.refetch()} />}
      {usage.data && <Usage usage={usage.data} />}
    </section>
  );
}

// What the trail keeps, where, for how long, how to stop it -- and what it never keeps.
function Disclosure({ recording: r }: { recording: Recording }) {
  const styles = useStyles();
  return (
    <Caption1 className={styles.muted}>
      Recorded in {r.where}; kept {r.retentionDays} days; switched off with {r.switch}. Never kept: {r.never.join(", ")}.
    </Caption1>
  );
}

function Usage({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  if (u.window.events === 0) {
    return (
      <Card title="Nothing recorded in this window">
        <Text className={styles.muted}>The trail fills as sessions with the plugin enabled work: every prompt, skill, agent, tool and command, as metadata.</Text>
        <Disclosure recording={u.recording} />
      </Card>
    );
  }
  return (
    <>
      <Tiles usage={u} />
      <Commands usage={u} />
      <div className={styles.halves}>
        <Paths usage={u} />
        <Flows usage={u} />
        <Skills usage={u} />
        <Failures usage={u} />
        <Privilege usage={u} />
        <Shell usage={u} />
      </div>
      <Disclosure recording={u.recording} />
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

function Tiles({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  const t = u.totals;
  const failing = t.failed.failed > 0;
  return (
    <div className={styles.tiles}>
      <StatTile label="Prompts" value={formatCount(t.turns)} caption={`across ${plural(t.sessions, "session", "sessions")}`} href={TRACE_PATH} />
      <StatTile label="Orbit commands" value={formatCount(t.orbit)} caption={`${plural(t.shell, "other command", "other commands")} beside them`} />
      <StatTile
        label="Failed commands"
        value={formatCount(t.failed.failed)}
        status={failing ? { icon: <Warning24Filled className={styles.warn} aria-hidden />, label: "Warning" } : { icon: <CheckmarkCircle24Filled className={styles.good} aria-hidden />, label: "All good" }}
        caption={`of ${plural(t.failed.of, "command", "commands")} run`}
      />
      <StatTile label="Skills started" value={formatCount(t.skills)} caption={`${plural(t.agents, "subagent", "subagents")} · ${plural(t.tools, "tool use", "tool uses")}`} />
    </div>
  );
}

function Commands({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  if (u.commands.length === 0) {
    return (
      <Card title="Orbit commands">
        <Text className={styles.muted}>No Orbit command ran in this window.</Text>
      </Card>
    );
  }
  return (
    <BarChart
      title="Orbit commands"
      subtitle="Runs per command in this window, most first. A subcommand is named only when that command's own usage documents it."
      bars={u.commands.map((c) => ({ id: c.sub ? `${c.id} ${c.sub}` : c.id, value: c.runs }))}
      format={(v) => plural(v, "run", "runs")}
      label={formatCount}
      // A run is counted in whole numbers: a tick between two of them says nothing.
      tick={(v) => (Number.isInteger(v) ? formatCount(v) : "")}
      unit="Runs"
      category="Command"
      hrefOf={() => TRACE_PATH}
    />
  );
}

function Paths({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  return (
    <Card title="Common paths" subtitle="The route a prompt took through skills and commands, the most repeated first.">
      {u.paths.length === 0 && <Text className={styles.muted}>No prompt went through a skill or a command yet.</Text>}
      <ol className={styles.list} aria-label="Common paths">
        {u.paths.map((p) => (
          <li key={p.path}>
            <span className={styles.mono}>{p.path}</span> <Caption1 className={styles.muted}>· {plural(p.turns, "prompt", "prompts")}</Caption1>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Flows({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  return (
    <Card title="What follows what" subtitle="One step, then the next, inside the same prompt.">
      {u.transitions.length === 0 ? (
        <Text className={styles.muted}>No prompt took two steps yet.</Text>
      ) : (
        <Table size="small" aria-label="What follows what">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>From</TableHeaderCell>
              <TableHeaderCell>Then</TableHeaderCell>
              <TableHeaderCell className={styles.numeric}>Times</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {u.transitions.map((t) => (
              <TableRow key={`${t.from}→${t.to}`}>
                <TableCell className={styles.mono}>{t.from}</TableCell>
                <TableCell className={styles.mono}>{t.to}</TableCell>
                <TableCell className={styles.numeric}>{formatCount(t.count)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function Skills({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  return (
    <Card title="Skills in use" subtitle="Commands are counted for the skill a session started most recently — a heuristic, and a subagent's work counts for its parent's skill.">
      {u.skills.length === 0 ? (
        <Text className={styles.muted}>No skill was started in this window.</Text>
      ) : (
        <Table size="small" aria-label="Skills in use">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Skill</TableHeaderCell>
              <TableHeaderCell className={styles.numeric}>Started</TableHeaderCell>
              <TableHeaderCell className={styles.numeric}>Refused</TableHeaderCell>
              <TableHeaderCell className={styles.numeric}>Commands (failed)</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {u.skills.map((s) => (
              <TableRow key={s.id}>
                <TableCell className={styles.mono}>{s.id}</TableCell>
                <TableCell className={styles.numeric}>{formatCount(s.invoked)}</TableCell>
                <TableCell className={styles.numeric}>{formatCount(s.refused)}</TableCell>
                <TableCell className={styles.numeric}>{`${formatCount(s.commands)} (${formatCount(s.failed)})`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function Failures({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  return (
    <Card title="What fails, and what came next" subtitle="Each failing step with its denominator, and the step the session took after it.">
      {u.failures.length === 0 && <Text className={styles.muted}>Nothing failed in this window.</Text>}
      <ul className={styles.list} aria-label="Failing steps">
        {u.failures.map((f) => (
          <li key={f.label}>
            <span className={styles.mono}>{f.label}</span> — failed {formatCount(f.failed)} of {plural(f.of, "run", "runs")}
            {f.followedBy.length > 0 && <Caption1 className={styles.muted}> · then {f.followedBy.map((n) => `${n.label} (${formatCount(n.count)})`).join(", ")}</Caption1>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// allowed-tools held against what the trail saw each skill run.
function Privilege({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  const { unused, unapproved, note } = u.privilege;
  return (
    <Card title="Least privilege" subtitle={`A skill's pre-approved commands against what it ran — ${note}.`}>
      {unused.length === 0 && unapproved.length === 0 && <Text className={styles.muted}>Every started skill ran within what it pre-approves, and used what it pre-approves.</Text>}
      {unapproved.length > 0 && (
        <>
          <Text weight="semibold">Ran without pre-approval — asked for permission every time</Text>
          <ul className={styles.list} aria-label="Ran without pre-approval">
            {unapproved.map((x) => (
              <li key={`${x.skill}|${x.command}`}>
                <span className={styles.mono}>{x.skill}</span> ran <span className={styles.mono}>{x.command}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {unused.length > 0 && (
        <>
          <Text weight="semibold">Pre-approved but never run in this window — candidates to remove</Text>
          <ul className={styles.list} aria-label="Pre-approved but never run">
            {unused.map((x) => (
              <li key={`${x.skill}|${x.rule}`}>
                <span className={styles.mono}>{x.skill}</span>: <span className={styles.mono}>{x.rule}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Shell({ usage: u }: { usage: UsageResponse }) {
  const styles = useStyles();
  return (
    <Card title="Other commands" subtitle="Commands that are not Orbit's, by class and the executable's bare name — never an argument.">
      {u.shell.length === 0 ? (
        <Text className={styles.muted}>No other command ran in this window.</Text>
      ) : (
        <Table size="small" aria-label="Other commands">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Class</TableHeaderCell>
              <TableHeaderCell>Executable</TableHeaderCell>
              <TableHeaderCell className={styles.numeric}>Runs (failed)</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {u.shell.map((c) => (
              <TableRow key={c.key}>
                <TableCell>{c.class}</TableCell>
                <TableCell className={styles.mono}>{c.exe ?? "—"}</TableCell>
                <TableCell className={styles.numeric}>{`${formatCount(c.runs)} (${formatCount(c.failed)})`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
