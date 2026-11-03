import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "../db/schema";

/**
 * The database handle shared by all server code. Both hosts use SQLite:
 * Cloudflare D1 (async driver) and better-sqlite3 on Node (sync driver).
 * Drizzle queries are awaitable on both, so server code always `await`s.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = BaseSQLiteDatabase<"sync" | "async", any, typeof schema>;
