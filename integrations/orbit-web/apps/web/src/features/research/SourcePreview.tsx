// A SOURCE'S TEXT, as research extracted it -- the revision a citation cites, scrolled to its passage and marked. A
// citation of an earlier revision opens that revision, and says it is not the current one; a citation of a source
// deleted since shows the passage it kept. The original file is never served: this is the text questions are answered
// from.
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowLeft16Regular } from "@fluentui/react-icons";
import { RESEARCH_MEDIA_LABELS, type ResearchSourceContent } from "@orbit-web/contracts";
import { useEffect, useRef } from "react";
import { useResource } from "../../hooks/useResource";
import { research } from "./api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "8px", minHeight: 0, height: "100%" },
  head: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", flexShrink: 0 },
  title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  text: { flexGrow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" },
  chunk: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: tokens.fontSizeBase300, lineHeight: "1.6", paddingTop: "6px", paddingRight: "8px", paddingBottom: "6px", paddingLeft: "8px", borderRadius: "8px" },
  cited: { backgroundColor: tokens.colorPaletteYellowBackground2, outline: `1px solid ${tokens.colorPaletteYellowBorder2}` },
  where: { color: tokens.colorNeutralForeground3, display: "block", marginBottom: "2px" },
  quote: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderLeft: `3px solid ${tokens.colorNeutralStroke1}`, paddingLeft: "10px", color: tokens.colorNeutralForeground2 },
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
  const s = useStyles();
  const content = useResource<ResearchSourceContent>(() => research.content(target.sourceId, target.revisionId, target.chunkOrdinal), [target.sourceId, target.revisionId, target.chunkOrdinal]);
  const cited = useRef<HTMLDivElement>(null);
  // A block, returning nothing: scrollIntoView() answers a promise now, and an effect's return is its clean-up.
  useEffect(() => {
    void cited.current?.scrollIntoView({ block: "center" });
  }, [content.data]);
  const c = content.data;
  return (
    <section className={s.root} aria-label={`Source: ${target.title}`}>
      <div className={s.head}>
        <Button appearance="subtle" size="small" icon={<ArrowLeft16Regular />} onClick={onBack}>
          Back
        </Button>
        <Text weight="semibold" className={s.title} title={target.title}>
          {target.title}
        </Text>
        {c && (
          <Badge appearance="outline" size="small">
            {RESEARCH_MEDIA_LABELS[c.mediaType]} · rev. {c.revisionNumber}
          </Badge>
        )}
      </div>
      {c && !c.current && (
        <MessageBar intent="info">
          <MessageBarBody>This is revision {c.revisionNumber}, the one the citation was made from. The source has a newer one now.</MessageBarBody>
        </MessageBar>
      )}
      {content.error && (
        <>
          <MessageBar intent="warning">
            <MessageBarBody>{content.errorCode === "not_found" ? "This source was deleted after it was cited. The passage the citation kept:" : content.error}</MessageBarBody>
          </MessageBar>
          {target.quote && <div className={s.quote}>{target.quote}</div>}
        </>
      )}
      {!c && !content.error && <Spinner size="tiny" label="Reading the source…" />}
      {c && (
        <div className={s.text}>
          {c.chunks.map((chunk) => (
            <div key={chunk.ordinal} ref={chunk.ordinal === target.chunkOrdinal ? cited : undefined} className={mergeClasses(s.chunk, chunk.ordinal === target.chunkOrdinal && s.cited)} data-cited={chunk.ordinal === target.chunkOrdinal || undefined}>
              {(chunk.page !== null || chunk.section) && (
                <Text size={100} className={s.where}>
                  {[chunk.page !== null ? `Page ${chunk.page}` : null, chunk.section].filter(Boolean).join(" · ")}
                </Text>
              )}
              {chunk.text}
            </div>
          ))}
          {c.chunks.length > 0 && (c.chunks.at(-1)?.ordinal ?? 0) < c.totalChunks - 1 && (
            <Text size={200} className={s.where}>
              Passages {(c.chunks[0]?.ordinal ?? 0) + 1}–{(c.chunks.at(-1)?.ordinal ?? 0) + 1} of {c.totalChunks}.
            </Text>
          )}
        </div>
      )}
    </section>
  );
}
