// An assistant's text as Markdown. Raw HTML in it is shown as text, never rendered (no rehype-raw); links open in a
// new tab without the page as opener; code blocks are highlighted.
import { Link, makeStyles, tokens } from "@fluentui/react-components";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

const useStyles = makeStyles({
  root: {
    lineHeight: tokens.lineHeightBase400,
    overflowWrap: "anywhere",
    "& p": { margin: "0 0 8px 0" },
    "& ul, & ol": { margin: "0 0 8px 0", paddingLeft: "22px" },
    "& table": { borderCollapse: "collapse", margin: "8px 0" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "4px 8px" },
    "& :not(pre) > code": { fontFamily: tokens.fontFamilyMonospace, backgroundColor: tokens.colorNeutralBackground3, padding: "1px 4px", borderRadius: tokens.borderRadiusSmall },
  },
});

const components: Components = {
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  ),
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
