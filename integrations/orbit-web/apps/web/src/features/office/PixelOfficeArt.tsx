// GATHER-STYLE 2.5D PIXEL OFFICE ART: crisp pixel-grid employees (director suit, typing, asking at director's desk,
// sipping coffee in Pantry, spinning a pen), modern studio desks, executive suite, Pantry lounge, and bookshelves.
import type { WorkLabel } from "@orbit-web/contracts";
import type { CSSProperties, ReactNode } from "react";
import type { AvatarCustomization } from "./floorPrefs";
import { personaFor, presenceKindOf } from "./VirtualDesk";

export type ChibiActivity = "default" | "director" | "typing" | "asking" | "coffee" | "pen-spin";

export type ChibiFacing = "front" | "left" | "right";

export function PixelChibiSvg({
  name,
  workLabel,
  activity = "default",
  facing = "front",
  walking = false,
  stride = 0,
  size = 50,
  executive = false,
  avatarStyle,
  seed,
}: {
  name: string;
  workLabel: WorkLabel;
  activity?: ChibiActivity;
  facing?: ChibiFacing;
  walking?: boolean;
  stride?: 0 | 1;
  size?: number;
  executive?: boolean;
  avatarStyle?: AvatarCustomization;
  seed?: string;
}) {
  const p = personaFor(name, avatarStyle, seed);
  const hair = { main: p.hair, shade: p.hairShade };
  const kind = presenceKindOf(workLabel);

  const isDirector = (executive || activity === "director") && avatarStyle?.shirt === undefined;
  const shirt = isDirector ? "#1e3a5f" : p.shirt;
  const shirtTrim = isDirector ? "#f8fafc" : p.shirtTrim;
  const shirtShade = isDirector ? "#132640" : p.shirtShade;

  const wantBob = !walking && (activity === "typing" || (activity === "default" && kind === "working"));
  const wantWave = !walking && (activity === "asking" || (activity === "default" && kind === "waiting"));

  const animStyle: CSSProperties | undefined = walking
    ? { transform: `translateY(${stride === 1 ? -1 : 0}px)` }
    : wantBob
      ? { animationName: "orbit-chibi-bob", animationDuration: "0.75s", animationIterationCount: "infinite", animationTimingFunction: "steps(2, end)" }
      : wantWave
        ? { animationName: "orbit-chibi-wave", animationDuration: "1.8s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out", transformOrigin: "8px 16px" }
        : undefined;

  const lookDx = facing === "left" ? -1 : facing === "right" ? 1 : 0;

  return (
    <svg
      width={size}
      height={Math.round(size * 1.12)}
      viewBox="-1 0 18 18"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0, pointerEvents: "none" }}
    >
      {/* Ground shadow */}
      <rect x="4" y="16" width="8" height="1.5" fill="#1e1b18" opacity="0.2" />

      {/* Subtle heel dust puff when walking */}
      {walking && (
        <rect
          x={facing === "left" ? 12.5 : facing === "right" ? 1.5 : stride === 0 ? 2 : 12.5}
          y={15}
          width="2"
          height="1.5"
          fill="#d6ccc0"
          opacity="0.7"
        />
      )}

      <g style={animStyle}>
        {/* Hair (6 distinct silhouettes matching EmployeeDeskScene) */}
        {p.hairStyle === 4 && (
          <>
            <rect x="6" y="-0.6" width="4" height="2" fill={hair.main} />
            <rect x="6.5" y="0.9" width="3" height="0.7" fill="#f59e0b" />
          </>
        )}
        {p.hairStyle === 1 && (
          <>
            <rect x="5" y="0" width="1.5" height="1.5" fill={hair.main} />
            <rect x="7.5" y="-0.3" width="2" height="1.8" fill={hair.main} />
            <rect x="10.2" y="0.2" width="1.5" height="1.3" fill={hair.main} />
          </>
        )}
        {p.hairStyle === 3 && <rect x="2.5" y="1" width="11" height="6" fill={hair.main} />}
        <rect x="4" y="1" width="8" height="2" fill={hair.main} />
        <rect x="3" y="2" width="10" height="5" fill={hair.main} />
        <rect x="3" y="5" width="2" height="4" fill={hair.shade} />
        <rect x="11" y="5" width="2" height="4" fill={hair.shade} />
        {p.hairStyle === 2 && <rect x="3" y="7" width="10" height="3" fill={hair.shade} />}
        {p.hairStyle === 5 && (
          <>
            <rect x="2" y="6" width="2" height="3.5" fill={hair.shade} />
            <rect x="12" y="6" width="2" height="3.5" fill={hair.shade} />
          </>
        )}

        {/* Face */}
        <rect x="4" y="4" width="8" height="5" fill={p.skin} />
        <rect x="4" y="3" width="8" height="1" fill={hair.main} />
        <rect x={5 + lookDx} y="4" width="2" height="1" fill={hair.shade} />
        <rect x={10 + lookDx} y="4" width="1" height="1" fill={hair.shade} />

        {/* Eyes + rosy cheeks (shifted toward facing direction) */}
        {kind === "paused" && !walking && activity !== "director" ? (
          <>
            <rect x={5 + lookDx} y="6" width="2" height="1" fill="#231c18" />
            <rect x={9 + lookDx} y="6" width="2" height="1" fill="#231c18" />
          </>
        ) : (
          <>
            <rect x={5 + lookDx} y="6" width="1" height="1" fill="#1b1817" />
            <rect x={10 + lookDx} y="6" width="1" height="1" fill="#1b1817" />
            <rect x={4 + lookDx} y="7" width="1" height="1" fill="#f472b6" opacity="0.55" />
            <rect x={11 + lookDx} y="7" width="1" height="1" fill="#f472b6" opacity="0.55" />
          </>
        )}

        {/* Blazer / Sweater Torso */}
        <rect x="4" y="9" width="8" height="5" fill={shirt} />
        <rect x="5" y="9" width="6" height="1" fill={shirtTrim} />
        {isDirector && <rect x="7" y="10" width="2" height="3" fill="#e11d48" />}
        <rect x="4" y="12" width="8" height="2" fill={shirtShade} />

        {/* Hands / Activity props */}
        {walking ? (
          <>
            <rect x="3" y={stride === 0 ? 9 : 11} width="1" height="3" fill={p.skin} />
            <rect x="12" y={stride === 0 ? 11 : 9} width="1" height="3" fill={p.skin} />
          </>
        ) : wantWave ? (
          <>
            <rect x="2" y="7" width="2" height="2" fill={shirt} />
            <rect x="2" y="6" width="1" height="1" fill={p.skin} />
            <rect x="12" y="10" width="2" height="3" fill={p.skin} />
            {activity === "asking" && <rect x="13" y="9" width="2.5" height="3" fill="#fef3c7" />}
          </>
        ) : activity === "coffee" ? (
          <>
            <rect x="3" y="10" width="1" height="3" fill={p.skin} />
            <rect x="12" y="10" width="1" height="2" fill={p.skin} />
            <rect x="13" y="10" width="2.5" height="2.5" fill="#f8fafc" />
            <rect x="13.5" y="10" width="1.5" height="0.8" fill="#78350f" />
            <rect
              x="14"
              y="7.5"
              width="1"
              height="1.5"
              fill="#94a3b8"
              style={{ animationName: "orbit-steam", animationDuration: "1.6s", animationIterationCount: "infinite" }}
            />
          </>
        ) : activity === "pen-spin" ? (
          <>
            <rect x="3" y="10" width="1" height="3" fill={p.skin} />
            <rect x="12" y="10" width="1" height="2" fill={p.skin} />
            <g style={{ transformOrigin: "14px 9.5px", animationName: "orbit-pen-spin", animationDuration: "1.2s", animationIterationCount: "infinite", animationTimingFunction: "linear" }}>
              <rect x="12" y="9" width="4" height="1" fill="#4f46e5" />
              <rect x="15.2" y="9" width="1" height="1" fill="#f59e0b" />
            </g>
          </>
        ) : (
          <>
            <rect x="3" y="10" width="1" height="3" fill={p.skin} />
            <rect x="12" y="10" width="1" height="3" fill={p.skin} />
          </>
        )}

        {/* Glasses, headset, beanie, or scarf accessory */}
        {p.accessory === 1 && (
          <>
            <rect x={4 + lookDx} y="5" width="3" height="2" stroke="#1e1b24" strokeWidth="0.6" fill="none" />
            <rect x={9 + lookDx} y="5" width="3" height="2" stroke="#1e1b24" strokeWidth="0.6" fill="none" />
          </>
        )}
        {p.accessory === 2 && (
          <>
            <rect x="2.5" y="4" width="1.2" height="3.2" fill="#334155" />
            <rect x="12.3" y="4" width="1.2" height="3.2" fill="#334155" />
            <rect x="4" y="0.5" width="8" height="0.8" fill="#475569" />
          </>
        )}
        {p.accessory === 3 && (
          <>
            <rect x="3.5" y="0.8" width="9" height="2.2" fill={shirt} />
            <rect x="3" y="2.6" width="10" height="1.2" fill={shirtShade} />
            <rect x="7" y="0" width="2" height="1" fill={shirtTrim} />
          </>
        )}
        {p.accessory === 4 && (
          <>
            <rect x="4" y="8.8" width="8" height="1.4" fill={p.mug} />
            <rect x="9.5" y="9.8" width="2" height="2.2" fill={p.mug} />
          </>
        )}

        {/* Alternating walking stride vs standing legs */}
        {walking ? (
          <>
            <rect x={stride === 0 ? 4.5 : 5} y={stride === 0 ? 13.2 : 14} width="2" height="2" fill="#334155" />
            <rect x={stride === 1 ? 9.5 : 9} y={stride === 1 ? 13.2 : 14} width="2" height="2" fill="#334155" />
            <rect x={stride === 0 ? 3.8 : 4.5} y={stride === 0 ? 14.3 : 15} width="3" height="1.5" fill="#1e293b" />
            <rect x={stride === 1 ? 9.5 : 9} y={stride === 1 ? 14.3 : 15} width="3" height="1.5" fill="#1e293b" />
          </>
        ) : (
          <>
            <rect x="5" y="14" width="2" height="2" fill="#334155" />
            <rect x="9" y="14" width="2" height="2" fill="#334155" />
            <rect x="4" y="15" width="3" height="1.5" fill="#1e293b" />
            <rect x="9" y="15" width="3" height="1.5" fill="#1e293b" />
          </>
        )}
      </g>
    </svg>
  );
}

