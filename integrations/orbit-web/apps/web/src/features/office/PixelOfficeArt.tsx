// GATHER-STYLE 2.5D PIXEL OFFICE ART: crisp pixel-grid employees (director suit, typing, asking at director's desk,
// sipping coffee in Pantry, spinning a pen), modern company desks, executive suite, Pantry lounge, and bookshelves.
import type { WorkLabel } from "@orbit-web/contracts";
import type { CSSProperties, ReactNode } from "react";
import { personaFor, presenceKindOf } from "./VirtualDesk";

export type ChibiActivity = "default" | "director" | "typing" | "asking" | "coffee" | "pen-spin";

const PIXEL_HAIRS = [
  { main: "#2bb89a", shade: "#1d8571" },
  { main: "#5e3c26", shade: "#3e2617" },
  { main: "#252f44", shade: "#171d2b" },
  { main: "#d97724", shade: "#9e4f12" },
  { main: "#6d3b7d", shade: "#4c2559" },
  { main: "#262320", shade: "#141210" },
] as const;

function hairFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return PIXEL_HAIRS[h % PIXEL_HAIRS.length]!;
}

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
}: {
  name: string;
  workLabel: WorkLabel;
  activity?: ChibiActivity;
  facing?: ChibiFacing;
  walking?: boolean;
  stride?: 0 | 1;
  size?: number;
  executive?: boolean;
}) {
  const p = personaFor(name);
  const hair = hairFor(name);
  const kind = presenceKindOf(workLabel);

  const isDirector = executive || activity === "director";
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
        {/* Hair */}
        <rect x="4" y="1" width="8" height="2" fill={hair.main} />
        <rect x="3" y="2" width="10" height="5" fill={hair.main} />
        <rect x="3" y="5" width="2" height="4" fill={hair.shade} />
        <rect x="11" y="5" width="2" height="4" fill={hair.shade} />
        {p.hairStyle === 2 && <rect x="3" y="7" width="10" height="3" fill={hair.shade} />}

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

        {/* Glasses accessory */}
        {p.accessory === 1 && (
          <>
            <rect x={4 + lookDx} y="5" width="3" height="2" stroke="#1e1b24" strokeWidth="0.6" fill="none" />
            <rect x={9 + lookDx} y="5" width="3" height="2" stroke="#1e1b24" strokeWidth="0.6" fill="none" />
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
        padding: "2px 7px",
        borderRadius: "6px",
        backgroundColor: "rgba(24, 24, 31, 0.88)",
        color: "#ffffff",
        fontSize: "10.5px",
        fontWeight: 600,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        maxWidth: "188px",
        boxShadow: selected ? "0 0 0 2px #6366f1, 0 2px 6px rgba(0, 0, 0, 0.28)" : "0 1px 3px rgba(0, 0, 0, 0.22)",
      }}
    >
      <span style={{ width: "6px", height: "6px", borderRadius: "9999px", backgroundColor: dotColor, flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      {suffix && (
        <span style={{ padding: "0 4px", borderRadius: "4px", backgroundColor: "rgba(255,255,255,0.16)", fontSize: "9.5px", fontWeight: 700 }}>
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
          boxShadow: "0 2px 6px rgba(15, 23, 42, 0.1)",
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
    <svg width="116" height="46" viewBox="0 0 58 23" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0, pointerEvents: "none" }}>
      {/* Executive high-back chair top behind desk */}
      <rect x="24" y="0" width="10" height="5" fill="#1e3a5f" />
      <rect x="25" y="1" width="8" height="3" fill="#2d5282" />
      {/* Drop shadow */}
      <rect x="3" y="18" width="52" height="3" fill="#1e293b" opacity="0.14" />
      {/* Curved executive light desk */}
      <rect x="4" y="6" width="50" height="10" fill="#cbd5e1" />
      <rect x="3" y="4" width="52" height="5" fill="#f1f5f9" />
      <rect x="5" y="10" width="48" height="6" fill="#94a3b8" />
      <rect x="6" y="11" width="46" height="4" fill="#e2e8f0" />
      {/* Dual wide monitors */}
      <rect x="17" y="1" width="11" height="6" fill="#1e293b" />
      <rect x="18" y="2" width="9" height="4" fill="#38bdf8" opacity="0.85" />
      <rect x="30" y="1" width="11" height="6" fill="#1e293b" />
      <rect x="31" y="2" width="9" height="4" fill="#818cf8" opacity="0.85" />
      {/* Lamp & Coffee cup on desk */}
      <rect x="7" y="2" width="4" height="4" fill="#f59e0b" />
      <rect x="8" y="6" width="2" height="1" fill="#475569" />
      <rect x="47" y="5" width="3" height="3" fill="#0f766e" />
      {/* Gold/Dark Nameplate */}
      <rect x="23" y="12" width="12" height="2" fill="#1e293b" />
      {/* Guest chair in front */}
      <rect x="42" y="18" width="8" height="4" fill="#3b82f6" />
      <rect x="43" y="19" width="6" height="2" fill="#60a5fa" />
    </svg>
  );
}

export function PixelPantryLoungeSvg() {
  return (
    <svg width="212" height="60" viewBox="0 0 106 30" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0, maxWidth: "100%" }}>
      {/* Counter & Espresso machine (top-left) */}
      <rect x="2" y="4" width="30" height="8" fill="#d6b48a" />
      <rect x="2" y="2" width="30" height="4" fill="#edd3b1" />
      <rect x="5" y="0" width="8" height="4" fill="#334155" />
      <rect x="6" y="1" width="4" height="2" fill="#94a3b8" />
      <rect x="16" y="2" width="3" height="2" fill="#f8fafc" />
      <rect x="20" y="2" width="3" height="2" fill="#fb7185" />
      {/* Classic blue Water Cooler */}
      <rect x="34" y="4" width="6" height="9" fill="#e2e8f0" />
      <rect x="35" y="0" width="4" height="4" fill="#38bdf8" />
      <rect x="36" y="6" width="2" height="2" fill="#0284c7" />

      {/* Warm Cozy Sofa + Armchair + Round Coffee Table (center) */}
      <rect x="48" y="12" width="24" height="8" fill="#d97742" />
      <rect x="50" y="13" width="20" height="5" fill="#f59e6c" />
      <rect x="48" y="12" width="3" height="8" fill="#b45324" />
      <rect x="69" y="12" width="3" height="8" fill="#b45324" />
      {/* Round table & snacks */}
      <rect x="54" y="22" width="12" height="6" fill="#9a6b42" />
      <rect x="55" y="21" width="10" height="2" fill="#c99361" />
      <rect x="58" y="21" width="4" height="1.5" fill="#f8fafc" />

      {/* Mini Green Ping-Pong / Break Table (right) */}
      <rect x="80" y="7" width="22" height="12" fill="#15803d" />
      <rect x="81" y="8" width="20" height="10" fill="#22c55e" />
      <rect x="80" y="12" width="22" height="1.5" fill="#f8fafc" />
      <rect x="81" y="19" width="3" height="3" fill="#334155" />
      <rect x="98" y="19" width="3" height="3" fill="#334155" />
      {/* Potted bamboo / indoor plant */}
      <rect x="96" y="23" width="6" height="5" fill="#8b552c" />
      <rect x="95" y="19" width="8" height="5" fill="#16a34a" />
      <rect x="97" y="17" width="4" height="3" fill="#4ade80" />
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
    <svg width="74" height="30" viewBox="0 0 44 18" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0, pointerEvents: "none" }}>
      {/* Ergonomic dark swivel chair peeking */}
      <rect x="17" y="1" width="10" height="4" fill="#334155" />
      <rect x="18" y="2" width="8" height="2" fill="#475569" />

      {/* Drop shadow */}
      <rect x="2" y="15" width="40" height="2" fill="#1e293b" opacity="0.14" />

      {/* Clean Gather-style light oak/white tabletop */}
      <rect x="2" y="7" width="40" height="8" fill="#cbd5e1" />
      <rect x="1" y="5" width="42" height="4" fill="#f8fafc" />
      <rect x="2" y="9" width="40" height="6" fill="#94a3b8" />
      <rect x="3" y="10" width="38" height="4" fill="#e2e8f0" />

      {/* Keyboard & pad */}
      <rect x="16" y="7" width="12" height="2" fill="#475569" />
      <rect x="6" y="5" width="4" height="3" fill="#fef3c7" />
      <rect x="35" y="5" width="3" height="3" fill="#0d9488" />

      {/* Spinning pen on tabletop if penSpinning */}
      {penSpinning && (
        <g style={{ transformOrigin: "31.5px 7.5px", animationName: "orbit-pen-spin", animationDuration: "1.1s", animationIterationCount: "infinite", animationTimingFunction: "linear" }}>
          <rect x="29" y="7" width="5" height="1" fill="#4f46e5" />
          <rect x="33" y="7" width="1.2" height="1" fill="#f59e0b" />
        </g>
      )}

      {/* Sleek monitor */}
      <rect x="16" y="1" width="12" height="6" fill="#1e293b" />
      <rect x="17" y="2" width="10" height="4" fill={screenBg} />
      {occupied && kind === "working" ? (
        <>
          <rect x="18" y="3" width="6" height="1" fill={screenAccent} />
          <rect
            x="18"
            y="4.5"
            width="4"
            height="1"
            fill="#c7d2fe"
            style={{ animationName: "orbit-load-bar", animationDuration: "1.2s", animationIterationCount: "infinite" }}
          />
        </>
      ) : (
        <rect x="19" y="3.5" width="6" height="1" fill={screenAccent} opacity="0.85" />
      )}
      <rect x="20" y="7" width="4" height="1" fill="#475569" />
    </svg>
  );
}

