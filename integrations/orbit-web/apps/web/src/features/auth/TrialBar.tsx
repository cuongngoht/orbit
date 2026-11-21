// THE TRIAL BAR, red, on every page while this installation runs as a localhost-only trial: the seeded login is public
// knowledge, so the page says it -- and says to change it -- until the installation is no longer a trial.
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";
import type { TrialMode } from "@orbit-web/contracts";

export const trialText = (trial: TrialMode): string => `Trial login ${trial.username ?? "admin"} / ${trial.password ?? "123456"} — change the password, never expose this installation`;

// `onChangePassword` is offered once somebody is signed in (a password is changed by its user).
export function TrialBar({ trial, onChangePassword }: { trial: TrialMode; onChangePassword?: () => void }) {
  if (!trial.enabled) return null;
  return (
    <MessageBar className="orbit-touch" intent="error" layout="multiline" aria-label="Trial installation" style={{ borderRadius: 0, flexShrink: 0 }}>
      <MessageBarBody>
        <MessageBarTitle>Trial installation</MessageBarTitle>
        {trialText(trial)}
      </MessageBarBody>
      {onChangePassword && (
        <MessageBarActions>
          <Button appearance="primary" size="small" onClick={onChangePassword}>
            Change password
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}
