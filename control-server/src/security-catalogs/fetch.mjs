// Fetching a catalog from the link a PERSON typed into the Security page -- the one place Orbit ever
// fetches one: never an agent, never the CLI, and only on that person's action. https only, with no
// credentials in the link, no redirect followed, at most a megabyte and ten seconds; what comes back
// is parsed as JSON and judged like any other catalog, never run.
import { parsedCatalog } from "../core.mjs";
import { invalid, unavailable } from "../errors.mjs";

export const MAX_CATALOG_BYTES = 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;

function targetOf(url) {
  const u = urlOf(url);
  if (!u || u.protocol !== "https:" || u.username || u.password || String(url).length > 2048) throw invalid("SECURITY_CATALOG_URL", "a catalog is fetched from an https link with no credentials in it");
  return u.href;
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
  return parsedCatalog(await fetchedText(ctx, target), MAX_CATALOG_BYTES);
}

async function fetchedText(ctx, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await bodyOf(await (ctx.world.fetch ?? fetch)(target, { redirect: "error", signal: controller.signal, headers: { accept: "application/json" } })); }
  catch (e) { throw unavailable("SECURITY_CATALOG_FETCH", `the catalog could not be fetched from ${target} — ${String(e?.message ?? e).slice(0, 160)}`); }
  finally { clearTimeout(timer); }
}

async function bodyOf(res) {
  if (res.status !== 200) throw new Error(`it answered ${res.status}`);
  const reader = res.body?.getReader?.();
  return reader ? bounded(reader, [], 0) : capped(await res.text());
}

const capped = (text) => (Buffer.byteLength(String(text)) > MAX_CATALOG_BYTES ? tooBig() : String(text));

function tooBig() {
  throw new Error(`it is larger than ${MAX_CATALOG_BYTES} bytes`);
}

async function bounded(reader, chunks, size) {
  const { done, value } = await reader.read();
  if (done) return Buffer.concat(chunks).toString("utf8");
  if (size + value.length > MAX_CATALOG_BYTES) return reader.cancel().then(tooBig);
  return bounded(reader, [...chunks, Buffer.from(value)], size + value.length);
}
