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
  colorNeutralBackground1: "#fcfbf9",
  colorNeutralBackground2: "#f5f4ef",
  colorNeutralBackground3: "#eceae3",
  colorNeutralBackground1Hover: "#f4f2ec",
  colorSubtleBackgroundHover: "#ebe9e2",
  colorSubtleBackgroundPressed: "#e2dfd7",
  colorSubtleBackgroundSelected: "#e7e4dc",
  colorNeutralStroke1: "#dedbd2",
  colorNeutralStroke1Hover: "#ccc8bd",
  colorNeutralStroke1Pressed: "#b6b1a5",
  colorNeutralStroke2: "#eae7df",
  colorNeutralForeground1: "#1f1e1b",
  colorNeutralForeground2: "#525049",
  colorNeutralForeground3: "#76736a",
  colorNeutralForeground4: "#9a968c",
};

const dark: Theme = {
  ...createDarkTheme(ORBIT_BRAND),
  colorBrandForeground1: ORBIT_BRAND[120],
  colorBrandForegroundLink: ORBIT_BRAND[130],
  colorNeutralBackground1: "#1c1b19",
  colorNeutralBackground2: "#23221f",
  colorNeutralBackground3: "#2c2b27",
  colorNeutralBackground1Hover: "#282724",
  colorSubtleBackgroundHover: "#2e2d29",
  colorSubtleBackgroundPressed: "#363530",
  colorSubtleBackgroundSelected: "#35342f",
  colorNeutralStroke1: "#3e3c36",
  colorNeutralStroke1Hover: "#4e4c45",
  colorNeutralStroke1Pressed: "#615e56",
  colorNeutralStroke2: "#2e2d28",
  colorNeutralForeground1: "#efede8",
  colorNeutralForeground2: "#c5c2b9",
  colorNeutralForeground3: "#969288",
  colorNeutralForeground4: "#716e66",
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