export function GatherNamePill({
  name,
  dotColor,
  suffix,
  iconText,
  selected = false,
}: {
  name: string;
  dotColor: string;
  suffix?: string;
  iconText?: string;
  selected?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 8px",
        borderRadius: "9999px",
        backgroundColor: "rgba(20, 22, 30, 0.88)",
        border: selected ? "1px solid rgba(129, 140, 248, 0.9)" : "1px solid rgba(255, 255, 255, 0.14)",
        color: "#ffffff",
        fontSize: "10px",
        fontWeight: 600,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        maxWidth: "184px",
        pointerEvents: "none",
        boxShadow: selected
          ? "0 0 0 2px rgba(99, 102, 241, 0.45), 0 4px 12px rgba(15, 23, 42, 0.28)"
          : "0 2px 6px rgba(15, 23, 42, 0.22)",
      }}
    >
      <span style={{ width: "6px", height: "6px", borderRadius: "9999px", backgroundColor: dotColor, flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      {suffix && (
        <span style={{ padding: "0 4px", borderRadius: "9999px", backgroundColor: "rgba(255,255,255,0.16)", fontSize: "9px", fontWeight: 700, letterSpacing: "0.02em" }}>
          {suffix}
        </span>
      )}
      {iconText && <span style={{ fontSize: "10px" }}>{iconText}</span>}
    </span>
  );
}

