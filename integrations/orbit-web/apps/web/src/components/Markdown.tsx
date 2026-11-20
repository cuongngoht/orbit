// An assistant's text as Markdown. Raw HTML in it is shown as text, never rendered (no rehype-raw); links open in a
// new tab without the page as opener; code blocks are highlighted.
import { Link, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

const useStyles = makeStyles({
  root: {
    fontSize: "15px",
    lineHeight: "1.65",
    overflowWrap: "anywhere",
    "& p": { margin: "0 0 12px 0" },
    "& p:last-child": { marginBottom: "0" },
    "& h1, & h2, & h3": { letterSpacing: "-0.015em", lineHeight: "1.3", margin: "18px 0 8px 0" },
    "& h1:first-child, & h2:first-child, & h3:first-child": { marginTop: "0" },
    "& ul, & ol": { margin: "0 0 12px 0", paddingLeft: "22px" },
    "& li": { marginBottom: "4px" },
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
  tableWrap: {
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
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

const components: Components = {
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  ),
  table: ({ children }) => <ScrollTable>{children}</ScrollTable>,
  code: ({ className, children }) => {
    const language = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? null;
    const text = String(children ?? "");
    if (language === null && !text.includes("\n")) return <code>{children}</code>;
    return <CodeBlock code={text.replace(/\n$/, "")} language={language} />;
  },
  pre: ({ children }) => <>{children}</>,
};

export function Markdown({ text }: { text: string }) {
  const s = useStyles();
  return (
    <div className={s.root}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
