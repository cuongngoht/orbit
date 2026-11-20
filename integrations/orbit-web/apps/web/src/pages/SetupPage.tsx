// After the Claude sign-in (Orbit Web's own, asked for before this page can open): connect GitHub, and Azure if wanted;
// the chat workspace opens once GitHub is connected. No Orbit step: the plugin is already in the image.
import { Button, Text, Title2, makeStyles, tokens } from "@fluentui/react-components";
import type { SetupStatus } from "@orbit-web/contracts";
import { AzureCard } from "../features/setup/AzureCard";
import { GitHubCard } from "../features/setup/GitHubCard";
import { SystemCard } from "../features/setup/SystemCard";

const useStyles = makeStyles({
  page: { maxWidth: "880px", margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: "16px" },
  muted: { color: tokens.colorNeutralForeground3 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" },
});

export function SetupPage({ status, reload, onContinue, title = "Set up Orbit Web" }: { status: SetupStatus | null; reload: () => void; onContinue?: () => void; title?: string }) {
  const s = useStyles();
  return (
    <div className={s.page}>
      <Title2>{title}</Title2>
      <Text className={s.muted}>
        Signed in with Claude as <strong>{status?.claude.account?.email ?? "your Claude account"}</strong>. Connect your GitHub account to open your repositories (and, if you work with Azure, your Azure account). Every sign-in uses the official command-line tool inside this container; nothing is stored outside it.
      </Text>
      <div className={s.grid}>
        <GitHubCard status={status?.github ?? null} onChanged={reload} />
        <AzureCard status={status?.azure ?? null} onChanged={reload} />
      </div>
      <SystemCard status={status} />
      {onContinue && (
        <div>
          <Button appearance="primary" size="large" disabled={!status?.ready} onClick={onContinue}>
            Open the chat workspace
          </Button>
          {!status?.ready && <Text className={s.muted}> Connect GitHub to continue.</Text>}
        </div>
      )}
    </div>
  );
}
