// HOW THE MISSION'S PEOPLE TALK: a pipeline -- who holds which part, and where each stands -- and the mission's exchanges
// as one thread, oldest first, each from someone to someone: the work given (its brief as written), questions and
// answers, every hand-in with its files (opened in the browser when it can show them), every review with its note, and
// Orbit's notices. Read from GET /api/missions/:id/messages again whenever the mission changes; nothing here is written.
import { Badge, Button, Link, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowRight16Regular, Attach16Regular } from "@fluentui/react-icons";
import { ASSIGNMENT_STATE_TEXT, type AssignmentState, type AssignmentView, type MissionDetail, type MissionMessage, type MissionMessages, type MissionParty } from "@orbit-web/contracts";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import { useI18n, type MessageKey } from "../../i18n";
import { bytesText } from "../resources/format";
import { office, useOfficeRead } from "./api";
import { EmployeeAvatar, useOfficeStyles, when } from "./parts";

const useStyles = makeStyles({
  pipeline: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "10px" },
  partsGroup: { display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: "8px", flexGrow: 1, minWidth: 0 },
  stage: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: "168px",
    maxWidth: "240px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    textAlign: "left",
    cursor: "pointer",
  },
  chosen: { border: `1px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  arrow: { alignSelf: "center", color: tokens.colorNeutralForeground3, flexShrink: 0 },
  thread: { display: "flex", flexDirection: "column", gap: "10px", margin: 0, padding: 0, listStyleType: "none" },
  mail: { display: "flex", flexDirection: "column", gap: "6px", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  notice: { backgroundColor: tokens.colorNeutralBackground3 },
  head: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  files: { display: "flex", flexDirection: "column", gap: "4px", margin: 0, paddingLeft: 0, listStyleType: "none" },
});

// The stage word of a part, from its own state: where it stands in the pipeline.
const STAGE: Record<AssignmentState, MessageKey> = {
  QUEUED: "office.thread.stage.given",
  ASSIGNED: "office.thread.stage.given",
  RUNNING: "office.thread.stage.working",
  RECOVERING: "office.thread.stage.working",
  WAITING_FOR_SUBORDINATES: "office.thread.stage.waitingTeam",
  ANSWERING: "office.thread.stage.waitingTeam",
  REVIEWING: "office.thread.stage.reviewing",
  AWAITING_ACCEPTANCE: "office.thread.stage.handedIn",
  BLOCKED: "office.thread.stage.blocked",
  PAUSED: "office.thread.stage.paused",
  CANCELLING: "office.thread.stage.cancelled",
  CANCELLED: "office.thread.stage.cancelled",
  COMPLETED: "office.thread.stage.accepted",
  FAILED_FINAL: "office.thread.stage.failed",
};

const KIND: Record<MissionMessage["kind"], MessageKey> = {
  given: "office.thread.kind.given",
  asked: "office.thread.kind.asked",
  answered: "office.thread.kind.answered",
  moved: "office.thread.kind.moved",
  handed_in: "office.thread.kind.handedIn",
  accepted: "office.thread.kind.accepted",
  revision: "office.thread.kind.revision",
  notice: "office.thread.kind.notice",
};

// What a browser shows itself (the server serves these inline, sandboxed): opened, not downloaded.
const SHOWN = /^(text\/(markdown|plain|csv)|application\/(json|pdf)|image\/(png|jpeg))$/;

function partyText(p: MissionParty): string {
  return p.departmentName !== null ? `${p.name} (${p.departmentName})` : p.name;
}

// Sort parts so independent / active parts appear before parts that depend on them.
function sortPartsForPipeline(parts: readonly AssignmentView[]): AssignmentView[] {
  const rank = (a: AssignmentView): number => {
    if (a.brief.dependsOn.length === 0) return 0;
    return 1 + a.brief.dependsOn.length;
  };
  return [...parts].sort((a, b) => rank(a) - rank(b));
}

// The pipeline: the mission's holder, then each part -- its holder, department and stage; a click shows its exchanges.
export function MissionPipeline({ m, chosen, choose }: { m: MissionDetail; chosen: string | null; choose: (assignmentId: string | null) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const root = m.assignments.find((a) => a.parentId === null) ?? null;
  const parts = sortPartsForPipeline(m.assignments.filter((a) => a.parentId !== null));
  const card = (a: AssignmentView) => (
    <button key={a.id} type="button" className={mergeClasses(s.stage, chosen === a.id && s.chosen)} aria-pressed={chosen === a.id} onClick={() => choose(chosen === a.id ? null : a.id)}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", width: "100%" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <EmployeeAvatar name={a.employeeName} size="sm" />
          <Text weight="semibold">{a.employeeName}</Text>
        </span>
        {a.unitKey && (
          <Badge appearance="outline" size="small">
            {a.unitKey}
          </Badge>
        )}
      </span>
      <Text size={200}>{a.parentId === null ? t("office.thread.holder") : a.title}</Text>
      {a.pinned.departmentName !== null && (
        <Text size={100} className={o.muted}>
          {a.pinned.departmentName}
        </Text>
      )}
      <span style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
        <Badge appearance="tint" color={a.state === "BLOCKED" || a.state === "FAILED_FINAL" ? "danger" : a.state === "COMPLETED" ? "success" : "informative"} title={ASSIGNMENT_STATE_TEXT[a.state]}>
          {t(STAGE[a.state])}
        </Badge>
        {a.brief.dependsOn.length > 0 && (
          <Text size={100} className={o.muted}>
            ← {a.brief.dependsOn.join(", ")}
          </Text>
        )}
      </span>
    </button>
  );
  if (root === null) return null;
  return (
    <div className={o.stack} style={{ gap: "6px" }}>
      <div className={s.pipeline} role="group" aria-label={t("office.thread.pipelineAria")}>
        {card(root)}
        {parts.length > 0 && <ArrowRight16Regular className={s.arrow} aria-hidden />}
        {parts.length > 0 && <div className={s.partsGroup}>{parts.map(card)}</div>}
      </div>
      <Text size={100} className={o.muted}>
        {t("office.mission.pipelineHint")}
      </Text>
    </div>
  );
}

function Mail({ message }: { message: MissionMessage }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  return (
    <li className={mergeClasses(s.mail, message.kind === "notice" && s.notice)} aria-label={`${t(KIND[message.kind])}: ${message.subject}`}>
      <div className={s.head}>
        <Badge appearance="outline">{t(KIND[message.kind])}</Badge>
        <Text weight="semibold">{partyText(message.from)}</Text>
        {message.to !== null && (
          <>
            <ArrowRight16Regular aria-label={t("office.thread.to")} />
            <Text weight="semibold">{partyText(message.to)}</Text>
          </>
        )}
        <Text size={200} className={o.muted}>
          {when(message.at)}
        </Text>
      </div>
      <Text className={o.wrap}>{message.subject}</Text>
      {message.body !== "" && <Markdown text={message.body} />}
      {message.attachments.length > 0 && (
        <ul className={s.files} aria-label={t("office.thread.filesAria")}>
          {message.attachments.map((f) => (
            <li key={f.artifactId}>
              <Link className="orbit-target" href={office.artifactHref(f.artifactId)} target="_blank" rel="noopener noreferrer" {...(SHOWN.test(f.mediaType) ? {} : { download: f.name })}>
                <Attach16Regular aria-hidden /> {f.name}
              </Link>{" "}
              <Text size={200} className={o.muted}>
                {bytesText(f.size)}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// The thread, oldest first: every exchange, or a chosen part's.
export function MissionThreadView({ m, chosen, choose }: { m: MissionDetail; chosen: string | null; choose: (assignmentId: string | null) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const read = useOfficeRead<MissionMessages>(() => office.messages(m.id), [m.id], ["missions", "inbox"], m.id);
  if (read.data === null)
    return read.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{read.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <div className={o.card}>
        <Spinner size="tiny" label={t("office.shared.reading")} />
      </div>
    );
  const shown = chosen === null ? read.data.messages : read.data.messages.filter((x) => x.assignmentId === chosen);
  const part = chosen === null ? null : (m.assignments.find((a) => a.id === chosen) ?? null);
  return (
    <div className={o.card} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {part !== null && (
        <div className={s.head}>
          <Text>{t("office.thread.only", { name: part.employeeName })}</Text>
          <Button size="small" appearance="subtle" onClick={() => choose(null)}>
            {t("office.thread.all")}
          </Button>
        </div>
      )}
      {shown.length === 0 ? (
        <Text className={o.muted}>{t("office.thread.empty")}</Text>
      ) : (
        <ol className={s.thread} aria-label={t("office.thread.aria")}>
          {shown.map((x) => (
            <Mail key={x.id} message={x} />
          ))}
        </ol>
      )}
    </div>
  );
}

// The tab: the pipeline on top, the thread below; a part chosen in the pipeline narrows the thread to it.
export function MissionCommunication({ m }: { m: MissionDetail }) {
  const [chosen, choose] = useState<string | null>(null);
  return (
    <>
      <MissionPipeline m={m} chosen={chosen} choose={choose} />
      <MissionThreadView m={m} chosen={chosen} choose={choose} />
    </>
  );
}
