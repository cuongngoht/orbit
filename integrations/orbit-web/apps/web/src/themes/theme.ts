// Light and dark, built on Fluent UI's own themes with Orbit's indigo as the brand colour and warm, quiet surfaces;
// "system" follows the operating system's preference.
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";
import type { ThemePreference } from "@orbit-web/contracts";
import { useEffect, useState } from "react";

const DARK = "(prefers-color-scheme: dark)";

// Orbit's brand ramp (10 darkest .. 160 lightest), around the indigo of its mark.
export const ORBIT_BRAND: BrandVariants = {
  10: "#05051a",
  20: "#13123a",
  30: "#1c1a55",
  40: "#24216e",
  50: "#2d2a87",
  60: "#3633a0",
  70: "#403db8",
  80: "#4b48c9",
  90: "#5b58d4",
  100: "#6c69db",
  110: "#7d7ae1",
  120: "#8f8de7",
  130: "#a2a0ec",
  140: "#b5b4f1",
  150: "#c9c8f6",
  160: "#dddcfa",
};

const light: Theme = {
  ...createLightTheme(ORBIT_BRAND),
  colorNeutralBackground1: "#ffffff",
  colorNeutralBackground2: "#f7f6f3",
  colorNeutralBackground3: "#efede8",
  colorNeutralBackground1Hover: "#f4f3ef",
  colorSubtleBackgroundHover: "#ecebe6",
  colorSubtleBackgroundPressed: "#e3e1db",
  colorSubtleBackgroundSelected: "#e8e6e0",
  colorNeutralStroke2: "#e6e4de",
};

const dark: Theme = {
  ...createDarkTheme(ORBIT_BRAND),
  colorBrandForeground1: ORBIT_BRAND[120],
  colorBrandForegroundLink: ORBIT_BRAND[130],
  colorNeutralBackground1: "#1f1e1d",
  colorNeutralBackground2: "#262624",
  colorNeutralBackground3: "#2e2d2b",
  colorSubtleBackgroundHover: "#33322f",
  colorSubtleBackgroundSelected: "#3a3936",
  colorNeutralStroke2: "#3a3936",
};

export function useSystemDark(): boolean {
  const [isDarkNow, setDark] = useState(() => window.matchMedia(DARK).matches);
  useEffect(() => {
    const media = window.matchMedia(DARK);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isDarkNow;
}

export const isDark = (preference: ThemePreference, systemDark: boolean): boolean => preference === "dark" || (preference === "system" && systemDark);

export const themeOf = (wantDark: boolean): Theme => (wantDark ? dark : light);
