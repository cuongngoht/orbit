// An ACCESS LINK: `https://<this Orbit Web>/#access=<token>` hands the page this Orbit Web's access token (token mode),
// so a person given the link only clicks it. The token sits in the fragment, which a browser never sends to a server
// nor puts in a Referer; the page takes it -- at start, and whenever a link changes only the fragment of a page already
// open (no reload then) -- and removes it from the address bar and the history entry before anything else reads the
// URL. It is kept in memory only until the access page has traded it for its cookie.

const FRAGMENT = /^#access=([A-Za-z0-9._~-]{16,512})$/;

type Listener = (token: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

// Reads `#access=…` from the address, keeps the token, leaves the URL without it, and tells whoever waits for one.
export function takeAccessLink(location: Location = window.location, history: History = window.history): void {
  const match = FRAGMENT.exec(location.hash);
  if (match === null) return;
  const token = match[1] ?? null;
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  if (token === null) return;
  pending = token;
  for (const listener of listeners) listener(token);
}

// A link opened over a page already showing Orbit Web changes only the fragment, which reloads nothing: watched for here,
// before the page's own routes read the fragment.
export function watchAccessLinks(target: Window = window): () => void {
  const onChange = () => takeAccessLink(target.location, target.history);
  target.addEventListener("hashchange", onChange);
  return () => target.removeEventListener("hashchange", onChange);
}

// Called with each token a link brings while the access page is open.
export function onAccessLink(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The token an access link brought, if it has not been traded yet.
export const accessLinkToken = (): string | null => pending;

// Traded (or refused): it is not kept any longer.
export function forgetAccessLink(): void {
  pending = null;
}
