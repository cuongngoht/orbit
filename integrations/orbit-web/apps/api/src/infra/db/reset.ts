// A FRESH START (0.8.0 is Orbit Web's initial schema: nothing made by a development build is migrated). The named
// database's Orbit Web schemas are dropped -- only when the caller names that very database -- and Orbit Web makes them
// again at its next start (or `db.js reset` migrates at once). Asked for, Orbit Web's own rooms on disk are emptied too --
// what it made, never the CLIs' own sign-ins of GitHub and Azure nor Orbit's store; each room is kept (its mode stays),
// its content removed, never through a link.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DataDirs } from "../../config/config.js";
import type { Db } from "./db.js";
import { ownedSchemas, SchemaError } from "./migrate.js";

// Every schema Orbit Web's migrations make (`orbit` holds the migrations' own record): read from the migrations, so a
// schema a later migration adds is dropped too. pgvector's `public` stays: the extension is the database's.
export const ORBIT_SCHEMAS: readonly string[] = ownedSchemas();

export async function resetSchemas(db: Db, confirm: string | null): Promise<{ database: string }> {
  const row = await db.one("SELECT current_database() AS name");
  const database = String(row?.name ?? "");
  if (confirm !== database) throw new SchemaError(`Refused: this drops every Orbit Web table of the database "${database}". Say so by naming it: --confirm=${database}`);
  await db.exec(`DROP SCHEMA IF EXISTS ${ORBIT_SCHEMAS.join(", ")} CASCADE`);
  return { database };
}

// The rooms that hold what Orbit Web made: chats' images and logs, sessions, workspaces, the repositories' copies,
// research objects, the AI connections' homes; and in the control room the connections' keys; and the office's room
// (desks, workspaces, artifacts).
export const RESET_ROOMS: readonly (keyof DataDirs)[] = ["app", "sessions", "workspaces", "repos", "research", "connections"];

// Empties each room (keeping the room itself). Returns the rooms, and how many items were removed from them.
export function emptyRooms(data: DataDirs): { rooms: string[]; removed: number } {
  const rooms = [...RESET_ROOMS.map((k) => data[k]), join(data.control, "credentials"), join(data.root, "workforce")];
  let removed = 0;
  for (const dir of rooms) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      rmSync(join(dir, name), { recursive: true, force: true });
      removed += 1;
    }
  }
  return { rooms, removed };
}
