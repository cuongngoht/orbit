import { Button, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { Checkmark16Regular, Copy16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { useI18n } from "../i18n";
import { highlighted } from "./highlight";

const useStyles = makeStyles({
  wrap: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    marginTop: "6px",
    marginBottom: "8px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    overflow: "hidden",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    paddingTop: "5px",
    paddingRight: "8px",
    paddingBottom: "5px",
    paddingLeft: "14px",
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
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "13px",
    lineHeight: "1.55",
  },
});

function fallbackCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CodeBlock({ code, language }: { code: string; language?: string | null }) {
  const { t } = useI18n();
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok: boolean;
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {
      ok = fallbackCopy(code);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className={s.wrap}>
      <div className={s.bar}>
        <Text size={100} className={s.lang}>
          {language ?? t("common.codeBlock.defaultLang")}
        </Text>
        <Button
          className={s.copyBtn}
          size="small"
          appearance="subtle"
          icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
          aria-label={copied ? t("common.codeBlock.copied") : t("common.codeBlock.copyAria")}
          onClick={() => void copy()}
        >
          {copied ? t("common.codeBlock.copied") : t("common.codeBlock.copy")}
        </Button>
      </div>
      <pre className={s.pre}>
        <code dangerouslySetInnerHTML={{ __html: highlighted(code, language) }} />
      </pre>
    </div>
  );
}
