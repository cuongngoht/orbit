// An API's refusal, said as it was -- except the one a person answers in Settings: a chat, a research question or an
// employee's work that needs an AI CLI nobody connected yet (`connection_required`). That one says where to connect it,
// with a link, instead of a sign-in page: signing in to Orbit and connecting a provider are two different things.
import { Link, MessageBar, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";
import { CONNECTION_ERRORS } from "@orbit-web/contracts";
import { settingsHref } from "../hooks/useHashRoute";
import { useI18n } from "../i18n";
import { errorCode, errorText } from "../services/api";

export const isConnectionRequired = (err: unknown): boolean => errorCode(err) === CONNECTION_ERRORS.connectionRequired;

export function ConnectionRequired({ what }: { what?: string }) {
  const { t } = useI18n();
  const target = what ?? t("common.apiError.defaultWhat");
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>{t("common.apiError.noConnectionTitle")}</MessageBarTitle>
        {t("common.apiError.connectPrefix")}
        {target}
        {t("common.apiError.connectSuffix")}
        <Link href={settingsHref("ai-connections")}>{t("common.apiError.openConnections")}</Link>
      </MessageBarBody>
    </MessageBar>
  );
}

export function ApiErrorBar({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  if (isConnectionRequired(error)) {
    const text = errorText(error);
    return <ConnectionRequired what={/codex/i.test(text) ? "OpenAI Codex" : "Claude Code"} />;
  }
  return (
    <MessageBar intent="error">
      <MessageBarBody>{errorText(error)}</MessageBarBody>
    </MessageBar>
  );
}