export function PixelEmptyDeskClusterSvg() {
  return (
    <svg width="146" height="46" viewBox="0 0 73 23" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      {/* Desk 1 */}
      <rect x="4" y="4" width="8" height="3" fill="#475569" />
      <rect x="1" y="7" width="26" height="8" fill="#cbd5e1" />
      <rect x="0" y="6" width="28" height="3" fill="#f1f5f9" />
      <rect x="9" y="3" width="10" height="5" fill="#1e293b" />
      <rect x="10" y="4" width="8" height="3" fill="#334155" />
      {/* Partition divider strip */}
      <rect x="30" y="4" width="2" height="12" fill="#94a3b8" />
      {/* Desk 2 */}
      <rect x="38" y="4" width="8" height="3" fill="#475569" />
      <rect x="35" y="7" width="26" height="8" fill="#cbd5e1" />
      <rect x="34" y="6" width="28" height="3" fill="#f1f5f9" />
      <rect x="43" y="3" width="10" height="5" fill="#1e293b" />
      <rect x="44" y="4" width="8" height="3" fill="#334155" />
      {/* Small plant */}
      <rect x="64" y="10" width="6" height="5" fill="#8b552c" />
      <rect x="63" y="6" width="8" height="5" fill="#22c55e" />
    </svg>
  );
}

