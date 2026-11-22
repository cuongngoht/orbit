// NINTENDO-STYLE CHIBI VIRTUAL DESK & CHARACTER PRESENCE: expressive cartoon AI teammates, partitioned desk vignettes,
// animated working/loading displays, and floating thought bubbles showing what a colleague is thinking through.
import { tokens } from "@fluentui/react-components";
import type { WorkLabel } from "@orbit-web/contracts";
import { useId, type CSSProperties } from "react";

export interface PersonaPalette {
  shirt: string;
  shirtShade: string;
  shirtTrim: string;
  hair: string;
  skin: string;
  skinShade: string;
  mug: string;
  hairStyle: 0 | 1 | 2 | 3;
  accessory: 0 | 1 | 2;
  initials: string;
}

const SHIRTS = [
  { shirt: "#5b58d4", shirtShade: "#3f3ca8", shirtTrim: "#a2a0ec", mug: "#fb7185" },
  { shirt: "#0f9488", shirtShade: "#0d6e66", shirtTrim: "#5eead4", mug: "#f59e0b" },
  { shirt: "#9333ea", shirtShade: "#6b21a8", shirtTrim: "#d8b4fe", mug: "#14b8a6" },
  { shirt: "#ea580c", shirtShade: "#b43f09", shirtTrim: "#fdba74", mug: "#5b58d4" },
  { shirt: "#2563eb", shirtShade: "#1d4ed8", shirtTrim: "#93c5fd", mug: "#f43f5e" },
  { shirt: "#16a34a", shirtShade: "#15803d", shirtTrim: "#86efac", mug: "#f59e0b" },
] as const;

const HAIRS = ["#2f231e", "#523523", "#1e2636", "#7a4928", "#42324a", "#1e1d1b"] as const;

const SKINS = [
  { skin: "#ffd8bc", skinShade: "#f0b992" },
  { skin: "#f7c7a3", skinShade: "#dfa279" },
  { skin: "#e7ac82", skinShade: "#c88960" },
  { skin: "#ffe0cb", skinShade: "#eec2a4" },
] as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function hashOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function personaFor(name: string): PersonaPalette {
  const h = hashOf(name || "Orbit");
  const s = SHIRTS[h % SHIRTS.length]!;
  const sk = SKINS[(h >>> 4) % SKINS.length]!;
  return {
    shirt: s.shirt,
    shirtShade: s.shirtShade,
    shirtTrim: s.shirtTrim,
    mug: s.mug,
    hair: HAIRS[(h >>> 8) % HAIRS.length]!,
    skin: sk.skin,
    skinShade: sk.skinShade,
    hairStyle: ((h >>> 12) % 4) as 0 | 1 | 2 | 3,
    accessory: ((h >>> 15) % 3) as 0 | 1 | 2,
    initials: initialsOf(name),
  };
}

export type DeskPresenceKind = "working" | "ready" | "waiting" | "paused" | "offline";

export function presenceKindOf(label: WorkLabel): DeskPresenceKind {
  if (label === "working") return "working";
  if (label === "ready") return "ready";
  if (label === "not_ready") return "offline";
  if (label === "paused") return "paused";
  return "waiting";
}

export function presenceStatusColor(label: WorkLabel): string {
  const kind = presenceKindOf(label);
  if (kind === "working") return tokens.colorBrandForeground1;
  if (kind === "ready") return tokens.colorPaletteGreenForeground1;
  if (kind === "offline") return tokens.colorPaletteRedForeground1;
  if (kind === "paused") return tokens.colorNeutralForeground3;
  return tokens.colorPaletteDarkOrangeForeground1;
}

export function deskMoodText(label: WorkLabel): string {
  switch (label) {
    case "working":
      return "Focused at desk";
    case "ready":
      return "Available at desk";
    case "waiting_review":
      return "Waiting for your review";
    case "waiting_info":
      return "Needs your input";
    case "waiting_resources":
      return "Needs desk resources";
    case "waiting_team":
      return "Syncing with teammates";
    case "paused":
      return "Stepped away · paused";
    case "cancelling":
      return "Wrapping up task";
    case "reconciling":
      return "Checking desk state";
    case "not_ready":
      return "Desk offline";
  }
}

