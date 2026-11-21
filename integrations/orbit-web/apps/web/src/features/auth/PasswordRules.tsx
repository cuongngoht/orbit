// THE PASSWORD RULES, shown live as a person types: each rule and whether the password meets it. What is wrong is the
// contract's own `passwordProblems` (the API holds the password to the very same function), so the page never keeps a
// second list of what a password must be -- it only says each problem as a rule a person can read before typing.
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { CheckmarkCircle16Regular, Circle16Regular, DismissCircle16Regular } from "@fluentui/react-icons";
import { IDENTITY_LIMITS, passwordProblems } from "@orbit-web/contracts";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: "4px", listStyleType: "none", margin: 0, paddingLeft: 0 },
  item: { display: "flex", alignItems: "center", gap: "6px", color: tokens.colorNeutralForeground2 },
  met: { color: tokens.colorPaletteGreenForeground1 },
  unmet: { color: tokens.colorPaletteRedForeground1 },
  srOnly: { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" },
});

interface Rule {
  text: string;
  // Which of passwordProblems' sentences this rule is.
  is: (problem: string) => boolean;
}

const RULES: Rule[] = [
  { text: `At least ${IDENTITY_LIMITS.passwordMin} characters`, is: (p) => p.includes("at least") || p.includes("at most") || p.includes("must be text") },
  { text: "Does not contain the username", is: (p) => p.includes("username") },
  { text: "Not one or two characters repeated", is: (p) => p.includes("repeat") },
  { text: "Not a keyboard or number sequence (such as 123456)", is: (p) => p.includes("sequence") },
  { text: "Not one of the commonest passwords", is: (p) => p.includes("commonest") },
];

// The problems of a password, as the contract says them (empty: acceptable). Nothing typed yet is no problem to show.
export function problemsOf(password: string, username: string | null): string[] {
  return password.length === 0 ? [] : passwordProblems(password, username && username.length > 0 ? username : null);
}

export function PasswordRules({ password, username }: { password: string; username: string | null }) {
  const s = useStyles();
  const problems = problemsOf(password, username);
  const typed = password.length > 0;
  // A problem no rule names (the contract learned a new one) is still said, as it is.
  const unnamed = problems.filter((p) => !RULES.some((r) => r.is(p)));
  return (
    <ul className={s.list} aria-label="Password rules">
      {RULES.map((r) => {
        const met = typed && !problems.some(r.is);
        const state = !typed ? "not checked yet" : met ? "met" : "not met";
        return (
          <li key={r.text} className={mergeClasses(s.item, typed && (met ? s.met : s.unmet))}>
            {!typed ? <Circle16Regular aria-hidden /> : met ? <CheckmarkCircle16Regular aria-hidden /> : <DismissCircle16Regular aria-hidden />}
            <Text size={200}>{r.text}</Text>
            <span className={s.srOnly}> — {state}</span>
          </li>
        );
      })}
      {unnamed.map((p) => (
        <li key={p} className={mergeClasses(s.item, s.unmet)}>
          <DismissCircle16Regular aria-hidden />
          <Text size={200}>{p}</Text>
          <span className={s.srOnly}> — not met</span>
        </li>
      ))}
    </ul>
  );
}
