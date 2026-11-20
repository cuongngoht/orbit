// How research's records are said on a page: a source's kind (its icon) and its state, a citation's place.
import { Badge, Spinner, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { DocumentPdf20Regular, DocumentText20Regular, Globe20Regular, TextDescription20Regular } from "@fluentui/react-icons";
import { RESEARCH_MEDIA_LABELS, type ResearchCitation, type ResearchSourceSummary } from "@orbit-web/contracts";

const useStyles = makeStyles({
  icon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  state: { display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 },
});

export function SourceIcon({ source }: { source: ResearchSourceSummary }) {
  const s = useStyles();
  const label = source.kind === "url" ? "Web page" : source.mediaType !== null ? RESEARCH_MEDIA_LABELS[source.mediaType] : "Document";
  const Icon = source.kind === "url" || source.mediaType === "html" ? Globe20Regular : source.mediaType === "pdf" ? DocumentPdf20Regular : source.mediaType === "docx" ? DocumentText20Regular : TextDescription20Regular;
  return <Icon className={s.icon} aria-label={label} role="img" />;
}

// queued · reading · ready · failed (why) · stale (why): what the source can be searched for now.
export function SourceState({ source }: { source: ResearchSourceSummary }) {
  const s = useStyles();
  if (source.state === "processing")
    return (
      <span className={s.state}>
        <Spinner size="extra-tiny" aria-label="Reading" />
        <Badge appearance="tint" color="brand" size="small">
          {source.revision ? "Refreshing" : "Reading"}
        </Badge>
      </span>
    );
  if (source.state === "queued")
    return (
      <Badge appearance="tint" color="informative" size="small">
        Queued
      </Badge>
    );
  if (source.state === "failed" || source.state === "stale")
    return (
      <Tooltip content={source.stateReason ?? (source.state === "failed" ? "It could not be read." : "Its newest snapshot could not be read.")} relationship="description">
        <Badge appearance="tint" color={source.state === "failed" ? "danger" : "warning"} size="small" tabIndex={0}>
          {source.state === "failed" ? "Failed" : "Stale"}
        </Badge>
      </Tooltip>
    );
  return null;
}

// Where a citation's passage is: its page (when the format has pages), its section, its revision.
export function placeOf(c: Pick<ResearchCitation, "page" | "section" | "revisionNumber">): string {
  return [c.page !== null ? `p. ${c.page}` : null, c.section, c.revisionNumber !== null ? `rev. ${c.revisionNumber}` : null].filter((x) => x !== null).join(" · ");
}

export const searchable = (s: ResearchSourceSummary): boolean => s.revision !== null;

export const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
