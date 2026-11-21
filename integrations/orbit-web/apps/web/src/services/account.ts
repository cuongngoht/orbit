// THIS BROWSER'S SESSION, as the page holds it: the session itself is an HttpOnly cookie the page cannot read; what the
// page keeps is the session's CSRF token, which every change carries (services/api.ts, services/upload.ts), and the
// account it is for. Read from the API's own answer (GET /api/claude/status, POST /api/claude/session), never assumed.
import type { BrowserSession } from "@orbit-web/contracts";

let current: BrowserSession | null = null;

// What the API said this browser's session is (null: none).
export function rememberSession(session: BrowserSession | null): void {
  current = session;
}

export const sessionCsrf = (): string | null => current?.csrfToken ?? null;

export const sessionAccount = (): string | null => current?.accountId ?? null;
