// Shared duotone icon system and semantic icon badges across Office, Governance, and Sidebar.
// Every icon is crisp on a 20x20 pixel grid with currentColor strokes and subtle duotone fill accents,
// paired with light/dark-safe Fluent semantic tokens.
import { makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";

export type IconTone = "brand" | "teal" | "success" | "warning" | "danger" | "neutral";

interface IconProps {
  size?: number;
  active?: boolean;
}

const useStyles = makeStyles({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ...shorthands.border("1px", "solid", "transparent"),
  },
  sm: { width: "24px", height: "24px", borderRadius: "7px" },
  md: { width: "32px", height: "32px", borderRadius: "10px" },
  lg: { width: "44px", height: "44px", borderRadius: "13px" },
  brand: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    ...shorthands.borderColor(tokens.colorBrandStroke2),
  },
  teal: {
    backgroundColor: tokens.colorPaletteTealBackground2,
    color: tokens.colorPaletteTealForeground2,
    ...shorthands.borderColor(tokens.colorPaletteTealBorderActive),
  },
  success: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    color: tokens.colorPaletteGreenForeground1,
    ...shorthands.borderColor(tokens.colorPaletteGreenBorder1),
  },
  warning: {
    backgroundColor: tokens.colorPaletteMarigoldBackground1,
    color: tokens.colorPaletteDarkOrangeForeground1,
    ...shorthands.borderColor(tokens.colorPaletteMarigoldBorder1),
  },
  danger: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
    ...shorthands.borderColor(tokens.colorPaletteRedBorder1),
  },
  neutral: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    ...shorthands.borderColor(tokens.colorNeutralStroke2),
  },
});

const TONE_FG: Record<IconTone, string> = {
  brand: tokens.colorBrandForeground1,
  teal: tokens.colorPaletteTealForeground2,
  success: tokens.colorPaletteGreenForeground1,
  warning: tokens.colorPaletteDarkOrangeForeground1,
  danger: tokens.colorPaletteRedForeground1,
  neutral: tokens.colorNeutralForeground2,
};

export const toneColor = (tone: IconTone): string => TONE_FG[tone];

export function IconBadge({ icon, tone = "brand", size = "md" }: { icon: ReactNode; tone?: IconTone; size?: "sm" | "md" | "lg" }) {
  const s = useStyles();
  return (
    <span className={mergeClasses(s.badge, s[size], s[tone])} aria-hidden>
      {icon}
    </span>
  );
}

const op = (active?: boolean) => (active ? 0.24 : 0.14);

