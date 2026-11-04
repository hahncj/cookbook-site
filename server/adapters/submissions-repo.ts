import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { RevisionSnapshot } from "../core/history";
import type { EntryInput } from "../core/recipes";
import type { Submission, SubmissionsRepository } from "../core/submissions";
import { settings, submissions } from "../db/app-schema";
import { atomic, changesOf } from "./atomic";
import type { Database } from "./db";

type Row = typeof submissions.$inferSelect;

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function toSubmission(row: Row): Submission {
  return {
    ...row,
    proposed: parseJson<EntryInput>(row.proposed),
    baseSnapshot: row.baseSnapshot === null ? null : parseJson<RevisionSnapshot>(row.baseSnapshot),
  };
}

export function createSubmissionsRepository(db: Database): SubmissionsRepository {
  return {
    async findByIdempotencyKey(credentialId, key) {
      const [row] = await db
        .select()
        .from(submissions)
        .where(and(eq(submissions.credentialId, credentialId), eq(submissions.idempotencyKey, key)))
        .limit(1);
      return row ? toSubmission(row) : null;
    },

    async insert(submission) {
      await atomic(db, [() => db.insert(submissions).values(submission).onConflictDoNothing()]);
      // The unique (credential, key) index decides a race between two retries.
      const [row] = await db
        .select()
        .from(submissions)
        .where(and(eq(submissions.credentialId, submission.credentialId), eq(submissions.idempotencyKey, submission.idempotencyKey)))
        .limit(1);
      return toSubmission(row!);
    },

    async get(id) {
      const [row] = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
      return row ? toSubmission(row) : null;
    },

    async listByStatus(statuses, limit) {
      const rows = await db
        .select()
        .from(submissions)
        .where(inArray(submissions.status, statuses))
        .orderBy(desc(submissions.createdAt))
        .limit(limit);
      return rows.map(toSubmission);
    },

    async countPending() {
      const [row] = await db.select({ n: count() }).from(submissions).where(inArray(submissions.status, ["pending", "conflict"]));
      return row?.n ?? 0;
    },

    async decide(id, from, update) {
      const [result] = await atomic(db, [
        () =>
          db
            .update(submissions)
            .set(update)
            .where(and(eq(submissions.id, id), inArray(submissions.status, from))),
      ]);
      return changesOf(result) > 0;
    },

    async getSetting(key) {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
      return row?.value ?? null;
    },

    async setSetting(key, value, meta) {
      await atomic(db, [
        () =>
          db
            .insert(settings)
            .values({ key, value, updatedAt: meta.now, updatedBy: meta.userId })
            .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: meta.now, updatedBy: meta.userId } }),
      ]);
    },
  };
}