const shortTitle = (text: string, max = 20): string => {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

function ThoughtCloud({
  borderColor = "#cbd5e1",
  duration = "2s",
  maxWidth = "148px",
  children,
}: {
  borderColor?: string;
  duration?: string;
  maxWidth?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        animationName: "orbit-thought-float",
        animationDuration: duration,
        animationIterationCount: "infinite",
        animationTimingFunction: "ease-in-out",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 9px",
          borderRadius: "14px",
          backgroundColor: "#ffffff",
          border: `1.5px solid ${borderColor}`,
          boxShadow: "0 2px 8px rgba(15, 23, 42, 0.1)",
          maxWidth,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "-4px",
            left: "7px",
            width: "10px",
            height: "6px",
            borderRadius: "9999px",
            backgroundColor: "#ffffff",
            borderTop: `1.5px solid ${borderColor}`,
            borderLeft: `1px solid ${borderColor}`,
            pointerEvents: "none",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: "-5px",
            right: "8px",
            width: "12px",
            height: "7px",
            borderRadius: "9999px",
            backgroundColor: "#ffffff",
            borderTop: `1.5px solid ${borderColor}`,
            borderRight: `1px solid ${borderColor}`,
            pointerEvents: "none",
          }}
        />
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "4px", minWidth: 0 }}>{children}</span>
      </div>
      <span
        style={{
          width: "5px",
          height: "5px",
          borderRadius: "9999px",
          backgroundColor: "#ffffff",
          border: `1.2px solid ${borderColor}`,
          marginTop: "1px",
          marginRight: "6px",
        }}
      />
      <span
        style={{
          width: "3px",
          height: "3px",
          borderRadius: "9999px",
          backgroundColor: "#ffffff",
          border: `1px solid ${borderColor}`,
          marginTop: "1px",
          marginRight: "11px",
        }}
      />
    </div>
  );
}

