// THE ONE WAY RESEARCH READS THE WEB: a bounded GET of one URL a person gave, made by the server itself (never a shell,
// never a browser), for a snapshot of a page. Before every connection -- the first and each redirect, at most five --
// the URL is held to the rules again: http or https, no user name or password, and an address the policy allows,
// which by default is the public internet on the web's own ports (80, 443) and nothing else: never this host, loopback,
// link-local (the cloud metadata address among them), the private, shared or reserved ranges. Every address the name
// resolves to must be allowed, and the connection is made to the address that was checked -- the name is not looked up
// a second time, so a DNS answer that changes between the check and the connection (DNS rebinding) reaches nothing. No
// cookie, credential or proxy is used; the answer's type must be one research reads; its size and the time it may take
// are bounded.
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { networkInterfaces } from "node:os";
import { ORBIT_WEB_VERSION } from "@orbit-web/contracts";
import { forbiddenAddress } from "../../../infra/egress/proxy.js";
import { readableContentType } from "./detect.js";

export interface AddressPolicy {
  allows(address: string, port: number): boolean;
}

export const URL_ADDRESS_POLICY = Symbol("URL_ADDRESS_POLICY");

const WEB_PORTS = new Set([80, 443]);

const ownAddresses = (): Set<string> => new Set(Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((i) => (i.address.startsWith("::ffff:") ? i.address.slice(7) : i.address))));

// The default: the public internet, on the web's own ports.
export const publicWebPolicy = (): AddressPolicy => {
  const own = ownAddresses();
  return { allows: (address, port) => WEB_PORTS.has(port) && !forbiddenAddress(address, own) };
};

export class FetchError extends Error {}

export interface Fetched {
  finalUrl: string;
  contentType: string | null;
  bytes: Buffer;
  fetchedAt: string;
}

export interface FetchOptions {
  maxBytes: number;
  timeoutMs: number;
  policy: AddressPolicy;
  maxRedirects?: number;
  resolve?: (host: string) => Promise<string[]>;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const resolveAll = async (host: string): Promise<string[]> => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

// Where this hop may connect: its one checked address, and its port.
async function target(url: URL, o: FetchOptions): Promise<{ address: string; family: 4 | 6; port: number }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("Only http and https URLs are read.");
  if (url.username !== "" || url.password !== "") throw new FetchError("A URL with a user name or password in it is never fetched.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  let addresses: string[];
  try {
    addresses = isIP(host) !== 0 ? [host] : await (o.resolve ?? resolveAll)(host);
  } catch {
    throw new FetchError(`${host} does not resolve.`);
  }
  if (addresses.length === 0) throw new FetchError(`${host} does not resolve.`);
  const refused = addresses.find((a) => !o.policy.allows(a, port));
  if (refused !== undefined) throw new FetchError(`${host}:${port} is not on the public internet's web ports (it resolves to ${refused}): research never fetches it.`);
  const address = addresses[0] as string;
  return { address, family: isIP(address) === 6 ? 6 : 4, port };
}

// The connection goes to the checked address, whatever the name resolves to now.
const pinned =
  (address: string, family: 4 | 6): LookupFunction =>
  (_host, options, callback) => {
    if ((options as { all?: boolean }).all === true) (callback as (err: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
    else (callback as (err: null, a: string, f: number) => void)(null, address, family);
  };

function get(url: URL, to: { address: string; family: 4 | 6; port: number }, deadline: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: to.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        lookup: pinned(to.address, to.family),
        headers: { "user-agent": `OrbitWeb-Research/${ORBIT_WEB_VERSION}`, accept: "text/html,application/xhtml+xml,application/pdf,text/plain,text/markdown;q=0.9,*/*;q=0.1", "accept-encoding": "identity" },
      },
      resolve,
    );
    req.setTimeout(Math.max(1, deadline - Date.now()), () => req.destroy(new FetchError("The page took too long to answer.")));
    req.on("error", (err) => reject(err instanceof FetchError ? err : new FetchError(`The page could not be reached (${(err as { code?: string }).code ?? err.message}).`)));
    req.end();
  });
}

function body(res: IncomingMessage, maxBytes: number, deadline: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(res.headers["content-length"] ?? Number.NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      return reject(new FetchError(`The page is larger than research reads (${Math.round(maxBytes / 1_048_576)} MB).`));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => res.destroy(new FetchError("The page took too long to send.")), Math.max(1, deadline - Date.now()));
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) res.destroy(new FetchError(`The page is larger than research reads (${Math.round(maxBytes / 1_048_576)} MB).`));
      else chunks.push(chunk);
    });
    res.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    res.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof FetchError ? err : new FetchError("The page's answer was cut off."));
    });
  });
}

export async function fetchUrl(raw: string, o: FetchOptions): Promise<Fetched> {
  const deadline = Date.now() + o.timeoutMs;
  let url = new URL(raw);
  for (let hop = 0; hop <= (o.maxRedirects ?? 5); hop += 1) {
    const res = await get(url, await target(url, o), deadline);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (REDIRECTS.has(status) && typeof location === "string") {
      res.destroy();
      url = new URL(location, url);
      continue;
    }
    if (status < 200 || status > 299) {
      res.destroy();
      throw new FetchError(`The page answered HTTP ${status}.`);
    }
    const contentType = typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : null;
    if (!readableContentType(contentType)) {
      res.destroy();
      throw new FetchError(`The page answered with ${contentType}, which research does not read (it reads web pages, PDF, Word, text and Markdown).`);
    }
    return { finalUrl: url.toString(), contentType, bytes: await body(res, o.maxBytes, deadline), fetchedAt: new Date().toISOString() };
  }
  throw new FetchError("The page redirected more than five times.");
}
