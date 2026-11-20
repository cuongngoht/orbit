// Reading research rows: every column through one of these, so a NULL is null and a number is a number.
export type Row = Record<string, unknown>;

export const str = (v: unknown): string => String(v);
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown): number => Number(v);
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const bool = (v: unknown): boolean => Number(v) === 1;
export const now = (): string => new Date().toISOString();