export function PixelQuestBubble({
  workLabel,
  title = null,
}: {
  workLabel: WorkLabel;
  title?: string | null;
}) {
  const kind = presenceKindOf(workLabel);

  if (kind === "waiting") {
    return (
      <ThoughtCloud borderColor="#d97706" duration="1.4s" maxWidth="150px">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "13px",
            height: "13px",
            borderRadius: "9999px",
            backgroundColor: "#f59e0b",
            color: "#ffffff",
            fontWeight: 900,
            fontSize: "9.5px",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          !
        </span>
        {title && (
          <span style={{ fontSize: "10px", fontWeight: 700, color: "#1f1e1b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {shortTitle(title, 16)}
          </span>
        )}
      </ThoughtCloud>
    );
  }

  if (kind === "working") {
    return (
      <ThoughtCloud borderColor="#6366f1" duration="1.8s" maxWidth="148px">
        <span
          style={{
            width: "9px",
            height: "9px",
            borderRadius: "9999px",
            borderTopWidth: "1.8px",
            borderRightWidth: "1.8px",
            borderBottomWidth: "1.8px",
            borderLeftWidth: "1.8px",
            borderTopStyle: "solid",
            borderRightStyle: "solid",
            borderBottomStyle: "solid",
            borderLeftStyle: "solid",
            borderRightColor: "#6366f1",
            borderBottomColor: "#6366f1",
            borderLeftColor: "#6366f1",
            borderTopColor: "transparent",
            flexShrink: 0,
            animationName: "orbit-spin",
            animationDuration: "0.9s",
            animationIterationCount: "infinite",
            animationTimingFunction: "linear",
          }}
        />
        <span style={{ fontSize: "10px", fontWeight: 700, color: "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {shortTitle(title || "Working…", 16)}
        </span>
      </ThoughtCloud>
    );
  }

  if (kind === "paused" || kind === "offline") {
    return (
      <ThoughtCloud borderColor="#94a3b8" duration="2.4s" maxWidth="80px">
        <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#64748b", lineHeight: 1 }}>
          {kind === "paused" ? "zZz" : "! off"}
        </span>
      </ThoughtCloud>
    );
  }

  return (
    <ThoughtCloud borderColor="#cbd5e1" duration="2.2s" maxWidth="72px">
      {[0, 1, 2].map((idx) => (
        <span
          key={idx}
          style={{
            width: "3.5px",
            height: "3.5px",
            borderRadius: "9999px",
            backgroundColor: "#64748b",
            animationName: "orbit-dot-pulse",
            animationDuration: "1.4s",
            animationDelay: `${idx * 0.22}s`,
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-in-out",
          }}
        />
      ))}
    </ThoughtCloud>
  );
}

export function PixelDirectorDeskSvg() {
  return (
    <svg width="126" height="50" viewBox="0 0 63 25" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0, pointerEvents: "none" }}>
      {/* Executive high-back leather chair peeking behind */}
      <rect x="26" y="0" width="11" height="5" fill="#1e293b" />
      <rect x="27" y="1" width="9" height="3" fill="#334155" />
      {/* Soft ambient drop shadow */}
      <rect x="3" y="19" width="57" height="3" fill="#1e293b" opacity="0.14" />
      {/* Warm architectural walnut & slate executive desk */}
      <rect x="4" y="6" width="55" height="12" fill="#8b6240" />
      <rect x="3" y="4" width="57" height="5" fill="#d8b892" />
      <rect x="4" y="5" width="55" height="3" fill="#e9d2b5" />
      <rect x="5" y="10" width="53" height="7" fill="#6f4c30" />
      <rect x="7" y="11" width="49" height="5" fill="#9c704a" />
      {/* Dark leather desk pad */}
      <rect x="19" y="6" width="25" height="3" fill="#1e293b" opacity="0.72" />
      {/* Dual wide studio displays with dashboard accents */}
      <rect x="18" y="1" width="12" height="6" fill="#0f172a" />
      <rect x="19" y="2" width="10" height="4" fill="#1e3a5f" />
      <rect x="20" y="3" width="5" height="1" fill="#38bdf8" />
      <rect x="20" y="4.5" width="8" height="1" fill="#7dd3fc" opacity="0.75" />
      <rect x="33" y="1" width="12" height="6" fill="#0f172a" />
      <rect x="34" y="2" width="10" height="4" fill="#1e1b4b" />
      <rect x="35" y="3" width="6" height="1" fill="#a5b4fc" />
      <rect x="35" y="4.5" width="4" height="1" fill="#34d399" />
      {/* Warm brass desk lamp + glow */}
      <rect x="6" y="2" width="5" height="2" fill="#fbbf24" />
      <rect x="7" y="4" width="3" height="1" fill="#fef3c7" opacity="0.8" />
      <rect x="8" y="4" width="1" height="3" fill="#475569" />
      <rect x="7" y="7" width="3" height="1" fill="#334155" />
      {/* Ceramic espresso cup + desk mini plant */}
      <rect x="50" y="5" width="3" height="3" fill="#f8fafc" />
      <rect x="50.5" y="5" width="2" height="1" fill="#78350f" />
      <rect x="54" y="5" width="3" height="3" fill="#b45309" />
      <rect x="53.5" y="3" width="4" height="2.5" fill="#16a34a" />
      {/* Executive brass nameplate */}
      <rect x="25" y="12.5" width="13" height="2.5" fill="#1e293b" />
      <rect x="26" y="13.2" width="11" height="1" fill="#fbbf24" opacity="0.85" />
      {/* Visitor chair tucked in front */}
      <rect x="45" y="20" width="9" height="4" fill="#4f46e5" />
      <rect x="46" y="21" width="7" height="2" fill="#818cf8" />
    </svg>
  );
}

export function PixelPantryLoungeSvg() {
  return (
    <svg
      width="320"
      height="86"
      viewBox="0 0 160 43"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: "block", width: "100%", maxWidth: "336px", height: "auto", flexShrink: 0 }}
    >
      {/* Left Zone: Timber Espresso Bar + Pastry Dome + Water Cooler */}
      <rect x="2" y="13" width="38" height="3" fill="#1e1b18" opacity="0.08" />
      <rect x="2" y="5" width="38" height="9" fill="#c79f72" />
      <rect x="2" y="3" width="38" height="4" fill="#ead3b5" />
      <rect x="3" y="9" width="36" height="4" fill="#a87f54" />
      {/* Matte espresso machine + warm steam */}
      <rect x="5" y="0" width="10" height="5" fill="#1e293b" />
      <rect x="6" y="1" width="5" height="2" fill="#94a3b8" />
      <rect x="12" y="1" width="2" height="1" fill="#34d399" />
      <rect
        x="8"
        y="-1"
        width="1"
        height="1.5"
        fill="#cbd5e1"
        style={{ animationName: "orbit-steam", animationDuration: "1.8s", animationIterationCount: "infinite" }}
      />
      {/* Ceramic mugs & pastry dome */}
      <rect x="18" y="3" width="3" height="2.5" fill="#f8fafc" />
      <rect x="22" y="3" width="3" height="2.5" fill="#fb7185" />
      <rect x="28" y="1.5" width="8" height="4" fill="#e0f2fe" opacity="0.7" />
      <rect x="29" y="3.5" width="6" height="2" fill="#d97706" />
      {/* Classic blue Water Cooler */}
      <rect x="43" y="5" width="7" height="10" fill="#e2e8f0" />
      <rect x="44" y="1" width="5" height="4" fill="#38bdf8" />
      <rect x="45" y="7" width="3" height="2" fill="#0284c7" />
      <rect x="43" y="15" width="7" height="1.5" fill="#1e293b" opacity="0.12" />

      {/* Center Zone: Woven Lounge Rug + Cozy Terracotta Sofa + Coffee Table */}
      <rect x="56" y="15" width="48" height="24" fill="#e9dcc8" opacity="0.65" />
      <rect x="58" y="17" width="44" height="20" fill="#f2e7d6" opacity="0.75" />
      {/* Warm Cozy Sofa with accent pillows */}
      <rect x="64" y="13" width="32" height="10" fill="#c25e32" />
      <rect x="67" y="14" width="26" height="7" fill="#e07a4b" />
      <rect x="64" y="13" width="4" height="10" fill="#9f4721" />
      <rect x="92" y="13" width="4" height="10" fill="#9f4721" />
      {/* Accent throw cushions */}
      <rect x="69" y="15" width="4" height="4" fill="#fde68a" />
      <rect x="87" y="15" width="4" height="4" fill="#99f6e4" />
      {/* Oak Coffee Table + snacks & book */}
      <rect x="72" y="27" width="16" height="7" fill="#8b5e38" />
      <rect x="73" y="26" width="14" height="2.5" fill="#c79563" />
      <rect x="75" y="26.5" width="4" height="1.5" fill="#f8fafc" />
      <rect x="81" y="26.5" width="4" height="1.5" fill="#818cf8" />
      <rect x="72" y="34" width="16" height="2" fill="#1e1b18" opacity="0.1" />

      {/* Right Zone: Emerald Ping-Pong Table + Warm Floor Lamp + Lush Monstera */}
      <rect x="114" y="9" width="30" height="16" fill="#15803d" />
      <rect x="115" y="10" width="28" height="14" fill="#22c55e" />
      <rect x="114" y="16" width="30" height="1.5" fill="#f8fafc" />
      <rect x="120" y="12" width="3" height="2" fill="#ef4444" />
      <rect x="136" y="19" width="3" height="2" fill="#3b82f6" />
      <rect x="116" y="25" width="3" height="4" fill="#334155" />
      <rect x="139" y="25" width="3" height="4" fill="#334155" />
      {/* Warm Standing Floor Lamp */}
      <rect x="148" y="4" width="6" height="4" fill="#fde68a" />
      <rect x="149" y="5" width="4" height="2" fill="#fbbf24" />
      <rect x="150.5" y="8" width="1" height="11" fill="#475569" />
      <rect x="149" y="19" width="4" height="1.5" fill="#334155" />
      {/* Lush potted studio plant */}
      <rect x="145" y="31" width="8" height="7" fill="#9a5c32" />
      <rect x="144" y="30" width="10" height="2" fill="#c7834e" />
      <rect x="143" y="24" width="12" height="7" fill="#15803d" />
      <rect x="145" y="21" width="8" height="5" fill="#22c55e" />
      <rect x="147" y="19" width="4" height="3" fill="#86efac" />
    </svg>
  );
}

