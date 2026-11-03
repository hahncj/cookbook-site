import type { Database } from "./db";

/**
 * Runs statements all-or-nothing on either host:
 * - Cloudflare D1: `db.batch([...])` (D1 runs a batch as one transaction).
 * - better-sqlite3 (Node host, tests): a synchronous transaction.
 * Each statement is a thunk so nothing executes before the transaction starts.
 * Returns each statement's result (for reading affected-row counts).
 */
export async function atomic(db: Database, statements: Array<() => unknown>): Promise<unknown[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  if (typeof anyDb.batch === "function") {
    return anyDb.batch(statements.map((build) => build()));
  }
  const results: unknown[] = [];
  anyDb.transaction(() => {
    for (const build of statements) {
      const query = build() as { run?: () => unknown } | undefined;
      results.push(typeof query?.run === "function" ? query.run() : query);
    }
  });
  return results;
}

/** Affected-row count from a D1 result ({ meta: { changes } }) or better-sqlite3 result ({ changes }). */
export function changesOf(result: unknown): number {
  const value = result as { changes?: number; meta?: { changes?: number } } | undefined;
  return value?.meta?.changes ?? value?.changes ?? 0;
}
