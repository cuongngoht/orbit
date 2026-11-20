// The first page, and the only one before a Claude account is signed in: Orbit Web's sign-in IS the Claude account's,
// and the API refuses everything else until then.
import { Card, Text, Title2, makeStyles, tokens } from "@fluentui/react-components";
import { ORBIT_WEB_VERSION, type ClaudeStatus } from "@orbit-web/contracts";
import { ClaudeSignIn } from "../features/auth/ClaudeSignIn";

const useStyles = makeStyles({
  page: { minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px 32px", boxSizing: "border-box", backgroundColor: tokens.colorNeutralBackground2 },
  card: { width: "100%", maxWidth: "520px", padding: "28px", display: "flex", flexDirection: "column", gap: "16px" },
  brand: { display: "flex", alignItems: "center", gap: "10px" },
  logo: { width: "32px", height: "32px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function SignInPage({ status, onChanged }: { status: ClaudeStatus | null; onChanged: () => void }) {
  const s = useStyles();
  return (
    <main className={s.page}>
      <Card className={s.card} aria-label="Sign in to Orbit Web">
        <div className={s.brand}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <Title2 as="h1">Sign in to Orbit Web</Title2>
        </div>
        <Text>Orbit Web signs in with your Claude account. Claude Code runs as this account in every chat, and nothing opens until you sign in.</Text>
        <ClaudeSignIn status={status} onChanged={onChanged} />
        <Text size={200} className={s.muted}>
          Orbit Web {ORBIT_WEB_VERSION}
        </Text>
      </Card>
    </main>
  );
}