export function PixelModernDeskSvg({
  workLabel,
  occupied,
  penSpinning = false,
}: {
  workLabel: WorkLabel;
  occupied: boolean;
  penSpinning?: boolean;
}) {
  const kind = presenceKindOf(workLabel);
  const screenBg = !occupied
    ? "#334155"
    : kind === "working"
      ? "#1e1b4b"
      : kind === "waiting"
        ? "#78350f"
        : kind === "ready"
          ? "#064e3b"
          : "#3f3f46";
  const screenAccent = !occupied
    ? "#64748b"
    : kind === "working"
      ? "#818cf8"
      : kind === "waiting"
        ? "#fbbf24"
        : kind === "ready"
          ? "#34d399"
          : "#a1a1aa";

  return (
    <svg width="84" height="34" viewBox="0 0 48 20" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0, pointerEvents: "none" }}>
      {/* Ergonomic dark swivel chair peeking */}
      <rect x="19" y="1" width="10" height="4" fill="#334155" />
      <rect x="20" y="2" width="8" height="2" fill="#475569" />

      {/* Soft ground shadow */}
      <rect x="3" y="16" width="42" height="2.5" fill="#1e293b" opacity="0.12" />

      {/* Warm Nordic oak & matte-white workstation tabletop */}
      <rect x="2" y="8" width="44" height="8" fill="#d6c6b2" />
      <rect x="1" y="6" width="46" height="4" fill="#fbf9f5" />
      <rect x="2" y="10" width="44" height="6" fill="#b8a389" />
      <rect x="4" y="11" width="40" height="4" fill="#efeae1" />

      {/* Dark desk mat + keyboard + mouse */}
      <rect x="15" y="7" width="18" height="3" fill="#334155" opacity="0.85" />
      <rect x="17" y="7.5" width="12" height="1.8" fill="#64748b" />
      <rect x="30.5" y="7.8" width="1.8" height="1.4" fill="#cbd5e1" />

      {/* Warm notepad (left) + ceramic mug (right) */}
      <rect x="6" y="6.5" width="4.5" height="3" fill="#fef3c7" />
      <rect x="7" y="7.5" width="2.5" height="0.8" fill="#d97706" opacity="0.6" />
      <rect x="38" y="6" width="3.5" height="3" fill="#0d9488" />
      <rect x="38.5" y="6" width="2.5" height="0.9" fill="#f8fafc" />

      {/* Spinning pen on tabletop if penSpinning */}
      {penSpinning && (
        <g style={{ transformOrigin: "34.5px 8px", animationName: "orbit-pen-spin", animationDuration: "1.1s", animationIterationCount: "infinite", animationTimingFunction: "linear" }}>
          <rect x="32" y="7.5" width="5" height="1" fill="#4f46e5" />
          <rect x="36.2" y="7.5" width="1.2" height="1" fill="#f59e0b" />
        </g>
      )}

      {/* Sleek studio monitor */}
      <rect x="17" y="1" width="14" height="6.5" fill="#0f172a" />
      <rect x="18" y="2" width="12" height="4.5" fill={screenBg} />
      {occupied && kind === "working" ? (
        <>
          <rect x="19" y="3" width="7" height="1" fill={screenAccent} />
          <rect
            x="19"
            y="4.6"
            width="5"
            height="1"
            fill="#c7d2fe"
            style={{ animationName: "orbit-load-bar", animationDuration: "1.2s", animationIterationCount: "infinite" }}
          />
        </>
      ) : (
        <rect x="20" y="3.6" width="8" height="1.1" fill={screenAccent} opacity="0.9" />
      )}
      <rect x="22" y="7.5" width="4" height="1" fill="#475569" />
    </svg>
  );
}

