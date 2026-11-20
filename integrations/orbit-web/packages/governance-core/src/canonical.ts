// ONE canonical form, so that two parties hashing the same value get the same hash: JSON with every object's keys in
// order, no undefined, no whitespace. A digest, a fingerprint and an audit hash are all taken over it.
//
// The hash itself is handed in: this package runs in a browser as well as in Node, and knows no crypto of its own.

// SHA-256 of a text, as lower-case hex.
export type Sha256 = (text: string) => string;

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return Object.fromEntries(keys.map((k) => [k, ordered(value[k])]));
}

export const canonicalJson = (value: unknown): string => JSON.stringify(ordered(value));

export const digestOf = (value: unknown, sha256: Sha256): string => sha256(canonicalJson(value));

export const unknownFields = (body: Record<string, unknown>, known: readonly string[], where = ""): string[] =>
  Object.keys(body)
    .filter((k) => !known.includes(k))
    .map((k) => `${where}${k} is not a known field`);

export const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });
