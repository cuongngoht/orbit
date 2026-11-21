// A PostgreSQL database of its own for each test: created empty on the server ORBIT_WEB_TEST_DATABASE_URL names (a
// role that may create databases, with pgvector installed on the server), migrated by whatever the test starts, and
// dropped afterwards. Tests never share a database, and never fall back to anything but PostgreSQL.
//
//   ORBIT_WEB_TEST_DATABASE_URL=postgres://orbit:orbit@127.0.0.1:55432/orbit
//
// `node scripts/test-db.mjs` starts such a server in Docker (the pinned pgvector image) and prints the line to export.
import { randomBytes } from "node:crypto";
import pg from "pg";

export interface TestDatabase {
  url: string;
  name: string;
  drop(): Promise<void>;
}

export function testServerUrl(): string {
  const url = process.env.ORBIT_WEB_TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("These tests need PostgreSQL with pgvector: set ORBIT_WEB_TEST_DATABASE_URL to a server a test may create databases on (node scripts/test-db.mjs starts one in Docker).");
  }
  return url;
}

const withDatabase = (url: string, name: string): string => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: testServerUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `orbit_test_${randomBytes(6).toString("hex")}`;
  await admin((c) => c.query(`CREATE DATABASE ${name}`));
  return {
    name,
    url: withDatabase(testServerUrl(), name),
    drop: () => admin(async (c) => void (await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))),
  };
}