export function PixelEmptyDeskClusterSvg() {
  return (
    <svg width="154" height="48" viewBox="0 0 77 24" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      {/* Desk 1 */}
      <rect x="5" y="4" width="8" height="3" fill="#475569" />
      <rect x="1" y="7" width="28" height="8" fill="#d6c6b2" />
      <rect x="0" y="6" width="30" height="3" fill="#fbf9f5" />
      <rect x="10" y="3" width="10" height="5" fill="#1e293b" />
      <rect x="11" y="4" width="8" height="3" fill="#334155" />
      {/* Partition divider strip */}
      <rect x="32" y="4" width="2" height="12" fill="#cbd5e1" />
      {/* Desk 2 */}
      <rect x="41" y="4" width="8" height="3" fill="#475569" />
      <rect x="37" y="7" width="28" height="8" fill="#d6c6b2" />
      <rect x="36" y="6" width="30" height="3" fill="#fbf9f5" />
      <rect x="46" y="3" width="10" height="5" fill="#1e293b" />
      <rect x="47" y="4" width="8" height="3" fill="#334155" />
      {/* Small plant */}
      <rect x="68" y="11" width="6" height="5" fill="#9a5c32" />
      <rect x="67" y="7" width="8" height="5" fill="#22c55e" />
      <rect x="69" y="5" width="4" height="3" fill="#86efac" />
    </svg>
  );
}

