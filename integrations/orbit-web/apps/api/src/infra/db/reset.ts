// A FRESH START (0.8.0 is Orbit Web's initial schema: nothing made by a development build is migrated). The named
// database's Orbit Web schemas are dropped -- only when the caller names that very database -- and Orbit Web makes them
// again at its next start (or `db.js reset` migrates at once). Asked for, Orbit Web's own rooms on disk are emptied too:
// the directories directly under its data root that it made, never anything it does not name, never through a link.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DataDirs } from "../../config/config.js";
import type { Db } from "./db.js";
import { SchemaError } from "./migrate.js";

// Every schema the initial migration makes (`orbit` holds the migrations' own record).
export const ORBIT_SCHEMAS = ["workforce", "governance", "research", "app", "orbit"] as const;

export async function resetSchemas(db: Db, confirm: string | null): Promise<{ database: string }> {
  const row = await db.one("SELECT current_database() AS name");
  const database = String(row?.name ?? "");
  if (confirm !== database) throw new SchemaError(`Refused: this drops every Orbit Web table of the database "${database}". Say so by naming it: --confirm=${database}`);
  await db.exec(`DROP SCHEMA IF EXISTS ${ORBIT_SCHEMAS.join(", ")} CASCADE`);
  return { database };
}

// The rooms Orbit Web keeps under its data root (each a directory directly under it), emptied. Returns their names.
export function emptyRooms(data: DataDirs): string[] {
  const rooms = Object.entries(data)
    .filter(([key, path]) => key !== "root" && typeof path === "string" && dirname(path) === data.root)
    .map(([key, path]) => [key, path] as const);
  rooms.push(["workforce", join(data.root, "workforce")]);
  for (const [, path] of rooms) rmSync(path, { recursive: true, force: true });
  return rooms.map(([key]) => key);
}
