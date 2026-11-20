// SETTINGS → ACCOUNT: the ACCESS LINK of an Orbit Web reached from the internet -- `<origin>/#access=<token>` -- to copy,
// or to open in another tab, so another browser or device gets in with one click. It is read from the API only here,
// where whoever asks is already in (the access gate and the Claude sign-in stand in front of it), and never shown on the
// sign-in page: the link is the token. On this machine alone there is none, and the card says why.
import { Button, Field, Input, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Copy16Regular, Open16Regular } from "@fluentui/react-icons";
import type { AccessLink } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { get } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap" },
  hint: { color: tokens.colorNeutralForeground3 },
});

export const accessLinkOf = (token: string): string => `${window.location.origin}/#access=${token}`;

export function AccessLinkCard() {
  const s = useStyles();
  const access = useResource<AccessLink>(() => get("/api/access/link"), []);
  const [copied, setCopied] = useState(false);
  const token = access.data?.token ?? null;
  const link = token === null ? null : accessLinkOf(token);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className={s.root} aria-label="Access link">
      <Text weight="semibold">Access link</Text>
      {access.data === null && (access.error ? <Text size={200}>{access.error}</Text> : <Spinner size="tiny" label="Reading the access link…" />)}
      {access.data !== null && link === null && (
        <Text size={200} className={s.hint}>
          This Orbit Web answers this machine only, so it asks for no access token and has no access link.
        </Text>
      )}
      {link !== null && (
        <>
          <Field label="Access link">
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
          </Field>
          <div className={s.actions}>
            <Button icon={<Copy16Regular />} onClick={() => void copy(link)}>
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button icon={<Open16Regular />} onClick={() => window.open(link, "_blank", "noopener,noreferrer")}>
              Open in a new tab
            </Button>
          </div>
          <Text size={200} className={s.hint}>
            Anyone with this link can sign in to this Orbit Web: open it once in each browser you use (it is then remembered 30 days), and keep it to
            yourself.
          </Text>
        </>
      )}
    </section>
  );
}