export function PixelBookshelfSvg() {
  return (
    <svg width="42" height="44" viewBox="0 0 21 22" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      {/* Ground shadow */}
      <rect x="1" y="19" width="19" height="2" fill="#1e1b18" opacity="0.14" />
      {/* Modern walnut credenza */}
      <rect x="1" y="3" width="19" height="17" fill="#7c5333" />
      <rect x="1" y="3" width="19" height="1.5" fill="#a8764c" />
      <rect x="2.5" y="5" width="16" height="5.5" fill="#3e2716" />
      <rect x="2.5" y="12" width="16" height="6" fill="#3e2716" />
      {/* Curated books top shelf */}
      <rect x="3.5" y="6" width="2" height="4.5" fill="#ef4444" />
      <rect x="6" y="7" width="2" height="3.5" fill="#3b82f6" />
      <rect x="8.5" y="6" width="2.5" height="4.5" fill="#10b981" />
      <rect x="12" y="7" width="3" height="3.5" fill="#f59e0b" />
      <rect x="15.5" y="6.5" width="2" height="4" fill="#e2e8f0" />
      {/* Bottom shelf books + folder box */}
      <rect x="3.5" y="13" width="3" height="5" fill="#8b5cf6" />
      <rect x="7" y="14" width="2" height="4" fill="#ec4899" />
      <rect x="10" y="13.5" width="3.5" height="4.5" fill="#14b8a6" />
      <rect x="14.5" y="14" width="3" height="4" fill="#cbd5e1" />
      {/* Succulent + mini globe on top */}
      <rect x="3" y="1" width="3.5" height="2" fill="#b45309" />
      <rect x="2.5" y="0" width="4.5" height="1.5" fill="#22c55e" />
      <rect x="14" y="0" width="3" height="2" fill="#38bdf8" />
      <rect x="15" y="2" width="1" height="1" fill="#f59e0b" />
    </svg>
  );
}

