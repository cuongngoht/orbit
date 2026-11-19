// A unified diff, line by line, with the old and new line numbers and each line's code highlighted for its language.
import { makeStyles, tokens } from "@fluentui/react-components";
import { useMemo } from "react";
import { highlighted } from "../../components/highlight";

export interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

// Pure: the lines of `git diff` output with their numbers.
export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const text of diff.replace(/\n$/, "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: "hunk", text, oldNo: null, newNo: null });
    } else if (!inHunk || text.startsWith("\\")) lines.push({ kind: "meta", text, oldNo: null, newNo: null });
    else if (text.startsWith("+")) lines.push({ kind: "add", text: text.slice(1), oldNo: null, newNo: newNo++ });
    else if (text.startsWith("-")) lines.push({ kind: "del", text: text.slice(1), oldNo: oldNo++, newNo: null });
    else lines.push({ kind: "ctx", text: text.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  return lines;
}

const useStyles = makeStyles({
  table: { borderCollapse: "collapse", width: "100%", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, lineHeight: "18px" },
  no: { color: tokens.colorNeutralForeground4, textAlign: "right", padding: "0 6px", userSelect: "none", verticalAlign: "top", width: "1%", whiteSpace: "nowrap" },
  code: { whiteSpace: "pre", padding: "0 8px" },
  add: { backgroundColor: "var(--diff-add-bg)" },
  del: { backgroundColor: "var(--diff-del-bg)" },
  hunk: { backgroundColor: "var(--diff-hunk-bg)", color: tokens.colorNeutralForeground3 },
  meta: { color: tokens.colorNeutralForeground3 },
  wrap: { overflowX: "auto" },
});

const SIGN: Record<DiffLine["kind"], string> = { add: "+", del: "-", ctx: " ", hunk: "", meta: "" };

export function DiffView({ diff, language }: { diff: string; language: string | null }) {
  const s = useStyles();
  const lines = useMemo(() => parseDiff(diff), [diff]);
  return (
    <div className={s.wrap}>
      <table className={s.table} aria-label="Diff">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={l.kind === "add" ? s.add : l.kind === "del" ? s.del : l.kind === "hunk" ? s.hunk : l.kind === "meta" ? s.meta : undefined} data-kind={l.kind}>
              <td className={s.no}>{l.oldNo ?? ""}</td>
              <td className={s.no}>{l.newNo ?? ""}</td>
              {l.kind === "hunk" || l.kind === "meta" ? (
                <td className={s.code}>{l.text}</td>
              ) : (
                <td className={s.code}>
                  {SIGN[l.kind]}
                  <span dangerouslySetInnerHTML={{ __html: highlighted(l.text, language) }} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
