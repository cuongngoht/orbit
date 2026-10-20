import { Button, Caption1, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useParams } from "react-router";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatDateTime } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { Facts, WordBadge } from "../mission-control/components";
import { taskPath } from "../mission-control/missionWords";
import { useWork } from "./work.api";
import type { CheckSeen, FileSeen, Handoff, TaskLink, WorkRef, WorkView } from "./work.types";
import { EVIDENCE, LIVENESS_WORDS, RESULT_WORDS, TONE, WORK_PATH } from "./workWords";

const useStyles = makeStyles({
  grid: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(24rem, 1fr))" },
  wide: { gridColumn: "1 / -1" },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  list: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
});

/** The work this page is about, read off its address: both identities of its checkout, and its own. */
function useWorkRef(): WorkRef | null {
  const { key, checkout, work } = useParams();
  return key && checkout && work ? { key, checkout, work } : null;
}

// `/work/:key/checkouts/:checkout/works/:work`: one tracked work as its journal and its owners say -- what was asked, who does it,
// where it stands, what stands behind that, the files and checks the host's hooks OBSERVED, the tasks that joined it and
// what it was reported to have come to. A word that needs an owner (verified) is only ever the owner's.
export function WorkPage() {
  const ref = useWorkRef();
  if (!ref) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>This address does not name a work.</MessageBarBody>
      </MessageBar>
    );
  }
  return <Loaded key={`${ref.key}/${ref.checkout}/${ref.work}`} workRef={ref} />;
}

function Loaded({ workRef }: { workRef: WorkRef }) {
  const read = useWork(workRef);
  const view = read.data?.work ?? null;
  return (
    <>
      <PageHeader
        title={view?.title ?? "Work"}
        context={<WorkTrail current={workRef.work} />}
        badges={view && <Badges view={view} />}
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={read.isFetching} onClick={() => read.refetch()}>
            Refresh
          </Button>
        }
      />
      {read.isPending && <LoadingState label="Reading the work's journal…" />}
      {read.isError && <ErrorState error={read.error} title="Could not read this work" onRetry={() => read.refetch()} />}
      {view && <Detail view={view} workRef={workRef} />}
    </>
  );
}

function WorkTrail({ current }: { current: string }) {
  const follow = useFollow();
  return (
    <Caption1>
      <Link href={WORK_PATH} onClick={follow(WORK_PATH)}>
        Work
      </Link>{" "}
      / <span>{current}</span>
    </Caption1>
  );
}

function Badges({ view }: { view: WorkView }) {
  return (
    <>
      <WordBadge word={view.lifecycle.state} label={view.lifecycle.word} tone={TONE[view.lifecycle.tone]} />
      <WordBadge word={view.evidence.level} label={`evidence: ${EVIDENCE[view.evidence.level].word}`} tone={EVIDENCE[view.evidence.level].tone} />
    </>
  );
}

function Detail({ view, workRef }: { view: WorkView; workRef: WorkRef }) {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      <StandingCard view={view} />
      <SummaryCard view={view} />
      <FilesCard view={view} />
      <ChecksCard view={view} />
      <TasksCard view={view} workRef={workRef} />
      <HandoffsCard handoffs={view.handoffs} />
      <LimitsCard view={view} />
    </div>
  );
}

function StandingCard({ view }: { view: WorkView }) {
  const styles = useStyles();
  return (
    <Card title="Where it stands" subtitle={view.lifecycle.say}>
      <Facts
        label="Where it stands"
        rows={[
          ["Work", <span className={styles.mono}>{view.work}</span>],
          ["Mode", view.mode === "autonomous" ? "autonomous — an engineering task or workflow took it" : "developer — the host works it in the session"],
          ...(view.route?.to ? [["Routed to", `${view.route.to}${view.route.because ? ` — ${view.route.because}` : ""}`] as const] : []),
          ...(view.ref ? [["Item", <span className={styles.mono}>{view.ref}</span>] as const] : []),
          ...(view.requirement.snapshot ? [["Requirement", <span className={styles.mono}>{view.requirement.snapshot}</span>] as const] : []),
          ["Lifecycle", `${view.lifecycle.word}${view.lifecycle.wait ? ` (waiting for ${view.lifecycle.wait})` : ""}${view.lifecycle.why ? ` — ${view.lifecycle.why}` : ""}`],
          ["Evidence", `${EVIDENCE[view.evidence.level].word} — ${view.evidence.why}`],
          ["Session", LIVENESS_WORDS[view.liveness]],
          ...(view.createdAt ? [["Taken on", formatDateTime(view.createdAt)] as const] : []),
          ...(view.updatedAt ? [["Last line", formatDateTime(view.updatedAt)] as const] : []),
        ]}
      />
    </Card>
  );
}

