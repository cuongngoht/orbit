// How research's records are said on a page: a source's kind (its icon) and its state, a citation's place.
import { Badge, Spinner, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { DocumentPdf20Regular, DocumentText20Regular, Globe20Regular, TextDescription20Regular } from "@fluentui/react-icons";
import { RESEARCH_MEDIA_LABELS, type ResearchCitation, type ResearchSourceSummary } from "@orbit-web/contracts";
import { t as tr, useI18n } from "../../i18n";

const useStyles = makeStyles({
  iconWrap: {
    width: "28px",
    height: "28px",
    borderRadius: "8px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  kindWeb: { backgroundColor: tokens.colorPaletteTealBackground2, color: tokens.colorPaletteTealForeground2 },
  kindPdf: { backgroundColor: tokens.colorPaletteCranberryBackground2, color: tokens.colorPaletteCranberryForeground2 },
  kindDocx: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 },
  kindText: { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2 },
  state: { display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 },
  badge: { flexShrink: 0, whiteSpace: "nowrap" },
});

export function SourceIcon({ source }: { source: ResearchSourceSummary }) {
  const { t } = useI18n();
  const s = useStyles();
  const isWeb = source.kind === "url" || source.mediaType === "html";
  const label = source.kind === "url" ? t("research.labels.webPage") : source.mediaType !== null ? RESEARCH_MEDIA_LABELS[source.mediaType] : t("research.labels.document");
  const Icon = isWeb ? Globe20Regular : source.mediaType === "pdf" ? DocumentPdf20Regular : source.mediaType === "docx" ? DocumentText20Regular : TextDescription20Regular;
  const tone = isWeb ? s.kindWeb : source.mediaType === "pdf" ? s.kindPdf : source.mediaType === "docx" ? s.kindDocx : s.kindText;
  return (
    <span className={mergeClasses(s.iconWrap, tone)}>
      <Icon aria-label={label} role="img" />
    </span>
  );
}

// queued · reading · ready · failed (why) · stale (why): what the source can be searched for now.
export function SourceState({ source }: { source: ResearchSourceSummary }) {
  const { t } = useI18n();
  const s = useStyles();
  if (source.state === "processing")
    return (
      <span className={s.state}>
        <Spinner size="extra-tiny" aria-label={t("research.labels.reading")} />
        <Badge className={s.badge} appearance="tint" color="brand" size="small">
          {source.revision ? t("research.labels.refreshing") : t("research.labels.reading")}
        </Badge>
      </span>
    );
  if (source.state === "queued")
    return (
      <Badge className={s.badge} appearance="tint" color="informative" size="small">
        {t("research.labels.queued")}
      </Badge>
    );
  if (source.state === "failed" || source.state === "stale")
    return (
      <Tooltip content={source.stateReason ?? t(source.state === "failed" ? "research.labels.failedReasonFallback" : "research.labels.staleReasonFallback")} relationship="description">
        <Badge className={s.badge} appearance="tint" color={source.state === "failed" ? "danger" : "warning"} size="small" tabIndex={0}>
          {source.state === "failed" ? t("research.labels.failed") : t("research.labels.stale")}
        </Badge>
      </Tooltip>
    );
  return null;
}

// Where a citation's passage is: its page (when the format has pages), its section, its revision.
export function placeOf(c: Pick<ResearchCitation, "page" | "section" | "revisionNumber">): string {
  return [c.page !== null ? tr("research.labels.pagePrefix", { page: c.page }) : null, c.section, c.revisionNumber !== null ? tr("research.labels.revPrefix", { revision: c.revisionNumber }) : null].filter((x) => x !== null).join(" · ");
}

export const searchable = (s: ResearchSourceSummary): boolean => s.revision !== null;

export const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
