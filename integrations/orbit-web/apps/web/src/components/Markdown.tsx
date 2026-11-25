// An assistant's text as Markdown. Raw HTML in it is shown as text, never rendered (no rehype-raw); links open in a
// new tab without the page as opener; code blocks are highlighted. A research answer's citation labels ([S3]) can be
// shown as chips that open their passage -- only the labels the server verified (`cite`).
import { Link, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { createContext, useContext, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { CodeBlock } from "./CodeBlock";

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    maxWidth: "100%",
    fontSize: "15px",
    lineHeight: "1.65",
    overflowWrap: "anywhere",
    "& p": { margin: "0 0 12px 0" },
    "& p:last-child": { marginBottom: "0" },
    "& h1, & h2, & h3": { letterSpacing: "-0.015em", lineHeight: "1.3", margin: "18px 0 8px 0" },
    "& h1": { fontSize: "1.35em" },
    "& h2": { fontSize: "1.2em" },
    "& h3": { fontSize: "1.07em" },
    "& h1:first-child, & h2:first-child, & h3:first-child": { marginTop: "0" },
    "& ul, & ol": { margin: "0 0 12px 0", paddingLeft: "22px" },
    "& li": { marginBottom: "4px" },
    "& img": { maxWidth: "100%", height: "auto" },
    "& blockquote": {
      margin: "8px 0 12px 0",
      paddingLeft: "12px",
      borderLeft: `2px solid ${tokens.colorNeutralStroke1}`,
      color: tokens.colorNeutralForeground2,
    },
    "& table": { borderCollapse: "collapse", width: "100%", margin: "0" },
    "& th": {
      backgroundColor: tokens.colorNeutralBackground2,
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase200,
    },
    "& th, & td": {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: "7px 11px",
      minWidth: "96px",
      textAlign: "left",
      verticalAlign: "top",
      overflowWrap: "break-word",
      wordBreak: "normal",
    },
    "& :not(pre) > code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.875em",
      backgroundColor: tokens.colorNeutralBackground3,
      padding: "2px 6px",
      borderRadius: "6px",
    },
  },
  cite: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "2px",
    marginRight: "1px",
    paddingTop: 0,
    paddingRight: "6px",
    paddingBottom: 0,
    paddingLeft: "6px",
    minHeight: "20px",
    borderRadius: "9999px",
    ...shorthands.border("1px", "solid", tokens.colorBrandStroke2),
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
    lineHeight: "1.6",
    verticalAlign: "0.05em",
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
    ":hover": { backgroundColor: tokens.colorBrandBackground2Hover, ...shorthands.borderColor(tokens.colorBrandStroke1) },
    ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}` },
    "@media (pointer: coarse)": {
      "::after": { content: '""', position: "absolute", inset: "-8px -4px" },
    },
  },
  tableWrap: {
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    marginTop: "10px",
    marginBottom: "12px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
});

function ScrollTable({ children }: { children?: ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.tableWrap}>
      <table>{children}</table>
    </div>
  );
}

// The labels a research answer may show as citation chips, and what opening one does.
export interface Citing {
  labels: ReadonlySet<string>;
  onCite: (label: string) => void;
}

const CITE = "#orbit-cite-";

const CitingContext = createContext<Citing | null>(null);

// A link -- or, in a research answer, a verified citation's chip. One component for both, so a re-render never swaps
// the element under a pointer.
function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
  const { t } = useI18n();
  const s = useStyles();
  const cite = useContext(CitingContext);
  if (cite !== null && href?.startsWith(CITE)) {
    const label = href.slice(CITE.length);
    return (
      <button type="button" className={s.cite} onClick={() => cite.onCite(label)} aria-label={t("common.markdown.citation", { label })}>
        {label}
      </button>
    );
  }
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  );
}

const components: Components = {
  a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
  table: ({ children }) => <ScrollTable>{children}</ScrollTable>,
  code: ({ className, children }) => {
    const language = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? null;
    const text = String(children ?? "");
    if (language === null && !text.includes("\n")) return <code>{children}</code>;
    return <CodeBlock code={text.replace(/\n$/, "")} language={language} />;
  },
  pre: ({ children }) => <>{children}</>,
};

// [S3] -> a link the renderer turns into a chip (outside code spans, which keep their text).
const linked = (text: string, labels: ReadonlySet<string>): string =>
  text.replace(/(`[^`]*`)|\[(S\d{1,3})\]/g, (whole, code: string | undefined, label: string | undefined) => (code === undefined && label !== undefined && labels.has(label) ? `[${label}](${CITE}${label})` : whole));

export function Markdown({ text, cite }: { text: string; cite?: Citing }) {
  const s = useStyles();
  return (
    <div className={s.root}>
      <CitingContext.Provider value={cite ?? null}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {cite === undefined ? text : linked(text, cite.labels)}
        </ReactMarkdown>
      </CitingContext.Provider>
    </div>
  );
}