export function deskShortCue(label: WorkLabel): string {
  switch (label) {
    case "working":
      return "At work";
    case "ready":
      return "At desk";
    case "waiting_review":
      return "Needs you";
    case "waiting_info":
      return "Has question";
    case "waiting_resources":
      return "Queued desk";
    case "waiting_team":
      return "With team";
    case "paused":
      return "Away";
    case "cancelling":
      return "Wrapping up";
    case "reconciling":
      return "Syncing";
    case "not_ready":
      return "Offline";
  }
}

interface LampPalette {
  glow: string;
  screenBg: string;
  screenAccent: string;
  led: string;
}

const LAMP_PALETTES: Record<DeskPresenceKind, LampPalette> = {
  working: { glow: "#5b58d4", screenBg: "#181a36", screenAccent: "#8f8de7", led: "#7d7ae1" },
  ready: { glow: "#10b981", screenBg: "#132922", screenAccent: "#34d399", led: "#10b981" },
  waiting: { glow: "#f59e0b", screenBg: "#2c2112", screenAccent: "#fbbf24", led: "#f59e0b" },
  paused: { glow: "#8a867d", screenBg: "#252421", screenAccent: "#9a968c", led: "#9a968c" },
  offline: { glow: "#ef4444", screenBg: "#2b1719", screenAccent: "#f87171", led: "#ef4444" },
};

function ChibiHairBack({ style, fill }: { style: 0 | 1 | 2 | 3; fill: string }) {
  if (style === 2) {
    return <path d="M87 38 C87 19 100 12 114 12 C128 12 141 19 141 38 L142 57 C137 59 131 58 128 54 L100 54 C97 58 91 59 86 57 Z" fill={fill} />;
  }
  if (style === 3) {
    return (
      <g fill={fill}>
        <circle cx="95" cy="23" r="10.5" />
        <circle cx="114" cy="17" r="11.5" />
        <circle cx="133" cy="23" r="10.5" />
        <circle cx="91" cy="36" r="8" />
        <circle cx="137" cy="36" r="8" />
      </g>
    );
  }
  return null;
}

function ChibiHairFront({ style, fill }: { style: 0 | 1 | 2 | 3; fill: string }) {
  if (style === 0) {
    return <path d="M94 34 C94 18 103 13 114 13 C125 13 134 18 134 34 C129 25 122 23 116 27 C110 23 101 25 94 34 Z" fill={fill} />;
  }
  if (style === 1) {
    return <path d="M93 36 C93 19 102 13 115 13 C127 13 135 20 134 35 C129 27 121 23 111 26 C103 28 97 31 93 36 Z" fill={fill} />;
  }
  if (style === 2) {
    return <path d="M93 34 C94 18 103 13 114 13 C125 13 134 18 135 34 C128 24 119 23 114 27 C107 23 100 25 93 34 Z" fill={fill} />;
  }
  return <path d="M94 30 C96 20 105 16 114 16 C123 16 132 20 134 30 C127 25 119 24 114 26 C108 24 100 25 94 30 Z" fill={fill} />;
}

