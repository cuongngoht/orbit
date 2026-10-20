import { createContext, useContext } from "react";
import { webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";
import { useMediaQuery } from "../shared/hooks/useMediaQuery";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const STORAGE_KEY = "orbit.control.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function storedChoice(): ThemeChoice {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return THEME_CHOICES.some((c) => c.value === saved) ? (saved as ThemeChoice) : "system";
}

export const storeChoice = (choice: ThemeChoice) => window.localStorage.setItem(STORAGE_KEY, choice);

// Follows the OS live: switching the system to dark while the page is open
// switches the page too, when the choice is "system".
export const useSystemPrefersDark = () => useMediaQuery(DARK_QUERY);

export const isDark = (choice: ThemeChoice, systemDark: boolean) => choice === "dark" || (choice === "system" && systemDark);

export const themeFor = (dark: boolean): Theme => (dark ? webDarkTheme : webLightTheme);

export const ThemeChoiceContext = createContext<{ choice: ThemeChoice; setChoice: (choice: ThemeChoice) => void }>({
  choice: "system",
  setChoice: () => {},
});

export const useThemeChoice = () => useContext(ThemeChoiceContext);
