// What a test depends on, CHECKED rather than asserted: a missing element fails
// here with a sentence saying which one, instead of a non-null `!` turning it
// into a TypeError three lines later, and an element of the wrong class is
// refused instead of cast.
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}, and there was none`);
  return value;
}

export function elementOf<E extends Element>(value: Element | null, kind: { new (): E; readonly prototype: E }, what: string): E {
  if (!(value instanceof kind)) throw new Error(`expected ${what} to be a ${kind.name}`);
  return value;
}

// A JSON body a fake server received, read field by field with its type
// checked -- never `as` the shape a test hoped for. The guards are the page's own (shared/json.ts).
export { fieldOf, isRecord } from "../shared/json";

export const textOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export const textsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
