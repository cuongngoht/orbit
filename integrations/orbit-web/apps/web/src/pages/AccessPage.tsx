// Token mode: this Orbit Web answers a host name beyond loopback, so before anything -- the Claude sign-in included -- it
// asks for its access token: the one made when it was deployed, given with the link to it. Two steps, said as two: the
// token here, then Continue with Claude (shown, waiting). An access link (`#access=<token>`) fills and sends it itself.
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ClipboardPaste16Regular, Eye16Regular, EyeOff16Regular } from "@fluentui/react-icons";
import { ORBIT_WEB_VERSION } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { accessLinkToken, forgetAccessLink, onAccessLink } from "../services/accessLink";
import { errorText, send } from "../services/api";

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
  logo: { width: "56px", height: "56px", marginBottom: "4px" },
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
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },
  step: { display: "flex", flexDirection: "column", gap: "10px" },
  stepTitle: { display: "flex", alignItems: "center", gap: "8px" },
  number: { width: "22px", height: "22px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand, flexShrink: 0 },
  numberWaiting: { backgroundColor: tokens.colorNeutralBackground5, color: tokens.colorNeutralForeground3 },
  wide: { width: "100%", "@media (max-width: 639px), (pointer: coarse)": { minHeight: "44px" } },
  muted: { color: tokens.colorNeutralForeground3 },
  foot: { color: tokens.colorNeutralForeground3 },
});

// The token an access link carries (`…#access=<token>`), else the text itself, trimmed.
const tokenIn = (text: string): string => /#access=([A-Za-z0-9._~-]{16,512})/.exec(text)?.[1] ?? text.trim();

export function AccessPage({ onGranted }: { onGranted: () => void }) {
  const s = useStyles();
  const [fromLink] = useState(accessLinkToken);
  const [token, setToken] = useState("");
  const [shown, setShown] = useState(false);
  // The clipboard is read only when asked. It may hold the access link (copied from Settings → Account, or as it was
  // given) or the bare token: the token is taken from either and sent at once, as an opened access link would be.
  const paste = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setError("The clipboard could not be read here: paste into the field instead.");
      return;
    }
    const pasted = tokenIn(text);
    setToken(pasted);
    if (pasted.length > 0) submit(pasted);
  };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(fromLink !== null);
  // Trades a token for the access cookie; what it learns is said once the answer is in.
  const trade = async (value: string) => {
    try {
      await send("POST", "/api/access", { token: value });
      onGranted();
    } catch (err) {
      setError(errorText(err));
    } finally {
      forgetAccessLink();
      setBusy(false);
    }
  };
  const submit = (value: string) => {
    setBusy(true);
    setError(null);
    void trade(value);
  };

  // An access link's token is sent once, as soon as the page is here -- and so is one a link brings while it is open.
  const sent = useRef(false);
  const latest = useRef(submit);
  useEffect(() => {
    latest.current = submit;
  });
  useEffect(() => {
    const stop = onAccessLink((t) => latest.current(t));
    if (!sent.current && fromLink !== null) {
      sent.current = true;
      void trade(fromLink);
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  return (
    <main className={s.page}>
      <div className={s.panel}>
        <img src="/orbit.svg" alt="" className={s.logo} />
        <h1 className={s.heading}>Sign in to Orbit Web</h1>
        <Text align="center" className={s.lead}>
          This Orbit Web is reachable from the internet, so it asks for its access token first. Then you sign in with your Claude account.
        </Text>
      </div>
      <section className={s.card} aria-label="Sign in to Orbit Web">
        <form
          className={s.step}
          onSubmit={(e) => {
            e.preventDefault();
            submit(token);
          }}
        >
          <div className={s.stepTitle}>
            <span className={s.number}>1</span>
            <Text weight="semibold">Enter this Orbit Web's access token</Text>
          </div>
          <Field label="Access token" hint="The token you were given with the link to this Orbit Web (made when it was deployed). Copied the access link? Paste takes it and goes on — and an opened link ending in #access=… needs nothing at all.">
            <Input
              type={shown ? "text" : "password"}
              value={token}
              onChange={(_, d) => setToken(d.value)}
              autoComplete="current-password"
              autoFocus
              contentAfter={
                <>
                  <Button appearance="transparent" size="small" icon={shown ? <EyeOff16Regular /> : <Eye16Regular />} aria-label={shown ? "Hide the token" : "Show the token"} onClick={() => setShown(!shown)} />
                  <Button appearance="transparent" size="small" icon={<ClipboardPaste16Regular />} onClick={() => void paste()}>
                    Paste
                  </Button>
                </>
              }
            />
          </Field>
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          {busy ? (
            <Spinner size="tiny" label="Checking the access token…" />
          ) : (
            <Button className={s.wide} appearance="primary" type="submit" disabled={token.length === 0}>
              Continue
            </Button>
          )}
        </form>
        <div className={s.step} aria-label="Next: sign in with Claude">
          <div className={s.stepTitle}>
            <span className={`${s.number} ${s.numberWaiting}`}>2</span>
            <Text weight="semibold" className={s.muted}>
              Sign in with your Claude account
            </Text>
          </div>
          <Button className={s.wide} appearance="secondary" disabled>
            Continue with Claude
          </Button>
          <Text size={200} className={s.muted}>
            Opens once the access token is accepted: a link to sign in with Claude, and a code to paste back.
          </Text>
        </div>
      </section>
      <Text size={200} className={s.foot}>
        Orbit Web {ORBIT_WEB_VERSION}
      </Text>
    </main>
  );
}
