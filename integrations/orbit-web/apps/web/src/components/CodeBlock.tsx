import { Button, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { Checkmark16Regular, Copy16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { highlighted } from "./highlight";

const useStyles = makeStyles({
  wrap: {
    maxWidth: "100%",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    overflow: "hidden",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    paddingTop: "4px",
    paddingRight: "6px",
    paddingBottom: "4px",
    paddingLeft: "12px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  lang: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
  },
  copyBtn: {
    minHeight: "32px",
    "@media (pointer: coarse)": { minHeight: "36px" },
  },
  pre: {
    margin: 0,
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    overflowX: "auto",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
  },
});

export function CodeBlock({ code, language }: { code: string; language?: string | null }) {
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={s.wrap}>
      <div className={s.bar}>
        <Text size={100} className={s.lang}>
          {language ?? "code"}
        </Text>
        <Button
          className={s.copyBtn}
          size="small"
          appearance="subtle"
          icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
          aria-label="Copy code"
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className={s.pre}>
        <code dangerouslySetInnerHTML={{ __html: highlighted(code, language) }} />
      </pre>
    </div>
  );
}
