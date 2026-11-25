// THE PASSWORD RULES, shown live as a person types: each rule and whether the password meets it. What is wrong is the
// contract's own `passwordProblems` (the API holds the password to the very same function), so the page never keeps a
// second list of what a password must be -- it only says each problem as a rule a person can read before typing.
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { CheckmarkCircle16Regular, Circle16Regular, DismissCircle16Regular } from "@fluentui/react-icons";
import { IDENTITY_LIMITS, passwordProblems } from "@orbit-web/contracts";
import { useI18n, type MessageKey, type MessageVars } from "../../i18n";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: "4px", listStyleType: "none", margin: 0, paddingLeft: 0 },
  item: { display: "flex", alignItems: "center", gap: "6px", color: tokens.colorNeutralForeground2 },
  met: { color: tokens.colorPaletteGreenForeground1 },
  unmet: { color: tokens.colorPaletteRedForeground1 },
  srOnly: { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" },
});

interface Rule {
  key: MessageKey;
  vars?: MessageVars;
  // Which of passwordProblems' sentences this rule is.
  is: (problem: string) => boolean;
}

const RULES: Rule[] = [
  { key: "settings.auth.ruleMinChars", vars: { min: IDENTITY_LIMITS.passwordMin }, is: (p) => p.includes("at least") || p.includes("at most") || p.includes("must be text") },
  { key: "settings.auth.ruleNoUsername", is: (p) => p.includes("username") },
  { key: "settings.auth.ruleNoRepeat", is: (p) => p.includes("repeat") },
  { key: "settings.auth.ruleNoSequence", is: (p) => p.includes("sequence") },
  { key: "settings.auth.ruleNoCommon", is: (p) => p.includes("commonest") },
];

// The problems of a password, as the contract says them (empty: acceptable). Nothing typed yet is no problem to show.
export function problemsOf(password: string, username: string | null): string[] {
  return password.length === 0 ? [] : passwordProblems(password, username && username.length > 0 ? username : null);
}

export function PasswordRules({ password, username }: { password: string; username: string | null }) {
  const { t } = useI18n();
  const s = useStyles();
  const problems = problemsOf(password, username);
  const typed = password.length > 0;
  // A problem no rule names (the contract learned a new one) is still said, as it is.
  const unnamed = problems.filter((p) => !RULES.some((r) => r.is(p)));
  return (
    <ul className={s.list} aria-label={t("settings.auth.passwordRules")}>
      {RULES.map((r) => {
        const met = typed && !problems.some(r.is);
        const state = !typed ? t("settings.auth.ruleNotCheckedYet") : met ? t("settings.auth.ruleMet") : t("settings.auth.ruleNotMet");
        return (
          <li key={r.key} className={mergeClasses(s.item, typed && (met ? s.met : s.unmet))}>
            {!typed ? <Circle16Regular aria-hidden /> : met ? <CheckmarkCircle16Regular aria-hidden /> : <DismissCircle16Regular aria-hidden />}
            <Text size={200}>{t(r.key, r.vars)}</Text>
            <span className={s.srOnly}> — {state}</span>
          </li>
        );
      })}
      {unnamed.map((p) => (
        <li key={p} className={mergeClasses(s.item, s.unmet)}>
          <DismissCircle16Regular aria-hidden />
          <Text size={200}>{p}</Text>
          <span className={s.srOnly}> — {t("settings.auth.ruleNotMet")}</span>
        </li>
      ))}
    </ul>
  );
}
