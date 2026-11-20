// Who Orbit Web is signed in as -- the Claude account -- in the header, and the way to sign out.
import { Avatar, Button, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuList, MenuPopover, MenuTrigger, Text, makeStyles, tokens } from "@fluentui/react-components";
import { SignOut20Regular } from "@fluentui/react-icons";
import type { ClaudeAccount } from "@orbit-web/contracts";

const useStyles = makeStyles({
  who: { display: "flex", flexDirection: "column", padding: "4px 8px 8px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// "Octo Org · max": what the CLI said about the account beyond its address, when it said anything.
export const accountLine = (a: ClaudeAccount | null): string | null => {
  const parts = [a?.organization, a?.plan].filter((p): p is string => typeof p === "string" && p !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
};

export function AccountMenu({ account, busy, onSignOut }: { account: ClaudeAccount | null; busy: boolean; onSignOut: () => void }) {
  const s = useStyles();
  const name = account?.email ?? "Claude account";
  const line = accountLine(account);
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<Avatar name={name} size={24} />} aria-label={`Signed in as ${name}`} disabled={busy}>
          {name}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>Signed in with Claude</MenuGroupHeader>
            <div className={s.who}>
              <Text weight="semibold">{name}</Text>
              {line && (
                <Text size={200} className={s.muted}>
                  {line}
                </Text>
              )}
            </div>
          </MenuGroup>
          <MenuDivider />
          <MenuItem icon={<SignOut20Regular />} onClick={onSignOut}>
            Sign out
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
