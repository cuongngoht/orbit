import { makeStyles, tokens } from "@fluentui/react-components";
import { highlighted } from "./highlight";

const useStyles = makeStyles({
  pre: {
    margin: 0,
    padding: "10px 12px",
    overflowX: "auto",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
  },
});

export function CodeBlock({ code, language }: { code: string; language?: string | null }) {
  const s = useStyles();
  return (
    <pre className={s.pre}>
      <code dangerouslySetInnerHTML={{ __html: highlighted(code, language) }} />
    </pre>
  );
}