function SummaryCard({ view }: { view: WorkView }) {
  const styles = useStyles();
  const s = view.summary;
  return (
    <Card title="What it came to" subtitle={view.report ? `Reported ${view.report.outcome} ${formatDateTime(view.report.at)} — the host's own words, not a check.` : "Nothing has been reported yet."}>
      <Facts label="Summary" rows={[["Request", s.request ?? "—"], ...(view.report?.summary ? [["Summary", view.report.summary] as const] : [])]} />
      <ItemList title="Proved (as reported)" items={s.proved} none="Nothing is reported as proved." />
      <ItemList title="Not verified" items={s.unverified} none="Nothing is reported as unverified." />
      {view.report && view.report.evidence.length > 0 && <Text className={styles.mono}>{view.report.evidence.join(", ")}</Text>}
    </Card>
  );
}

function ItemList({ title, items, none }: { title: string; items: string[]; none: string }) {
  const styles = useStyles();
  return (
    <div>
      <Text weight="semibold">{title}</Text>
      {items.length ? (
        <ul className={styles.list} aria-label={title}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <div>
          <Caption1 className={styles.muted}>{none}</Caption1>
        </div>
      )}
    </div>
  );
}

const fileWords = (f: FileSeen) => (f.attribution === "shared" ? "shared — another session was also seen writing it" : "observed");

function FilesCard({ view }: { view: WorkView }) {
  const styles = useStyles();
  const files = view.activity.files;
  return (
    <Card title="Files observed" subtitle={view.summary.changes.basis}>
      {files.length === 0 ? (
        <Text className={styles.muted}>No file was seen changing.</Text>
      ) : (
        <ul className={styles.list} aria-label="Files observed">
          {files.map((f) => (
            <li key={f.path}>
              <span className={styles.mono}>{f.path}</span> <Caption1 className={styles.muted}>{fileWords(f)}</Caption1>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const checkWords = (c: CheckSeen) => `${RESULT_WORDS[c.result]}${c.current ? "" : " · superseded by a later edit"}`;

function ChecksCard({ view }: { view: WorkView }) {
  const styles = useStyles();
  const checks = view.activity.checks;
  return (
    <Card title="Checks observed" subtitle="Commands named like a build, test or lint, and how each ended. Never what a test proved.">
      {checks.length === 0 ? (
        <Text className={styles.muted}>No such command was seen.</Text>
      ) : (
        <ul className={styles.list} aria-label="Checks observed">
          {checks.map((c) => (
            <li key={`${c.at}-${c.what}`}>
              {c.what} <Caption1 className={styles.muted}>{checkWords(c)}</Caption1>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TaskLine({ link, workRef }: { link: TaskLink; workRef: WorkRef }) {
  const styles = useStyles();
  const follow = useFollow();
  const to = taskPath({ key: workRef.key, checkout: workRef.checkout, task: link.task });
  return (
    <li>
      <span className={styles.line}>
        <Link href={to} onClick={follow(to)}>
          {link.task}
        </Link>
        <Caption1 className={styles.muted}>{link.what}</Caption1>
        {link.readable ? <WordBadge word={link.lifecycle ?? "UNKNOWN"} tone={link.terminal ? "subtle" : "brand"} /> : <Caption1 className={styles.muted}>not readable in this checkout</Caption1>}
        {link.stage && <Caption1>{link.stage}</Caption1>}
      </span>
    </li>
  );
}

function TasksCard({ view, workRef }: { view: WorkView; workRef: WorkRef }) {
  const styles = useStyles();
  return (
    <Card title="Linked tasks" subtitle="Each one's state is its own journal's, read back; its page is in Mission Control.">
      {view.tasks.length === 0 ? (
        <Text className={styles.muted}>No task or workflow joined this work.</Text>
      ) : (
        <ul className={styles.list} aria-label="Linked tasks">
          {view.tasks.map((link) => (
            <TaskLine key={link.task} link={link} workRef={workRef} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function HandoffsCard({ handoffs }: { handoffs: Handoff[] }) {
  const styles = useStyles();
  return (
    <Card title="Handoffs" subtitle="The same work, changing hands.">
      {handoffs.length === 0 ? (
        <Text className={styles.muted}>It has not changed hands.</Text>
      ) : (
        <ul className={styles.list} aria-label="Handoffs">
          {handoffs.map((h) => (
            <li key={`${h.at}-${h.to}`}>
              {h.from ?? "?"} → {h.to}
              {h.task ? ` (${h.task})` : ""} <Caption1 className={styles.muted}>{formatDateTime(h.at)}{h.because ? ` — ${h.because}` : ""}</Caption1>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LimitsCard({ view }: { view: WorkView }) {
  const styles = useStyles();
  const c = view.coverage;
  return (
    <Card title="What could be seen" subtitle={`The ${c.host ?? "unknown"} host: ${c.observation} observation. A missing line is never "nothing happened".`}>
      <Facts label="Coverage" rows={[["Edits", c.edits], ["Commands", c.commands], ["Outcome", c.outcome], ["Session end", c.sessionEnd ? "reported by the host" : "not reported"]]} />
      {view.warnings.length > 0 && (
        <ul className={styles.list} aria-label="Limits">
          {view.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
