// The first page, and the only one before a Claude account is signed in: Orbit Web's sign-in IS the Claude account's,
// and the API refuses everything else until then. One way in -- Continue with Claude -- centred on the app's own
// surface, the way the workspace behind it looks.
import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { ORBIT_WEB_VERSION, type ClaudeStatus } from "@orbit-web/contracts";
import { ClaudeSignIn } from "../features/auth/ClaudeSignIn";

const useStyles = makeStyles({
  page: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "28px",
    paddingTop: "48px",
    paddingRight: "16px",
    paddingBottom: "48px",
    paddingLeft: "16px",
    "@media (max-width: 639px)": { gap: "20px", paddingTop: "20px", paddingBottom: "max(24px, env(safe-area-inset-bottom))" },
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  panel: { width: "100%", maxWidth: "440px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", textAlign: "center" },
  logo: { width: "48px", height: "48px", marginBottom: "6px" },
  heading: { margin: 0, fontSize: "clamp(24px, 6vw, 30px)", lineHeight: "1.25", fontWeight: tokens.fontWeightSemibold, letterSpacing: "-0.01em", color: tokens.colorNeutralForeground1 },
  lead: { color: tokens.colorNeutralForeground2, maxWidth: "400px" },
  card: {
    width: "100%",
    maxWidth: "440px",
    boxSizing: "border-box",
    paddingTop: "24px",
    paddingRight: "24px",
    paddingBottom: "24px",
    paddingLeft: "24px",
    "@media (max-width: 639px)": { paddingTop: "18px", paddingRight: "16px", paddingBottom: "18px", paddingLeft: "16px" },
    borderRadius: "16px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
  },
  foot: { color: tokens.colorNeutralForeground3 },
});

export function SignInPage({ status, onChanged }: { status: ClaudeStatus | null; onChanged: () => void }) {
  const s = useStyles();
  return (
    <main className={s.page}>
      <div className={s.panel}>
        <img src="/orbit.svg" alt="" className={s.logo} />
        <h1 className={s.heading}>Sign in to Orbit Web</h1>
        <Text align="center" className={s.lead}>Your Claude account is Orbit Web's sign-in. Claude Code runs as this account in every chat, and nothing opens until you sign in.</Text>
      </div>
      <section className={s.card} aria-label="Sign in to Orbit Web">
        <ClaudeSignIn status={status} onChanged={onChanged} />
      </section>
      <Text size={200} className={s.foot}>
        Orbit Web {ORBIT_WEB_VERSION}
      </Text>
    </main>
  );
}