export function PixelBookshelfSvg() {
  return (
    <svg width="34" height="36" viewBox="0 0 17 18" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <rect x="1" y="2" width="15" height="15" fill="#6b3e1d" />
      <rect x="2" y="3" width="13" height="5" fill="#3e2210" />
      <rect x="2" y="10" width="13" height="5" fill="#3e2210" />
      <rect x="3" y="4" width="2" height="4" fill="#ef4444" />
      <rect x="5" y="5" width="2" height="3" fill="#3b82f6" />
      <rect x="8" y="4" width="2" height="4" fill="#10b981" />
      <rect x="11" y="5" width="3" height="3" fill="#f59e0b" />
      <rect x="3" y="11" width="3" height="4" fill="#8b5cf6" />
      <rect x="7" y="12" width="2" height="3" fill="#ec4899" />
      <rect x="10" y="11" width="4" height="4" fill="#14b8a6" />
      <rect x="12" y="0" width="3" height="2" fill="#38bdf8" />
      <rect x="3" y="0" width="3" height="2" fill="#22c55e" />
    </svg>
  );
}

export function PixelPlantSvg({ variant = "autumn" }: { variant?: "autumn" | "green" }) {
  const leafDark = variant === "autumn" ? "#c2410c" : "#15803d";
  const leafMid = variant === "autumn" ? "#ea580c" : "#22c55e";
  const leafBright = variant === "autumn" ? "#fb923c" : "#86efac";

  return (
    <svg width="26" height="30" viewBox="0 0 14 16" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <rect x="3" y="13" width="8" height="2" fill="#2d1b10" opacity="0.2" />
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
