// An ACCESS LINK: `https://<this Orbit Web>/#access=<token>` hands the page this Orbit Web's access token (token mode),
// so a person given the link only clicks it. The token sits in the fragment, which a browser never sends to a server
// nor puts in a Referer; the page takes it once, at start, and removes it from the address bar and the history entry
// before anything else reads the URL. It is kept in memory only until the access page has traded it for its cookie.

const FRAGMENT = /^#access=([A-Za-z0-9._~-]{16,512})$/;

let pending: string | null = null;

// Reads `#access=…` from the address once, keeps the token, and leaves the URL without it.
export function takeAccessLink(location: Location = window.location, history: History = window.history): void {
  const match = FRAGMENT.exec(location.hash);
  if (match === null) return;
  pending = match[1] ?? null;
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
}

// The token an access link brought, if it has not been traded yet.
export const accessLinkToken = (): string | null => pending;

// Traded (or refused): it is not kept any longer.
export function forgetAccessLink(): void {
  pending = null;
}
