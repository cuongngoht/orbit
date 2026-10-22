// Fetching a catalog from the link a PERSON typed into the Security page -- the one place Orbit ever
// fetches one: never an agent, never the CLI, and only on that person's action. https only, with no
// credentials in the link, no redirect followed, at most a megabyte and ten seconds; what comes back
// is parsed as JSON and judged like any other catalog, never run.
//
// And only from a PUBLIC address. The host is resolved first, and every address it resolves to must
// be outside this machine, a private or link-local network (a cloud's metadata address among them),
// carrier-grade NAT, unique-local, multicast and the documentation ranges -- one that is not refuses
// the link before anything is sent. The connection is then PINNED to the address that was checked,
// so a name that resolves to something else a moment later (DNS rebinding) reaches nothing new; the
// certificate is still held to the name. What went wrong is said in Orbit's own words, never the
// upstream's status or body.
import { lookup as dnsLookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { parsedCatalog } from "../core.mjs";
import { invalid, unavailable } from "../errors.mjs";

export const MAX_CATALOG_BYTES = 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;

const NOT_PUBLIC = [
  ["ipv4", [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]],
  ["ipv6", [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]],
];

// node's BlockList holds an IPv4-mapped IPv6 address (::ffff:a.b.c.d) to the IPv4 rules, in both
// directions -- so no ::ffff:0:0/96 rule is written (it would refuse every IPv4 address), and a
// mapped address is still refused wherever its IPv4 address would be.

const BLOCKED = blockListOf(NOT_PUBLIC);

function blockListOf(rows) {
  const list = new BlockList();
  for (const [type, nets] of rows) for (const [net, bits] of nets) list.addSubnet(net, bits, type);
  return list;
}

export const isPublicAddress = (address) => (isIP(address) ? !BLOCKED.check(address, isIP(address) === 4 ? "ipv4" : "ipv6") : false);

const REFUSED = "a catalog is fetched from an https link with no credentials in it, on a public address — never this machine, a private or link-local network, or a cloud's metadata address";

function targetOf(url) {
  const u = urlOf(url);
  if (!u || u.protocol !== "https:" || u.username || u.password || String(url).length > 2048) throw invalid("SECURITY_CATALOG_URL", REFUSED);
  return u;
}

function urlOf(url) {
  try { return new URL(String(url)); }
  catch { return null; }
}

// -> the parsed document. A link that answers anything but 200, too much, or too late is the
// network's answer, never the catalog's: 503, and nothing is kept. What it answered is then judged
// as a catalog like any other: not JSON is the document's fault, a 400.
export async function fetchCatalog(ctx, url) {
  const target = targetOf(url);
  const address = await publicAddressOf(ctx, target.hostname);
  return parsedCatalog(await fetchedText(ctx, target, address), MAX_CATALOG_BYTES);
}

// Every address the name resolves to must be public: one private answer among public ones is how a
// name is made to reach inside.
async function publicAddressOf(ctx, hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const found = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolvedAll(ctx, host);
  if (!found.length || !found.every((a) => isPublicAddress(a.address))) throw invalid("SECURITY_CATALOG_URL", REFUSED);
  return found[0];
}

async function resolvedAll(ctx, host) {
  try { return await (ctx.world.lookup ?? ((h) => dnsLookup(h, { all: true, verbatim: true })))(host); }
  catch { throw unavailable("SECURITY_CATALOG_FETCH", `the catalog could not be fetched from ${host} — its name did not resolve`); }
}

async function fetchedText(ctx, target, address) {
  try { return ctx.world.fetch ? await seamed(ctx.world.fetch, target) : await pinnedGet(target, address); }
  catch (e) { throw unavailable("SECURITY_CATALOG_FETCH", `the catalog could not be fetched from ${target.hostname} — ${e?.orbit ?? "the link did not answer with a catalog"}`); }
}

const failed = (orbit) => Object.assign(new Error(orbit), { orbit });

// The injected fetch a test hands in: the same bounds, the same words.
async function seamed(fetchFn, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await bodyOf(await fetchFn(target.href, { redirect: "error", signal: controller.signal, headers: { accept: "application/json" } })); }
  finally { clearTimeout(timer); }
}

async function bodyOf(res) {
  if (res.status !== 200) throw failed("it did not answer with the document");
  const reader = res.body?.getReader?.();
  return reader ? bounded(reader, [], 0) : capped(await res.text());
}

const capped = (text) => (Buffer.byteLength(String(text)) > MAX_CATALOG_BYTES ? tooBig() : String(text));

function tooBig() {
  throw failed(`it is larger than ${MAX_CATALOG_BYTES} bytes`);
}

async function bounded(reader, chunks, size) {
  const { done, value } = await reader.read();
  if (done) return Buffer.concat(chunks).toString("utf8");
  if (size + value.length > MAX_CATALOG_BYTES) return reader.cancel().then(tooBig);
  return bounded(reader, [...chunks, Buffer.from(value)], size + value.length);
}

// One GET, connected to the address that was checked and no other, its certificate held to the name;
// no redirect is followed.
function pinnedGet(target, address) {
  return new Promise((resolve, reject) => {
    const req = request(target, { method: "GET", headers: { accept: "application/json" }, timeout: FETCH_TIMEOUT_MS, lookup: pinnedLookup(address) }, (res) => collected(res, resolve, reject));
    req.on("timeout", () => req.destroy(failed(`it did not answer within ${FETCH_TIMEOUT_MS / 1000} s`)));
    req.on("error", reject);
    req.end();
  });
}

const pinnedLookup = (address) => (hostname, opts, cb) => (opts?.all ? cb(null, [{ address: address.address, family: address.family }]) : cb(null, address.address, address.family));

function collected(res, resolve, reject) {
  if (res.statusCode !== 200) return void (res.resume(), reject(failed("it did not answer with the document")));
  const kept = { chunks: [], size: 0 };
  res.on("data", (c) => keptChunk(res, kept, c));
  res.on("end", () => resolve(Buffer.concat(kept.chunks).toString("utf8")));
  res.on("error", reject);
}

function keptChunk(res, kept, c) {
  kept.size += c.length;
  if (kept.size > MAX_CATALOG_BYTES) return void res.destroy(failed(`it is larger than ${MAX_CATALOG_BYTES} bytes`));
  kept.chunks.push(c);
}
