// Bridge between the embedded Orbit Web SPA and the native iOS Flutter shell (flutter_inappwebview).
// Outside the mobile shell, every helper is a safe no-op returning false or null.
import { MOBILE_EXCHANGE_INVALID, type AuthStatus } from "@orbit-web/contracts";
import { ApiError, send } from "./api";

export interface MobileBootstrapPayload {
  exchangeCode?: string;
  accessToken?: string;
}

export interface MobileBridgeResult {
  status: AuthStatus | null;
  accessApplied: boolean;
}

interface FlutterInAppWebViewBridge {
  callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    flutter_inappwebview?: FlutterInAppWebViewBridge;
  }
}

function bridgeOf(): FlutterInAppWebViewBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.flutter_inappwebview;
  return typeof bridge?.callHandler === "function" ? bridge : null;
}

function parsePayload(raw: unknown): MobileBootstrapPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const exchangeCode = typeof rec.exchangeCode === "string" && rec.exchangeCode.trim().length > 0 ? rec.exchangeCode.trim() : undefined;
  const accessToken = typeof rec.accessToken === "string" && rec.accessToken.trim().length > 0 ? rec.accessToken.trim() : undefined;
  if (exchangeCode === undefined && accessToken === undefined) return null;
  return { ...(exchangeCode !== undefined ? { exchangeCode } : {}), ...(accessToken !== undefined ? { accessToken } : {}) };
}

export function isMobileShell(): boolean {
  return bridgeOf() !== null;
}

export async function takeMobileBootstrap(): Promise<MobileBootstrapPayload | null> {
  const bridge = bridgeOf();
  if (bridge === null) return null;
  try {
    return parsePayload(await bridge.callHandler("takeBootstrap"));
  } catch {
    return null;
  }
}

export async function requestMobileRefresh(): Promise<MobileBootstrapPayload | null> {
  const bridge = bridgeOf();
  if (bridge === null) return null;
  try {
    return parsePayload(await bridge.callHandler("onAuthExpired"));
  } catch {
    return null;
  }
}

export function notifyMobileReady(): void {
  const bridge = bridgeOf();
  if (bridge === null) return;
  void bridge.callHandler("onWebReady").catch(() => undefined);
}

export function notifyMobileSignedOut(everywhere: boolean): void {
  const bridge = bridgeOf();
  if (bridge === null) return;
  void bridge.callHandler("onSignedOut", { everywhere }).catch(() => undefined);
}

export async function completeMobileBootstrap(payload: MobileBootstrapPayload): Promise<MobileBridgeResult> {
  let accessApplied = false;
  if (payload.accessToken !== undefined) {
    try {
      await send<void>("POST", "/api/access", { token: payload.accessToken });
      accessApplied = true;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 400)) throw err;
    }
  }
  if (payload.exchangeCode !== undefined) {
    const status = await send<AuthStatus>("POST", "/api/auth/mobile/exchange", { code: payload.exchangeCode });
    return { status, accessApplied };
  }
  return { status: null, accessApplied };
}

let inflightBridge: Promise<MobileBridgeResult | null> | null = null;

export function runMobileAuthBridge(): Promise<MobileBridgeResult | null> {
  if (inflightBridge !== null) return inflightBridge;
  inflightBridge = (async () => {
    const initial = await takeMobileBootstrap();
    if (initial !== null) {
      try {
        const done = await completeMobileBootstrap(initial);
        if (done.status !== null || done.accessApplied) return done;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === MOBILE_EXCHANGE_INVALID)) throw err;
      }
    }
    const refreshed = await requestMobileRefresh();
    if (refreshed === null) return null;
    return completeMobileBootstrap(refreshed);
  })().finally(() => {
    inflightBridge = null;
  });
  return inflightBridge;
}
