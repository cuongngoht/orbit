import { Button, Caption1, Persona, Popover, PopoverSurface, PopoverTrigger, Skeleton, SkeletonItem, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useHostAccount, type HostAccount } from "./account.api";

const useStyles = makeStyles({
  surface: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, maxWidth: "22rem" },
  facts: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, margin: 0 },
  dd: { margin: 0, overflowWrap: "anywhere" },
  muted: { color: tokens.colorNeutralForeground3 },
  skeleton: { width: "10rem" },
});

const HOST_NAME: Record<string, string> = { claude: "Claude Code" };

// The top bar's account: whoever is signed in to Claude Code on THIS machine,
// as Claude Code records it here -- so every machine shows its own. A profile
// (name, email, organization, role) and nothing more: Orbit never reads, holds
// or uses a Claude token.
export function AccountChip() {
  const styles = useStyles();
  const account = useHostAccount();
  if (account.isPending)
    return (
      <Skeleton className={styles.skeleton} aria-label="Reading the Claude account">
        <SkeletonItem size={24} />
      </Skeleton>
    );
  if (account.isError) return <Caption1 className={styles.muted}>Claude account: unknown</Caption1>;
  return <Chip account={account.data} />;
}

function Chip({ account }: { account: HostAccount }) {
  const styles = useStyles();
  const host = HOST_NAME[account.host] ?? account.host;
  const name = account.signedIn ? account.displayName ?? account.email ?? `${host} user` : `No ${host} profile`;
  return (
    <Popover positioning="below-end" withArrow>
      <PopoverTrigger disableButtonEnhancement>
        <Button appearance="subtle" aria-label={account.signedIn ? `Signed in to ${host} as ${name}` : `No ${host} account profile on this machine`}>
          <Persona size="small" name={name} secondaryText={account.signedIn ? account.organization ?? account.email ?? host : host} avatar={{ color: account.signedIn ? "colorful" : "neutral" }} />
        </Button>
      </PopoverTrigger>
      <PopoverSurface aria-label={`${host} account`}>
        <div className={styles.surface}>
          <Text weight="semibold">{account.signedIn ? `Signed in to ${host} on this machine` : `No ${host} account profile on this machine`}</Text>
          {account.signedIn ? <Facts account={account} /> : <Caption1>{host} keeps no signed-in account profile here — sign in to it (for Claude Code: /login), or it uses an API key or a cloud provider, which have none.</Caption1>}
          <Caption1 className={styles.muted}>Read from {host}'s own configuration on this machine: the profile only. Orbit never reads or uses your {host} token.</Caption1>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

function Facts({ account }: { account: HostAccount }) {
  const styles = useStyles();
  const rows: [string, string | undefined][] = [
    ["Name", account.displayName],
    ["Email", account.email],
    ["Organization", account.organization],
    ["Role", account.role],
  ];
  return (
    <dl className={styles.facts}>
      {rows
        .filter((row): row is [string, string] => typeof row[1] === "string")
        .map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>
              <Text weight="semibold">{k}</Text>
            </dt>
            <dd className={styles.dd}>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
