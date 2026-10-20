// A JSON value a page received, read field by field with its type CHECKED -- never `as` the shape the
// page hoped for. What arrives over a stream is a string the browser parsed; nothing vouches for it.

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const fieldOf = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

/** A non-empty string, or null. */
export const stringOf = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** A finite number, or null. */
export const numberOf = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** JSON text, parsed; anything that does not parse is null rather than a thrown error. */
export function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