export function OfficeIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 16.5V5.5C3.5 4.67 4.17 4 5 4H10.5C11.33 4 12 4.67 12 5.5V16.5H3.5Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 8.5H15C15.83 8.5 16.5 9.17 16.5 10V16.5H12" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M2.25 16.5H17.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.25 7.25H9.25M6.25 10.25H9.25M7.75 16.5V13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function GovernanceIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.75L16 5.25V9.8C16 13.55 13.45 16.35 10 17.45C6.55 16.35 4 13.55 4 9.8V5.25L10 2.75Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="10" cy="8.75" r="1.6" fill="currentColor" />
      <path d="M10 10.25V12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function OverviewIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="6" height="6" rx="1.6" fill="currentColor" fillOpacity={op(active) + 0.08} stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="3" width="6" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="11" width="6" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="11" width="6" height="6" rx="1.6" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function PolicyIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 3.25H11.75L15.25 6.75V15.5C15.25 16.19 14.69 16.75 14 16.75H5C4.31 16.75 3.75 16.19 3.75 15.5V4.5C3.75 3.81 4.31 3.25 5 3.25Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11.5 3.5V7H15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.75 10.25H12.25M6.75 13H10.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function WorkspacesIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 3.75H15.5C16.47 3.75 17.25 4.53 17.25 5.5V12.75C17.25 13.72 16.47 14.5 15.5 14.5H8L4.25 17.25V14.5C3.42 14.37 2.75 13.64 2.75 12.75V5.5C2.75 4.53 3.53 3.75 4.5 3.75Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6.75 7.75L8.75 9.25L6.75 10.75M10.25 10.75H13.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ResearchIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 4.5C3 3.95 3.45 3.5 4 3.5H8.5C9.33 3.5 10 4.17 10 5V16C10 15.17 9.33 14.5 8.5 14.5H4C3.45 14.5 3 14.05 3 13.5V4.5Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M17 4.5C17 3.95 16.55 3.5 16 3.5H11.5C10.67 3.5 10 4.17 10 5V16C10 15.17 10.67 14.5 11.5 14.5H16C16.55 14.5 17 14.05 17 13.5V4.5Z" fill="currentColor" fillOpacity={op(active) * 0.6} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function DesksIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3.5" width="14" height="9.5" rx="1.8" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 16.5H12.5M10 13V16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ApprovalsIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 10.25L9 12.25L13.25 7.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DecisionsIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3.25V16.75M6.5 16.75H13.5M4.5 6.25H15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.5 6.5L2.75 11.25H6.25L4.5 6.5Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M15.5 6.5L13.75 11.25H17.25L15.5 6.5Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function AuditChainIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.75" y="7" width="6.75" height="6" rx="3" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <rect x="10.5" y="7" width="6.75" height="6" rx="3" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.25 10H11.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FindingsIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M9.12 3.75C9.5 3.08 10.5 3.08 10.88 3.75L16.85 14.25C17.23 14.92 16.75 15.75 15.97 15.75H4.03C3.25 15.75 2.77 14.92 3.15 14.25L9.12 3.75Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 7.75V10.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="13.25" r="0.85" fill="currentColor" />
    </svg>
  );
}

export function ShieldClearIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.75L16 5.25V9.8C16 13.55 13.45 16.35 10 17.45C6.55 16.35 4 13.55 4 9.8V5.25L10 2.75Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.4 10.2L9.2 12L12.8 8.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReportsIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.75" y="3.25" width="12.5" height="13.5" rx="2" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.25 13V10.25M10 13V7.75M12.75 13V9.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function WorkMissionIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="12" height="13" rx="2" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.75 4V3.25C7.75 2.7 8.2 2.25 8.75 2.25H11.25C11.8 2.25 12.25 2.7 12.25 3.25V4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 9.5L8.25 10.75L10.5 8.5M7 13.25H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InboxActionIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 11.25L5.2 4.75C5.38 4.02 6.04 3.5 6.8 3.5H13.2C13.96 3.5 14.62 4.02 14.8 4.75L16.5 11.25V14.75C16.5 15.72 15.72 16.5 14.75 16.5H5.25C4.28 16.5 3.5 15.72 3.5 14.75V11.25Z" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3.75 11.5H7.25L8.35 13.25H11.65L12.75 11.5H16.25" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="10" cy="7.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function ScheduleIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.25" y="4.5" width="13.5" height="12.25" rx="2" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.75 2.75V5.25M13.25 2.75V5.25M3.5 8.25H16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 10.75V12.75L11.5 13.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RosterIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8" cy="7.25" r="2.6" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.25 15.75C3.55 13.3 5.5 11.75 8 11.75C10.5 11.75 12.45 13.3 12.75 15.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13.25 5.25C14.35 5.45 15.15 6.4 15.15 7.55C15.15 8.65 14.4 9.58 13.35 9.82M14.25 12C15.65 12.4 16.65 13.6 16.85 15.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ReadyIcon({ size = 20, active }: IconProps) {
  return <ApprovalsIcon size={size} active={active} />;
}

export function WorkingIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M11.25 2.75L5.25 11H10L8.75 17.25L14.75 9H10L11.25 2.75Z" fill="currentColor" fillOpacity={op(active) + 0.06} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function QueuedIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.25V10.25L12.75 11.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NotReadyIcon({ size = 20, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="currentColor" fillOpacity={op(active)} stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.75V10.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="13.25" r="0.85" fill="currentColor" />
    </svg>
  );
}
