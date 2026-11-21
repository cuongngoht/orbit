// Reading research rows: every column through one of these, so a NULL is null and a number is a number. (PostgreSQL
// hands booleans back as booleans, times as ISO strings and bigints as numbers: infra/db/db.ts.)
export type { Row } from "../../../infra/db/db.js";

export const str = (v: unknown): string => String(v);
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown): number => Number(v);
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const bool = (v: unknown): boolean => v === true;
export const now = (): string => new Date().toISOString();