function ChibiHeadAndTorso({
  p,
  kind,
  fullBody = false,
}: {
  p: PersonaPalette;
  kind: DeskPresenceKind;
  fullBody?: boolean;
}) {
  const animStyle: CSSProperties | undefined =
    kind === "working"
      ? { animationName: "orbit-chibi-bob", animationDuration: "0.9s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }
      : kind === "waiting"
        ? { animationName: "orbit-chibi-wave", animationDuration: "2.2s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out", transformOrigin: "114px 66px" }
        : undefined;

  return (
    <g style={animStyle}>
      <ChibiHairBack style={p.hairStyle} fill={p.hair} />

      {/* Full body legs when standing/walking on the office floor */}
      {fullBody && (
        <g>
          <rect x="103" y="75" width="7.5" height="12" rx="3.5" fill="#334155" />
          <rect x="117.5" y="75" width="7.5" height="12" rx="3.5" fill="#334155" />
          <ellipse cx="106.5" cy="87.5" rx="5.5" ry="3.2" fill="#1e293b" />
          <ellipse cx="121.5" cy="87.5" rx="5.5" ry="3.2" fill="#1e293b" />
        </g>
      )}

      {/* Chibi sweater / hoodie torso */}
      <path d="M90 77 C91 58 99 52 114 52 C129 52 137 58 138 77 Z" fill={p.shirt} />
      <path d="M104 52 L114 61 L124 52 C120 51 108 51 104 52 Z" fill={p.shirtShade} />
      {/* Cute hoodie drawstring/collar highlight */}
      <circle cx="110.5" cy="63" r="1.3" fill={p.shirtTrim} />
      <circle cx="117.5" cy="63" r="1.3" fill={p.shirtTrim} />

      {/* Chibi hands (waving when waiting, typing/resting otherwise) */}
      {kind === "waiting" ? (
        <g>
          <path d="M91 64 C84 59 83 51 87 48" stroke={p.shirt} strokeWidth="6.5" strokeLinecap="round" fill="none" />
          <circle cx="87" cy="46.5" r="4.2" fill={p.skin} />
          <circle cx="136" cy="70" r="4.2" fill={p.skin} />
        </g>
      ) : (
        <g>
          <circle cx="96" cy="72" r="4.2" fill={p.skin} />
          <circle cx="132" cy="72" r="4.2" fill={p.skin} />
        </g>
      )}

      {/* Round chibi neck & ears */}
      <rect x="109.5" y="47" width="9" height="8" rx="4" fill={p.skinShade} />
      <circle cx="94" cy="36.5" r="4.2" fill={p.skinShade} />
      <circle cx="134" cy="36.5" r="4.2" fill={p.skinShade} />

      {/* Big rounded Nintendo-style head */}
      <rect x="95" y="17" width="38" height="34" rx="17.5" fill={p.skin} />

      {/* Rosy Nintendo cheeks */}
      <ellipse cx="102.5" cy="40.5" rx="3.4" ry="2.1" fill="#f472b6" opacity="0.34" />
      <ellipse cx="125.5" cy="40.5" rx="3.4" ry="2.1" fill="#f472b6" opacity="0.34" />

      {/* Expressive eyes with crisp catchlights */}
      {kind === "paused" ? (
        <g stroke="#231f20" strokeWidth="1.7" strokeLinecap="round" fill="none">
          <path d="M104.5 35.5 Q107 38 109.5 35.5" />
          <path d="M118.5 35.5 Q121 38 123.5 35.5" />
        </g>
      ) : (
        <g>
          <circle cx="107" cy="35.5" r="2.4" fill="#1e1b24" />
          <circle cx="106.2" cy="34.7" r="0.85" fill="#ffffff" />
          <circle cx="121" cy="35.5" r="2.4" fill="#1e1b24" />
          <circle cx="120.2" cy="34.7" r="0.85" fill="#ffffff" />
        </g>
      )}

      {/* Cheerful / focused expression */}
      {kind === "working" ? (
        <ellipse cx="114" cy="42.2" rx="2.1" ry="1.6" fill="#9a4e3f" />
      ) : kind === "offline" ? (
        <path d="M110.5 43 Q114 40.5 117.5 43" fill="none" stroke="#8a5a44" strokeWidth="1.45" strokeLinecap="round" />
      ) : (
        <path d="M110 41.2 Q114 44.8 118 41.2" fill="none" stroke="#8a5a44" strokeWidth="1.5" strokeLinecap="round" />
      )}

      {/* Hair front bangs */}
      <ChibiHairFront style={p.hairStyle} fill={p.hair} />

      {/* Cute round glasses or slim headset */}
      {p.accessory === 1 && (
        <g stroke="#2b2833" strokeWidth="1.35" fill="none" opacity="0.88">
          <circle cx="107" cy="35.5" r="4.6" />
          <circle cx="121" cy="35.5" r="4.6" />
          <path d="M111.6 35.5 H116.4" />
        </g>
      )}
      {p.accessory === 2 && (
        <g>
          <path d="M93.5 35 C93.5 19.5 102.5 13 114 13 C125.5 13 134.5 19.5 134.5 35" fill="none" stroke="#363544" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="90.5" y="32.5" width="4.5" height="8" rx="2.2" fill="#363544" />
          <rect x="133" y="32.5" width="4.5" height="8" rx="2.2" fill="#363544" />
          <path d="M93 39.5 Q97 44 105 44.5" fill="none" stroke="#363544" strokeWidth="1.35" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

export function ChibiAvatarSvg({ name, workLabel, size = 54 }: { name: string; workLabel: WorkLabel; size?: number }) {
  const p = personaFor(name);
  const kind = presenceKindOf(workLabel);
  return (
    <svg width={size} height={size} viewBox="80 10 68 82" fill="none" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <ellipse cx="114" cy="88.5" rx="18" ry="3.5" fill="currentColor" opacity="0.14" />
      <ChibiHeadAndTorso p={p} kind={kind} fullBody />
    </svg>
  );
}

function ScreenDisplay({ kind, lamp }: { kind: DeskPresenceKind; lamp: LampPalette }) {
  return (
    <g>
      {/* Monitor body */}
      <rect x="150" y="30" width="56" height="37" rx="5" fill="#2a2926" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.2" />
      <rect x="153" y="33" width="50" height="30" rx="3" fill={lamp.screenBg} />
      {kind === "working" && (
        <g>
          <rect x="158" y="38.5" width="24" height="3" rx="1.5" fill={lamp.screenAccent} opacity="0.95" />
          <rect x="158" y="44" width="34" height="2.5" rx="1.25" fill={lamp.screenAccent} opacity="0.6" />
          <rect x="158" y="49" width="25" height="2.5" rx="1.25" fill={lamp.screenAccent} opacity="0.45" />
          {/* Animated loading bar track + sweep */}
          <rect x="158" y="55" width="40" height="3.2" rx="1.6" fill={lamp.screenAccent} opacity="0.2" />
          <rect
            x="166"
            y="55"
            width="16"
            height="3.2"
            rx="1.6"
            fill={lamp.screenAccent}
            style={{ animationName: "orbit-load-bar", animationDuration: "1.6s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }}
          />
          <circle
            cx="195"
            cy="40"
            r="3"
            stroke={lamp.led}
            strokeWidth="1.4"
            strokeDasharray="10 5"
            fill="none"
            style={{ transformOrigin: "195px 40px", animationName: "orbit-spin", animationDuration: "1.1s", animationIterationCount: "infinite", animationTimingFunction: "linear" }}
          />
        </g>
      )}
      {kind === "ready" && (
        <g>
          <circle cx="178" cy="48" r="7.5" fill={lamp.screenAccent} opacity="0.2" />
          <path d="M174.2 48.2 L177 50.8 L182.2 45.4" fill="none" stroke={lamp.screenAccent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {kind === "waiting" && (
        <g>
          <rect x="165" y="41" width="26" height="14" rx="3" fill={lamp.screenAccent} opacity="0.22" stroke={lamp.screenAccent} strokeWidth="1.4" />
          <path d="M166.5 43 L178 50 L189.5 43" fill="none" stroke={lamp.screenAccent} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="192" cy="40" r="2.8" fill={lamp.led} style={{ animationName: "orbit-pulse", animationDuration: "1.4s", animationIterationCount: "infinite" }} />
        </g>
      )}
      {kind === "paused" && (
        <g fill={lamp.screenAccent} opacity="0.75">
          <rect x="173" y="43" width="3.2" height="11" rx="1.4" />
          <rect x="179.5" y="43" width="3.2" height="11" rx="1.4" />
        </g>
      )}
      {kind === "offline" && (
        <g stroke={lamp.screenAccent} strokeWidth="1.9" strokeLinecap="round">
          <path d="M174 44 L182 52" />
          <path d="M182 44 L174 52" />
        </g>
      )}
      {/* Stand neck & foot */}
      <rect x="175" y="67" width="6" height="6.5" fill="#44423c" />
      <rect x="167" y="72.5" width="22" height="2.6" rx="1.3" fill="#44423c" />
    </g>
  );
}

const trimThought = (text: string, max = 26): string => {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

export function EmployeeDeskScene({
  name,
  workLabel,
  holdingTitle = null,
  compact = false,
}: {
  name: string;
  workLabel: WorkLabel;
  holdingTitle?: string | null;
  compact?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const p = personaFor(name);
  const kind = presenceKindOf(workLabel);
  const lamp = LAMP_PALETTES[kind];
  const haloId = `orbit-desk-halo-${uid}`;
  const deskId = `orbit-desk-top-${uid}`;

  if (compact) {
    return (
      <svg
        width="104"
        height="68"
        viewBox="64 10 150 84"
        fill="none"
        aria-hidden="true"
        style={{ display: "block", flexShrink: 0, color: tokens.colorNeutralForeground3 }}
      >
        <defs>
          <radialGradient id={haloId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={lamp.glow} stopOpacity="0.28" />
            <stop offset="100%" stopColor={lamp.glow} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="152" cy="48" r="38" fill={`url(#${haloId})`} />
        <rect x="91" y="26" width="46" height="46" rx="14" fill="currentColor" opacity="0.14" />
        <ChibiHeadAndTorso p={p} kind={kind} />
        <rect x="70" y="74" width="140" height="8" rx="3.5" fill={tokens.colorNeutralStroke1} />
        <rect x="70" y="74" width="140" height="2.5" rx="1.25" fill={tokens.colorNeutralStroke2} />
        <ScreenDisplay kind={kind} lamp={lamp} />
        <circle
          cx="81"
          cy="69.5"
          r="3.2"
          fill={lamp.led}
          style={kind === "working" ? { animationName: "orbit-pulse", animationDuration: "1.5s", animationIterationCount: "infinite" } : undefined}
        />
        <rect x="77" y="72.5" width="8" height="2" rx="1" fill="currentColor" opacity="0.45" />
      </svg>
    );
  }

  const showThought = holdingTitle !== null && holdingTitle.trim() !== "" && (kind === "working" || kind === "waiting");

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: "260px", marginLeft: "auto", marginRight: "auto" }} aria-hidden="true">
      {showThought && (
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            maxWidth: "100%",
            width: "fit-content",
            marginLeft: "auto",
            marginRight: "auto",
            marginBottom: "2px",
            padding: "3px 10px",
            borderRadius: "9999px",
            backgroundColor: "var(--orbit-card-bg)",
            border: `1px solid ${kind === "working" ? tokens.colorBrandStroke2 : tokens.colorPaletteMarigoldBorder1}`,
            boxShadow: tokens.shadow2,
            animationName: "orbit-thought-float",
            animationDuration: "2.4s",
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-in-out",
          }}
        >
          {kind === "working" ? (
            <span
              style={{
                width: "9px",
                height: "9px",
                borderRadius: "9999px",
                borderWidth: "1.8px",
                borderStyle: "solid",
                borderRightColor: tokens.colorBrandStroke1,
                borderBottomColor: tokens.colorBrandStroke1,
                borderLeftColor: tokens.colorBrandStroke1,
                borderTopColor: "transparent",
                flexShrink: 0,
                animationName: "orbit-spin",
                animationDuration: "0.95s",
                animationIterationCount: "infinite",
                animationTimingFunction: "linear",
              }}
            />
          ) : (
            <span style={{ width: "7px", height: "7px", borderRadius: "9999px", backgroundColor: tokens.colorPaletteDarkOrangeForeground1, flexShrink: 0 }} />
          )}
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              color: tokens.colorNeutralForeground1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {trimThought(holdingTitle, 28)}
          </span>
        </div>
      )}
      <svg
        width="100%"
        height="100"
        viewBox="0 6 248 96"
        fill="none"
        style={{ display: "block", width: "100%", color: tokens.colorNeutralForeground3 }}
      >
        <defs>
          <radialGradient id={haloId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={lamp.glow} stopOpacity="0.28" />
            <stop offset="100%" stopColor={lamp.glow} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={deskId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tokens.colorNeutralStroke2} />
            <stop offset="100%" stopColor={tokens.colorNeutralStroke1} />
          </linearGradient>
        </defs>

        {/* Cubicle partition panel behind desk */}
        <rect x="14" y="10" width="220" height="68" rx="12" fill="currentColor" opacity="0.045" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
        <path d="M26 52 H222" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="3 3" />

        {/* Thought bubble trail dots toward character head */}
        {showThought && (
          <g fill="var(--orbit-card-bg)" stroke={kind === "working" ? tokens.colorBrandStroke2 : tokens.colorPaletteMarigoldBorder1} strokeWidth="0.9">
            <circle cx="114" cy="11" r="2.6" />
            <circle cx="114" cy="17.5" r="1.7" />
          </g>
        )}

        {/* Warm desk presence aura */}
        <circle cx="164" cy="48" r="44" fill={`url(#${haloId})`} />

        {/* Plant on left edge of desk */}
        <g>
          <path d="M35 67 C32 59 35 53 38.5 59.5 C40.5 52 46 53.5 43.5 60.5 C47.5 55.5 50.5 58.5 46.5 67 Z" fill="#10b981" opacity="0.76" />
          <path d="M34 66.5 H47.5 L45.6 75 H36 Z" fill="currentColor" opacity="0.34" />
        </g>

        {/* Chair backrest + seated Nintendo chibi character */}
        <rect x="91" y="25" width="46" height="47" rx="14" fill="currentColor" opacity="0.15" />
        <rect x="95" y="29" width="38" height="40" rx="11" fill="currentColor" opacity="0.11" />
        <ChibiHeadAndTorso p={p} kind={kind} />

        {/* Desk slab */}
        <rect x="18" y="75" width="212" height="10" rx="4" fill={`url(#${deskId})`} />
        <rect x="18" y="75" width="212" height="2.5" rx="1.25" fill={tokens.colorNeutralBackground1} opacity="0.4" />

        {/* Keyboard mat */}
        <rect x="92" y="73.2" width="48" height="2.6" rx="1.3" fill="currentColor" opacity="0.28" />

        {/* Ceramic mug */}
        <rect x="65" y="65.5" width="9.5" height="9" rx="2.5" fill={p.mug} />
        <path d="M74.5 67.8 C77.2 67.8 77.2 72 74.5 72" stroke={p.mug} strokeWidth="1.5" fill="none" />

        {/* Live workstation monitor */}
        <ScreenDisplay kind={kind} lamp={lamp} />

        {/* Desk status lamp */}
        <path d="M54 75 V65 Q54 60.5 58.5 60.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.7" strokeLinecap="round" />
        <circle
          cx="59.5"
          cy="62"
          r="3.2"
          fill={lamp.led}
          style={kind === "working" ? { animationName: "orbit-pulse", animationDuration: "1.5s", animationIterationCount: "infinite" } : undefined}
        />
        <rect x="50" y="73.5" width="8" height="2" rx="1" fill="currentColor" opacity="0.45" />

        {/* Desk nameplate */}
        <rect x="192" y="77.2" width="28" height="5.8" rx="2.9" fill={tokens.colorNeutralBackground1} opacity="0.78" />
        <text x="206" y="81.6" textAnchor="middle" fontSize="4.6" fontWeight="700" fill={tokens.colorNeutralForeground2}>
          {p.initials}
        </text>
      </svg>
    </div>
  );
}

export function EmptyDeskSlot() {
  return (
    <svg width="132" height="52" viewBox="0 0 132 52" fill="none" aria-hidden="true" style={{ display: "block", flexShrink: 0, color: tokens.colorNeutralForeground4 }}>
      <rect x="50" y="10" width="32" height="26" rx="8" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 2" opacity="0.7" />
      <rect x="16" y="36" width="100" height="7" rx="3" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.3" />
      <rect x="82" y="15" width="24" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.3" fill="currentColor" fillOpacity="0.08" />
      <path d="M94 32 V36" stroke="currentColor" strokeWidth="1.4" />
      <path d="M27 36 V31 M25 32 L27 29 L29 32" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
    </svg>
  );
}
