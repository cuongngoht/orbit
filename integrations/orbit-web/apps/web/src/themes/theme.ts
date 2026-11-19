// Light and dark, from Fluent UI's own web themes; "system" follows the operating system's preference.
import { webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";
import type { ThemePreference } from "@orbit-web/contracts";
import { useEffect, useState } from "react";

const DARK = "(prefers-color-scheme: dark)";

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK).matches);
  useEffect(() => {
    const media = window.matchMedia(DARK);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark;
}

export const isDark = (preference: ThemePreference, systemDark: boolean): boolean => preference === "dark" || (preference === "system" && systemDark);

export const themeOf = (dark: boolean): Theme => (dark ? webDarkTheme : webLightTheme);