export function PixelPlantSvg({ variant = "autumn", size = 26 }: { variant?: "autumn" | "green"; size?: number }) {
  const leafDark = variant === "autumn" ? "#c2410c" : "#15803d";
  const leafMid = variant === "autumn" ? "#ea580c" : "#22c55e";
  const leafBright = variant === "autumn" ? "#fb923c" : "#86efac";

  return (
    <svg
      width={size}
      height={Math.round(size * 1.15)}
      viewBox="0 0 14 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect x="3" y="13" width="8" height="2" fill="#2d1b10" opacity="0.18" />
      <rect x="4" y="11" width="6" height="4" fill="#8b552c" />
      <rect x="3" y="10" width="8" height="2" fill="#c9874f" />
      <rect x="6" y="8" width="2" height="3" fill="#6b3e1d" />
      <rect x="2" y="4" width="10" height="5" fill={leafDark} />
      <rect x="3" y="2" width="8" height="6" fill={leafMid} />
      <rect x="4" y="1" width="6" height="4" fill={leafBright} />
      <rect x="4" y="5" width="3" height="2" fill={leafBright} opacity="0.7" />
    </svg>
  );
}

export function PixelHuddleTableSvg() {
  return (
    <svg width="88" height="30" viewBox="0 0 44 15" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      {/* Soft shadow */}
      <rect x="4" y="12" width="36" height="2" fill="#1e1b18" opacity="0.12" />
      {/* Mini whiteboard on left */}
      <rect x="2" y="1" width="12" height="8" fill="#f8fafc" />
      <rect x="1" y="0" width="14" height="1" fill="#64748b" />
      <rect x="3" y="3" width="6" height="1" fill="#6366f1" />
      <rect x="3" y="5" width="8" height="1" fill="#0d9488" />
      <rect x="6" y="9" width="2" height="3" fill="#475569" />
      {/* Round studio huddle table + laptops + stools */}
      <rect x="19" y="5" width="18" height="6" fill="#d8b892" />
      <rect x="21" y="4" width="14" height="5" fill="#edd6b9" />
      <rect x="23" y="5" width="4" height="2.5" fill="#1e293b" />
      <rect x="24" y="5.5" width="2" height="1.5" fill="#818cf8" />
      <rect x="30" y="5" width="4" height="2.5" fill="#1e293b" />
      <rect x="31" y="5.5" width="2" height="1.5" fill="#34d399" />
      {/* Stools */}
      <rect x="16" y="7" width="3" height="3" fill="#4f46e5" />
      <rect x="38" y="7" width="3" height="3" fill="#0d9488" />
    </svg>
  );
}
