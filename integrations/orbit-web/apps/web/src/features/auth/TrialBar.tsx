// THE TRIAL BAR, red, on every page while this installation runs as a localhost-only trial: the seeded login is public
// knowledge, so the page says it -- and says to change it -- until the installation is no longer a trial.
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";
import type { TrialMode } from "@orbit-web/contracts";
import { t as tr, useI18n } from "../../i18n";

export const trialText = (trial: TrialMode): string => tr("settings.auth.trialText", { username: trial.username ?? "admin", password: trial.password ?? "123456" });

// `onChangePassword` is offered once somebody is signed in (a password is changed by its user).
export function TrialBar({ trial, onChangePassword }: { trial: TrialMode; onChangePassword?: () => void }) {
  const { t } = useI18n();
  if (!trial.enabled) return null;
  return (
    <MessageBar className="orbit-touch" intent="error" layout="multiline" aria-label={t("settings.auth.trialTitle")} style={{ borderRadius: 0, flexShrink: 0 }}>
      <MessageBarBody>
        <MessageBarTitle>{t("settings.auth.trialTitle")}</MessageBarTitle>
        {t("settings.auth.trialText", { username: trial.username ?? "admin", password: trial.password ?? "123456" })}
      </MessageBarBody>
      {onChangePassword && (
        <MessageBarActions>
          <Button appearance="primary" size="small" onClick={onChangePassword}>
            {t("settings.auth.changePassword")}
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}
