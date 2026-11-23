// SETTINGS → ACCOUNT: the ACCESS LINK of an Orbit Web reached from the internet -- `<origin>/#access=<token>` -- to copy,
// or to open in another tab, so another browser or device gets in with one click. It is read from the API only here,
// where whoever asks is already in (the access gate and the Claude sign-in stand in front of it), and never shown on the
// sign-in page: the link is the token. On this machine alone there is none, and the card says why.
import { Button, Field, Input, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Copy16Regular, Open16Regular } from "@fluentui/react-icons";
import type { AccessLink } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { get } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap", "@media (max-width: 639px)": { flexDirection: "column", alignItems: "stretch" } },
  actionBtn: { "@media (max-width: 639px), (pointer: coarse)": { minHeight: "44px" } },
  hint: { color: tokens.colorNeutralForeground3 },
});

export const accessLinkOf = (token: string): string => `${window.location.origin}/#access=${token}`;

export function AccessLinkCard() {
  const { t } = useI18n();
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
    <section className={s.root} aria-label={t("settings.accessLink.title")}>
      <Text weight="semibold">{t("settings.accessLink.title")}</Text>
      {access.data === null && (access.error ? <Text size={200}>{access.error}</Text> : <Spinner size="tiny" label={t("settings.accessLink.loading")} />)}
      {access.data !== null && link === null && (
        <Text size={200} className={s.hint}>
          {t("settings.accessLink.localOnly")}
        </Text>
      )}
      {link !== null && (
        <>
          <Field label={t("settings.accessLink.title")}>
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
          </Field>
          <div className={s.actions}>
            <Button className={s.actionBtn} icon={<Copy16Regular />} onClick={() => void copy(link)}>
              {copied ? t("settings.accessLink.copied") : t("settings.accessLink.copy")}
            </Button>
            <Button className={s.actionBtn} icon={<Open16Regular />} onClick={() => window.open(link, "_blank", "noopener,noreferrer")}>
              {t("settings.accessLink.open")}
            </Button>
          </div>
          <Text size={200} className={s.hint}>
            {t("settings.accessLink.hint")}
          </Text>
        </>
      )}
    </section>
  );
}
