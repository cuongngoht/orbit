// NINTENDO-STYLE CHIBI VIRTUAL DESK & CHARACTER PRESENCE: expressive, genuinely distinct cartoon AI teammates
// (10 hair colors × 6 hairstyles × 8 outfit colors × 4 outfit styles × 5 accessories × 5 skin tones × 3 desk props),
// animated working/loading displays, compact portraits, and floating thought bubbles.
import { tokens } from "@fluentui/react-components";
import type { WorkLabel } from "@orbit-web/contracts";
import { useId, type CSSProperties } from "react";
import { t, type MessageKey } from "../../i18n";
import { AVATAR_HAIRS, AVATAR_SHIRTS, type AvatarAccessory, type AvatarCustomization, type AvatarHairStyle } from "./floorPrefs";

export interface PersonaPalette {
  shirt: string;
  shirtShade: string;
  shirtTrim: string;
  bg: string;
  hair: string;
  hairShade: string;
  skin: string;
  skinShade: string;
  mug: string;
  hairStyle: AvatarHairStyle;
  outfitStyle: 0 | 1 | 2 | 3;
  accessory: AvatarAccessory;
  deskProp: 0 | 1 | 2;
  initials: string;
}

const SKINS = [
  { skin: "#ffe0cb", skinShade: "#eec2a4" },
  { skin: "#ffd8bc", skinShade: "#f0b992" },
  { skin: "#f4c29f", skinShade: "#da9f76" },
  { skin: "#e0a378", skinShade: "#c18357" },
  { skin: "#b87a52", skinShade: "#945d3a" },
] as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mix32(x: number): number {
  let z = (x + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

export function personaFor(name: string, custom?: AvatarCustomization, seed?: string): PersonaPalette {
  const base = hashOf(seed ? `${seed}:${name}` : name || "Orbit");
  const hShirt = mix32(base ^ 0x11a5);
  const hSkin = mix32(base ^ 0x29c3);
  const hHair = mix32(base ^ 0x4b71);
  const hStyle = mix32(base ^ 0x73d9);
  const hOutfit = mix32(base ^ 0x91e7);
  const hAcc = mix32(base ^ 0xb52d);
  const hProp = mix32(base ^ 0xd843);

  const shirtIdx =
    typeof custom?.shirt === "number" && Number.isInteger(custom.shirt) && custom.shirt >= 0 && custom.shirt < AVATAR_SHIRTS.length
      ? custom.shirt
      : hShirt % AVATAR_SHIRTS.length;
  const hairIdx =
    typeof custom?.hair === "number" && Number.isInteger(custom.hair) && custom.hair >= 0 && custom.hair < AVATAR_HAIRS.length
      ? custom.hair
      : hHair % AVATAR_HAIRS.length;
  const hairStyle: AvatarHairStyle =
    custom?.hairStyle !== undefined && custom.hairStyle >= 0 && custom.hairStyle <= 5
      ? custom.hairStyle
      : ((hStyle % 6) as AvatarHairStyle);
  const accessory: AvatarAccessory =
    custom?.accessory !== undefined && custom.accessory >= 0 && custom.accessory <= 4
      ? custom.accessory
      : ((hAcc % 5) as AvatarAccessory);

  const s = AVATAR_SHIRTS[shirtIdx]!;
  const hr = AVATAR_HAIRS[hairIdx]!;
  const sk = SKINS[hSkin % SKINS.length]!;
  return {
    shirt: s.shirt,
    shirtShade: s.shirtShade,
    shirtTrim: s.shirtTrim,
    bg: s.bg,
    mug: s.mug,
    hair: hr.main,
    hairShade: hr.shade,
    skin: sk.skin,
    skinShade: sk.skinShade,
    hairStyle,
    outfitStyle: (hOutfit % 4) as 0 | 1 | 2 | 3,
    accessory,
    deskProp: (hProp % 3) as 0 | 1 | 2,
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

const MOOD_KEYS: Record<WorkLabel, MessageKey> = {
  working: "office.desk.mood.working",
  ready: "office.desk.mood.ready",
  waiting_review: "office.desk.mood.waiting_review",
  waiting_info: "office.desk.mood.waiting_info",
  waiting_resources: "office.desk.mood.waiting_resources",
  waiting_team: "office.desk.mood.waiting_team",
  paused: "office.desk.mood.paused",
  cancelling: "office.desk.mood.cancelling",
  reconciling: "office.desk.mood.reconciling",
  not_ready: "office.desk.mood.not_ready",
};

const CUE_KEYS: Record<WorkLabel, MessageKey> = {
  working: "office.desk.cue.working",
  ready: "office.desk.cue.ready",
  waiting_review: "office.desk.cue.waiting_review",
  waiting_info: "office.desk.cue.waiting_info",
  waiting_resources: "office.desk.cue.waiting_resources",
  waiting_team: "office.desk.cue.waiting_team",
  paused: "office.desk.cue.paused",
  cancelling: "office.desk.cue.cancelling",
  reconciling: "office.desk.cue.reconciling",
  not_ready: "office.desk.cue.not_ready",
};

export const deskMoodText = (label: WorkLabel): string => t(MOOD_KEYS[label]);

export const deskShortCue = (label: WorkLabel): string => t(CUE_KEYS[label]);

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

function ChibiHairBack({ style, fill, shade }: { style: AvatarHairStyle; fill: string; shade: string }) {
  if (style === 2) {
    return <path d="M87 38 C87 19 100 12 114 12 C128 12 141 19 141 38 L142 58 C137 60 131 59 128 55 L100 55 C97 59 91 60 86 58 Z" fill={shade} />;
  }
  if (style === 3) {
    return (
      <g fill={fill}>
        <circle cx="94" cy="23" r="11" />
        <circle cx="114" cy="16" r="12" />
        <circle cx="134" cy="23" r="11" />
        <circle cx="89" cy="36" r="8.5" />
        <circle cx="139" cy="36" r="8.5" />
      </g>
    );
  }
  if (style === 4) {
    return (
      <g>
        <circle cx="114" cy="11.5" r="8.5" fill={shade} />
        <circle cx="113" cy="10.5" r="7" fill={fill} />
        <rect x="108" y="15.5" width="12" height="2.4" rx="1.2" fill="#f59e0b" opacity="0.85" />
      </g>
    );
  }
  if (style === 5) {
    return (
      <g fill={shade}>
        <circle cx="88" cy="40" r="8.5" />
        <circle cx="140" cy="40" r="8.5" />
        <circle cx="89" cy="49" r="6.5" fill={fill} />
        <circle cx="139" cy="49" r="6.5" fill={fill} />
      </g>
    );
  }
  return null;
}

function ChibiHairFront({ style, fill }: { style: AvatarHairStyle; fill: string }) {
  if (style === 0) {
    // Neat side-part
    return <path d="M93 34 C93 17 103 12 114 12 C126 12 135 18 135 34 C129 24 121 22 114 26 C106 23 98 27 93 34 Z" fill={fill} />;
  }
  if (style === 1) {
    // Energetic spiky / tousled studio crop
    return (
      <path
        d="M93 34 C92 22 97 15 103 12 L106 17 L112 9 L117 16 L124 11 L126 17 C132 18 136 24 135 34 C129 26 122 24 115 27 C108 24 100 26 93 34 Z"
        fill={fill}
      />
    );
  }
  if (style === 2) {
    // Flowing bob bangs
    return <path d="M93 35 C94 18 103 13 114 13 C125 13 134 18 135 35 C128 24 119 23 114 27 C107 23 100 25 93 35 Z" fill={fill} />;
  }
  if (style === 3) {
    // Curly crown line
    return <path d="M94 29 C96 20 105 16 114 16 C123 16 132 20 134 29 C127 25 119 23 114 26 C108 23 100 25 94 29 Z" fill={fill} />;
  }
  if (style === 4) {
    // Swept-back bangs for top bun
    return <path d="M94 33 C94 18 103 13 114 13 C125 13 134 18 134 33 C128 23 121 21 114 23 C107 21 100 23 94 33 Z" fill={fill} />;
  }
  // Style 5: center-part curtain bangs
  return <path d="M93 36 C93 18 103 13 114 13 C125 13 135 18 135 36 C128 28 121 24 114 21 C107 24 100 28 93 36 Z" fill={fill} />;
}

function ChibiOutfit({ p, executive }: { p: PersonaPalette; executive: boolean }) {
  const style = executive ? 1 : p.outfitStyle;
  return (
    <g>
      <path d="M90 77 C91 58 99 52 114 52 C129 52 137 58 138 77 Z" fill={p.shirt} />
      {style === 0 && (
        <>
          <path d="M104 52 L114 61 L124 52 C120 51 108 51 104 52 Z" fill={p.shirtShade} />
          <circle cx="110.5" cy="63" r="1.4" fill={p.shirtTrim} />
          <circle cx="117.5" cy="63" r="1.4" fill={p.shirtTrim} />
        </>
      )}
      {style === 1 && (
        <>
          <path d="M105 52 L114 68 L123 52 Z" fill="#f8fafc" />
          <path d="M112.5 55 L115.5 55 L116 66 L114 69 L112 66 Z" fill="#e11d48" />
          <path d="M101 54 L109 67 L105 53 Z" fill={p.shirtShade} />
          <path d="M127 54 L119 67 L123 53 Z" fill={p.shirtShade} />
        </>
      )}
      {style === 2 && (
        <>
          <path d="M105 52 L114 58 L123 52 L120 56 L114 54 L108 56 Z" fill="#f8fafc" />
          <path d="M96 68 H132" stroke={p.shirtTrim} strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
        </>
      )}
      {style === 3 && (
        <>
          <rect x="93" y="62" width="42" height="5" rx="2" fill={p.shirtTrim} opacity="0.85" />
          <rect x="92" y="69" width="44" height="3.5" rx="1.5" fill={p.shirtShade} opacity="0.65" />
        </>
      )}
    </g>
  );
}

function ChibiHeadAndTorso({
  p,
  kind,
  fullBody = false,
  executive = false,
}: {
  p: PersonaPalette;
  kind: DeskPresenceKind;
  fullBody?: boolean;
  executive?: boolean;
}) {
  const animStyle: CSSProperties | undefined =
    kind === "working"
      ? { animationName: "orbit-chibi-bob", animationDuration: "0.9s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }
      : kind === "waiting"
        ? { animationName: "orbit-chibi-wave", animationDuration: "2.2s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out", transformOrigin: "114px 66px" }
        : undefined;

  return (
    <g style={animStyle}>
      <ChibiHairBack style={p.hairStyle} fill={p.hair} shade={p.hairShade} />

      {/* Full body legs when standing/walking on the office floor */}
      {fullBody && (
        <g>
          <rect x="103" y="75" width="7.5" height="12" rx="3.5" fill="#334155" />
          <rect x="117.5" y="75" width="7.5" height="12" rx="3.5" fill="#334155" />
          <ellipse cx="106.5" cy="87.5" rx="5.5" ry="3.2" fill="#1e293b" />
          <ellipse cx="121.5" cy="87.5" rx="5.5" ry="3.2" fill="#1e293b" />
        </g>
      )}

      {/* Distinct torso outfit */}
      <ChibiOutfit p={p} executive={executive} />

      {/* Scarf / Lanyard accessory around collar */}
      {p.accessory === 4 && (
        <g>
          <rect x="100" y="51" width="28" height="6.5" rx="3.2" fill={p.mug} />
          <rect x="119" y="55" width="6.5" height="11" rx="2.5" fill={p.mug} />
          <rect x="103" y="53.5" width="22" height="1.4" rx="0.7" fill="#ffffff" opacity="0.45" />
        </g>
      )}

      {/* Chibi hands */}
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

      {/* Big rounded head */}
      <rect x="95" y="17" width="38" height="34" rx="17.5" fill={p.skin} />

      {/* Rosy cheeks */}
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

      {/* Round glasses */}
      {p.accessory === 1 && (
        <g stroke="#2b2833" strokeWidth="1.4" fill="none" opacity="0.9">
          <circle cx="107" cy="35.5" r="4.6" />
          <circle cx="121" cy="35.5" r="4.6" />
          <path d="M111.6 35.5 H116.4" />
        </g>
      )}

      {/* Studio headset */}
      {p.accessory === 2 && (
        <g>
          <path d="M93.5 35 C93.5 19.5 102.5 13 114 13 C125.5 13 134.5 19.5 134.5 35" fill="none" stroke="#363544" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="90.5" y="32.5" width="4.5" height="8" rx="2.2" fill="#363544" />
          <rect x="133" y="32.5" width="4.5" height="8" rx="2.2" fill="#363544" />
          <path d="M93 39.5 Q97 44 105 44.5" fill="none" stroke="#363544" strokeWidth="1.35" strokeLinecap="round" />
        </g>
      )}

      {/* Cozy studio beanie */}
      {p.accessory === 3 && (
        <g>
          <path d="M94 24 C95 12 104 8 114 8 C124 8 133 12 134 24 Z" fill={p.shirt} />
          <rect x="92.5" y="21" width="43" height="5.5" rx="2.7" fill={p.shirtShade} />
          <circle cx="114" cy="7.5" r="3.4" fill={p.shirtTrim} />
        </g>
      )}
    </g>
  );
}

export function ChibiAvatarSvg({
  name,
  workLabel,
  size = 54,
  avatarStyle,
  seed,
  executive = false,
}: {
  name: string;
  workLabel: WorkLabel;
  size?: number;
  avatarStyle?: AvatarCustomization;
  seed?: string;
  executive?: boolean;
}) {
  const p = personaFor(name, avatarStyle, seed);
  const kind = presenceKindOf(workLabel);
  return (
    <svg width={size} height={size} viewBox="80 6 68 86" fill="none" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <ellipse cx="114" cy="88.5" rx="18" ry="3.5" fill="currentColor" opacity="0.14" />
      <ChibiHeadAndTorso p={p} kind={kind} fullBody executive={executive} />
    </svg>
  );
}

// Crisp head-and-shoulders illustrated portrait for List view, Leadership, Work, Mission, and Schedule rows.
export function ChibiPortraitAvatar({
  name,
  size = 32,
  avatarStyle,
  seed,
  executive = false,
}: {
  name: string;
  size?: number;
  avatarStyle?: AvatarCustomization;
  seed?: string;
  executive?: boolean;
}) {
  const p = personaFor(name, avatarStyle, seed);
  return (
    <span
      aria-hidden
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "10px",
        backgroundColor: p.bg,
        border: `1px solid ${p.shirtTrim}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox="84 6 60 66" fill="none" style={{ display: "block" }}>
        <ChibiHeadAndTorso p={p} kind="ready" executive={executive} />
      </svg>
    </span>
  );
}

function ScreenDisplay({ kind, lamp }: { kind: DeskPresenceKind; lamp: LampPalette }) {
  return (
    <g>
      <rect x="150" y="30" width="56" height="37" rx="5" fill="#2a2926" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.2" />
      <rect x="153" y="33" width="50" height="30" rx="3" fill={lamp.screenBg} />
      {kind === "working" && (
        <g>
          <rect x="158" y="38.5" width="24" height="3" rx="1.5" fill={lamp.screenAccent} opacity="0.95" />
          <rect x="158" y="44" width="34" height="2.5" rx="1.25" fill={lamp.screenAccent} opacity="0.6" />
          <rect x="158" y="49" width="25" height="2.5" rx="1.25" fill={lamp.screenAccent} opacity="0.45" />
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
  avatarStyle,
  seed,
  executive = false,
}: {
  name: string;
  workLabel: WorkLabel;
  holdingTitle?: string | null;
  compact?: boolean;
  avatarStyle?: AvatarCustomization;
  seed?: string;
  executive?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const p = personaFor(name, avatarStyle, seed);
  const kind = presenceKindOf(workLabel);
  const lamp = LAMP_PALETTES[kind];
  const haloId = `orbit-desk-halo-${uid}`;
  const deskId = `orbit-desk-top-${uid}`;

  if (compact) {
    return (
      <svg
        width="104"
        height="68"
        viewBox="64 6 150 86"
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
        <ChibiHeadAndTorso p={p} kind={kind} executive={executive} />
        <rect x="70" y="74" width="140" height="8" rx="3.5" fill={tokens.colorNeutralStroke1} />
        <rect x="70" y="74" width="140" height="2.5" rx="1.25" fill={tokens.colorNeutralStroke2} />
        <ScreenDisplay kind={kind} lamp={lamp} />
        {/* Personalized desk accessory: mug or succulent */}
        {p.deskProp === 0 && <rect x="76" y="65.5" width="8.5" height="8.5" rx="2.2" fill={p.mug} />}
        {p.deskProp === 1 && (
          <g>
            <rect x="77" y="68" width="7" height="6" rx="1.5" fill="#b45309" />
            <ellipse cx="80.5" cy="66" rx="4.5" ry="3.5" fill="#16a34a" />
          </g>
        )}
        {p.deskProp === 2 && (
          <g>
            <circle cx="80.5" cy="69" r="3.4" fill={lamp.led} style={kind === "working" ? { animationName: "orbit-pulse", animationDuration: "1.5s", animationIterationCount: "infinite" } : undefined} />
            <rect x="76.5" y="72.5" width="8" height="2" rx="1" fill="currentColor" opacity="0.45" />
          </g>
        )}
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

        <rect x="14" y="10" width="220" height="68" rx="12" fill="currentColor" opacity="0.045" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
        <path d="M26 52 H222" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="3 3" />

        {showThought && (
          <g fill="var(--orbit-card-bg)" stroke={kind === "working" ? tokens.colorBrandStroke2 : tokens.colorPaletteMarigoldBorder1} strokeWidth="0.9">
            <circle cx="114" cy="11" r="2.6" />
            <circle cx="114" cy="17.5" r="1.7" />
          </g>
        )}

        <circle cx="164" cy="48" r="44" fill={`url(#${haloId})`} />

        <g>
          <path d="M35 67 C32 59 35 53 38.5 59.5 C40.5 52 46 53.5 43.5 60.5 C47.5 55.5 50.5 58.5 46.5 67 Z" fill="#10b981" opacity="0.76" />
          <path d="M34 66.5 H47.5 L45.6 75 H36 Z" fill="currentColor" opacity="0.34" />
        </g>

        <rect x="91" y="25" width="46" height="47" rx="14" fill="currentColor" opacity="0.15" />
        <rect x="95" y="29" width="38" height="40" rx="11" fill="currentColor" opacity="0.11" />
        <ChibiHeadAndTorso p={p} kind={kind} executive={executive} />

        <rect x="18" y="75" width="212" height="10" rx="4" fill={`url(#${deskId})`} />
        <rect x="18" y="75" width="212" height="2.5" rx="1.25" fill={tokens.colorNeutralBackground1} opacity="0.4" />

        <rect x="92" y="73.2" width="48" height="2.6" rx="1.3" fill="currentColor" opacity="0.28" />

        <rect x="65" y="65.5" width="9.5" height="9" rx="2.5" fill={p.mug} />
        <path d="M74.5 67.8 C77.2 67.8 77.2 72 74.5 72" stroke={p.mug} strokeWidth="1.5" fill="none" />

        <ScreenDisplay kind={kind} lamp={lamp} />

        <path d="M54 75 V65 Q54 60.5 58.5 60.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.7" strokeLinecap="round" />
        <circle
          cx="59.5"
          cy="62"
          r="3.2"
          fill={lamp.led}
          style={kind === "working" ? { animationName: "orbit-pulse", animationDuration: "1.5s", animationIterationCount: "infinite" } : undefined}
        />
        <rect x="50" y="73.5" width="8" height="2" rx="1" fill="currentColor" opacity="0.45" />

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
