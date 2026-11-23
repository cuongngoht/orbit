// A SOURCE'S TEXT, as research extracted it -- the revision a citation cites, scrolled to its passage and marked. A
// citation of an earlier revision opens that revision, and says it is not the current one; a citation of a source
// deleted since shows the passage it kept. The original file is never served: this is the text questions are answered
// from.
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ArrowLeft16Regular } from "@fluentui/react-icons";
import { RESEARCH_MEDIA_LABELS, type ResearchSourceContent } from "@orbit-web/contracts";
import { useEffect, useRef } from "react";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { research } from "./api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, height: "100%" },
  head: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    flexShrink: 0,
    paddingTop: "4px",
    paddingBottom: "8px",
    backgroundColor: "var(--orbit-header-bg)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  backBtn: { borderRadius: "9999px", flexShrink: 0 },
  backBtnTouch: { minHeight: "40px" },
  title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: { flexShrink: 0, whiteSpace: "nowrap" },
  text: { flexGrow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "2px", paddingBottom: "8px" },
  chunk: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.68",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  cited: {
    backgroundColor: tokens.colorPaletteYellowBackground1,
    ...shorthands.borderColor(tokens.colorPaletteYellowBorder1),
    boxShadow: `inset 3px 0 0 ${tokens.colorPaletteMarigoldBorderActive}`,
  },
  whereRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" },
  where: { color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold, letterSpacing: "0.02em" },
  quote: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    backgroundColor: "var(--orbit-tool-bg)",
    borderRadius: "0 10px 10px 0",
    boxShadow: `inset 3px 0 0 ${tokens.colorNeutralStroke1}`,
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "14px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.6",
  },
});

export interface PreviewTarget {
  sourceId: string;
  // The cited revision (null: the current one), and the cited passage (null: from the start).
  revisionId: string | null;
  chunkOrdinal: number | null;
  title: string;
  // What the citation kept of its passage, shown when the source is gone.
  quote: string | null;
}

export function SourcePreview({ target, onBack }: { target: PreviewTarget; onBack: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
  const touch = isMobile || isCoarse;
  const content = useResource<ResearchSourceContent>(() => research.content(target.sourceId, target.revisionId, target.chunkOrdinal), [target.sourceId, target.revisionId, target.chunkOrdinal]);
  const cited = useRef<HTMLDivElement>(null);
  // A block, returning nothing: scrollIntoView() answers a promise now, and an effect's return is its clean-up.
  useEffect(() => {
    void cited.current?.scrollIntoView({ block: "center" });
  }, [content.data]);
  const c = content.data;
  return (
    <section className={s.root} aria-label={t("research.preview.aria", { title: target.title })}>
      <div className={s.head}>
        <Button className={mergeClasses(s.backBtn, touch && s.backBtnTouch)} appearance="subtle" size="small" icon={<ArrowLeft16Regular />} onClick={onBack}>
          {t("research.preview.back")}
        </Button>
        <Text weight="semibold" className={s.title} title={target.title}>
          {target.title}
        </Text>
        {c && (
          <Badge className={s.badge} appearance="outline" size="small">
            {RESEARCH_MEDIA_LABELS[c.mediaType]} · {t("research.labels.revPrefix", { revision: c.revisionNumber })}
          </Badge>
        )}
      </div>
      {c && !c.current && (
        <MessageBar intent="info">
          <MessageBarBody>{t("research.preview.olderRevisionBanner", { revision: c.revisionNumber })}</MessageBarBody>
        </MessageBar>
      )}
      {content.error && (
        <>
          <MessageBar intent="warning">
            <MessageBarBody>{content.errorCode === "not_found" ? t("research.preview.deletedBanner") : content.error}</MessageBarBody>
          </MessageBar>
          {target.quote && <div className={s.quote}>{target.quote}</div>}
        </>
      )}
      {!c && !content.error && <Spinner size="tiny" label={t("research.preview.reading")} />}
      {c && (
        <div className={s.text}>
          {c.chunks.map((chunk) => {
            const isCited = chunk.ordinal === target.chunkOrdinal;
            const whereLabel = [chunk.page !== null ? t("research.preview.pageNumber", { page: chunk.page }) : null, chunk.section].filter(Boolean).join(" · ");
            return (
              <div key={chunk.ordinal} ref={isCited ? cited : undefined} className={mergeClasses(s.chunk, isCited && s.cited)} data-cited={isCited || undefined}>
                {(whereLabel || isCited) && (
                  <div className={s.whereRow}>
                    <Text size={100} className={s.where}>
                      {whereLabel}
                    </Text>
                    {isCited && (
                      <Badge className={s.badge} appearance="tint" color="warning" size="small">
                        {t("research.preview.citedPassage")}
                      </Badge>
                    )}
                  </div>
                )}
                {chunk.text}
              </div>
            );
          })}
          {c.chunks.length > 0 && (c.chunks.at(-1)?.ordinal ?? 0) < c.totalChunks - 1 && (
            <Text size={200} className={s.where}>
              {t("research.preview.passagesRange", {
                from: (c.chunks[0]?.ordinal ?? 0) + 1,
                to: (c.chunks.at(-1)?.ordinal ?? 0) + 1,
                total: c.totalChunks,
              })}
            </Text>
          )}
        </div>
      )}
    </section>
  );
}
