// AI-tool submissions and the approval queue (M4). Pure logic: the database
// adapter implements SubmissionsRepository. The same functions back the MCP
// tools and the HTTP API, so both follow identical rules (AC-025).
import { z } from "zod";
import type { Actor, Catalog } from "./catalog";
import type { RevisionSnapshot } from "./history";
import { snapshotOfEntry } from "./history";
import type { Entry, EntryInput, FieldErrors } from "./recipes";
import { validateEntry } from "./recipes";

export type SubmissionStatus = "pending" | "applied" | "rejected" | "conflict";
export type SubmissionType = "create" | "update";

/** Who sent a submission: a connected AI tool, acting for the admin who authorized it. */
export interface Submitter {
  credentialKind: "oauth" | "api_key";
  /** OAuth client id, or API key id. Retry keys are unique per credential. */
  credentialId: string;
  clientName: string;
  /** The admin user the tool acts for. */
  userId: string;
}

export interface Submission {
  id: string;
  type: SubmissionType;
  status: SubmissionStatus;
  targetRecipeId: string | null;
  baseRevision: number | null;
  proposed: EntryInput;
  baseSnapshot: RevisionSnapshot | null;
  note: string | null;
  credentialKind: "oauth" | "api_key";
  credentialId: string;
  clientName: string;
  submittedBy: string;
  idempotencyKey: string;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  resultRecipeId: string | null;
  resultRevision: number | null;
  message: string | null;
}

export interface SubmissionsRepository {
  findByIdempotencyKey(credentialId: string, key: string): Promise<Submission | null>;
  /** Inserts unless the (credential, key) pair exists; returns the stored row either way. */
  insert(submission: Submission): Promise<Submission>;
  get(id: string): Promise<Submission | null>;
  listByStatus(statuses: SubmissionStatus[], limit: number): Promise<Submission[]>;
  countPending(): Promise<number>;
  /** Moves a submission from one of `from` to a decided state. Returns false if it was already decided. */
  decide(
    id: string,
    from: SubmissionStatus[],
    update: { status: SubmissionStatus; decidedAt: Date; decidedBy: string | null; resultRecipeId?: string | null; resultRevision?: number | null; message?: string | null },
  ): Promise<boolean>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, meta: { now: Date; userId: string }): Promise<void>;
}

// ---------- Input accepted from tools ----------

const text = (max: number) => z.string().max(max);
const ingredient = z.object({
  quantity: text(120).default("").describe("Amount and unit exactly as written, e.g. '1½ tbsp'. Empty if unknown — never guess."),
  item: text(480).describe("Ingredient and preparation, e.g. 'garlic, grated'."),
});

/** The recipe fields a tool may send. Names are part of the public integration contract. */
export const toolRecipeShape = {
  kind: z.enum(["recipe", "idea"]).default("recipe").describe("'idea' for an incomplete food or drink idea (only a title is required)."),
  title: text(200).describe("Recipe or idea title."),
  description: text(10_000).nullable().optional().describe("One or two sentences about the dish."),
  notes: text(10_000).nullable().optional().describe("Tips, substitutions, or context."),
  servings: text(120).nullable().optional().describe("Yield as written, e.g. 'Serves 4' or 'Makes 2 cups'."),
  prepTime: text(120).nullable().optional().describe("e.g. '10 min'."),
  cookTime: text(120).nullable().optional().describe("e.g. '1 hr 20 min'."),
  ingredients: z.array(ingredient).max(200).optional().describe("Ingredients in order."),
  steps: z.array(text(10_000)).max(200).optional().describe("Method steps in order, one instruction each."),
  sourceUrl: text(2_000).nullable().optional().describe("Link to where the recipe came from, if any."),
  sourceName: text(120).nullable().optional().describe("e.g. 'ChatGPT conversation' or a site name."),
  tags: z.array(text(60)).max(30).optional().describe("Short labels such as 'Weeknight' or 'Vegetarian'."),
};

export const toolRecipeSchema = z.object(toolRecipeShape);
/** For updates every field is optional; fields left out keep their current value. */
export const toolChangesSchema = z.object(toolRecipeShape).partial();
export type ToolRecipe = z.infer<typeof toolRecipeSchema>;
export type ToolChanges = z.infer<typeof toolChangesSchema>;

export const idempotencyKeySchema = text(100)
  .min(8)
  .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits, '.', '_', ':' or '-'")
  .describe("A unique id you generate for this submission (e.g. a UUID). Retrying with the same key never creates a duplicate.");

export const noteSchema = text(500).optional().describe("Optional short summary of what you're adding or changing, shown to the cookbook owner.");

function toEntryFields(changes: ToolChanges): Partial<Record<keyof EntryInput, unknown>> {
  const out: Partial<Record<keyof EntryInput, unknown>> = {};
  const map: [keyof ToolChanges, keyof EntryInput][] = [
    ["kind", "kind"],
    ["title", "title"],
    ["description", "description"],
    ["notes", "notes"],
    ["servings", "yieldText"],
    ["prepTime", "prepTime"],
    ["cookTime", "cookTime"],
    ["ingredients", "ingredients"],
    ["steps", "steps"],
    ["sourceUrl", "sourceUrl"],
    ["sourceName", "sourceName"],
    ["tags", "tags"],
  ];
  for (const [from, to] of map) if (changes[from] !== undefined) out[to] = changes[from];
  return out;
}

export function entryToInput(entry: Entry): EntryInput {
  return {
    kind: entry.kind,
    title: entry.title,
    description: entry.description,
    notes: entry.notes,
    yieldText: entry.yieldText,
    prepTime: entry.prepTime,
    cookTime: entry.cookTime,
    ingredients: entry.ingredients,
    steps: entry.steps,
    sourceUrl: entry.sourceUrl,
    sourceName: entry.sourceName,
    tags: entry.tags.map((t) => t.name),
    collectionIds: entry.collections.map((c) => c.id),
    photos: entry.photos,
  };
}

/** What a tool receives back. */
export type SubmitResult =
  | {
      status: SubmissionStatus;
      submissionId: string;
      recipeId: string | null;
      revision: number | null;
      message: string;
    }
  | { status: "conflict"; submissionId: null; recipeId: string; currentRevision: number; message: string }
  | { status: "validation_failed" | "not_found"; submissionId: null; errors?: FieldErrors; message: string };

export function describe(submission: Submission): Extract<SubmitResult, { submissionId: string }> {
  const messages: Record<SubmissionStatus, string> = {
    pending: "Waiting for the cookbook owner to approve it. Nothing changes until they do.",
    applied: "Saved in the cookbook.",
    rejected: "The cookbook owner rejected it. Nothing was changed.",
    conflict: submission.message ?? "The recipe changed before this could be applied. Read it again and send a new update.",
  };
  return {
    status: submission.status,
    submissionId: submission.id,
    recipeId: submission.resultRecipeId ?? submission.targetRecipeId,
    revision: submission.resultRevision,
    message: messages[submission.status],
  };
}

export const APPROVAL_SETTING = "approval_required";

export interface SubmissionsDeps {
  repo: SubmissionsRepository;
  catalog: Catalog;
  now: () => Date;
  newId: () => string;
}

export function createSubmissions({ repo, catalog, now, newId }: SubmissionsDeps) {
  async function approvalRequired() {
    return (await repo.getSetting(APPROVAL_SETTING)) !== "false"; // default on
  }

  function changeNote(submission: Pick<Submission, "clientName" | "note">) {
    return submission.note ? `${submission.clientName}: ${submission.note}` : `Sent by ${submission.clientName}`;
  }

  /** Applies a stored submission to the catalog and records the outcome. */
  async function apply(submission: Submission, decidedBy: string | null): Promise<Submission> {
    const actor: Actor = { userId: submission.submittedBy };
    const options = { origin: "ai" as const, changeNote: changeNote(submission) };
    const decidedAt = now();
    if (submission.type === "create") {
      const created = await catalog.create(submission.proposed, actor, options);
      const resultRecipeId = created.ok ? created.id : null;
      await repo.decide(submission.id, ["pending"], { status: "applied", decidedAt, decidedBy, resultRecipeId, resultRevision: 1 });
    } else {
      const result = await catalog.update(submission.targetRecipeId!, submission.baseRevision!, submission.proposed, actor, options);
      if (result.ok) {
        await repo.decide(submission.id, ["pending"], {
          status: "applied",
          decidedAt,
          decidedBy,
          resultRecipeId: submission.targetRecipeId,
          resultRevision: submission.baseRevision! + 1,
        });
      } else {
        await repo.decide(submission.id, ["pending"], {
          status: "conflict",
          decidedAt,
          decidedBy,
          message:
            result.reason === "conflict"
              ? "The recipe was edited after this update was sent, so it wasn't applied. Read the recipe again and send a new update."
              : "The recipe was deleted, so this update wasn't applied.",
        });
      }
    }
    return (await repo.get(submission.id))!;
  }

  async function store(submitter: Submitter, draft: Omit<Submission, "id" | "status" | "credentialKind" | "credentialId" | "clientName" | "submittedBy" | "createdAt" | "decidedAt" | "decidedBy" | "resultRecipeId" | "resultRevision" | "message">) {
    const submission: Submission = {
      ...draft,
      id: newId(),
      status: "pending",
      credentialKind: submitter.credentialKind,
      credentialId: submitter.credentialId,
      clientName: submitter.clientName,
      submittedBy: submitter.userId,
      createdAt: now(),
      decidedAt: null,
      decidedBy: null,
      resultRecipeId: null,
      resultRevision: null,
      message: null,
    };
    const stored = await repo.insert(submission);
    if (stored.id !== submission.id) return describe(stored); // a concurrent retry won the race
    // With approval off, valid submissions save right away (AC-014).
    const final = (await approvalRequired()) ? stored : await apply(stored, null);
    return describe(final);
  }

  return {
    approvalRequired,

    async setApprovalRequired(required: boolean, userId: string) {
      // Turning approval off affects future submissions only; pending ones stay pending (AC-032).
      await repo.setSetting(APPROVAL_SETTING, required ? "true" : "false", { now: now(), userId });
    },

    /** A new recipe or idea from a tool. */
    async submitNew(submitter: Submitter, payload: { recipe: unknown; idempotencyKey: string; note?: string | null }): Promise<SubmitResult> {
      const existing = await repo.findByIdempotencyKey(submitter.credentialId, payload.idempotencyKey);
      if (existing) return describe(existing); // retry: never a duplicate (AC-030)
      const parsed = toolRecipeSchema.safeParse(payload.recipe);
      if (!parsed.success) {
        return { status: "validation_failed", submissionId: null, message: parsed.error.issues.map((i) => `${i.path.join(".") || "recipe"}: ${i.message}`).join("; ") };
      }
      // Lists left out mean "none yet" (an idea can be just a title).
      const valid = validateEntry({ ingredients: [], steps: [], tags: [], ...toEntryFields(parsed.data), collectionIds: [], photos: [] });
      if (!valid.ok) return { status: "validation_failed", submissionId: null, errors: valid.errors, message: Object.values(valid.errors).join("; ") };
      return store(submitter, {
        type: "create",
        targetRecipeId: null,
        baseRevision: null,
        proposed: valid.value,
        baseSnapshot: null,
        note: payload.note?.trim() || null,
        idempotencyKey: payload.idempotencyKey,
      });
    },

    /**
     * An update to an existing entry. Only fields included in `changes` are
     * changed; everything else (including photos and collections) is kept.
     * A stale `expectedRevision` is refused instead of overwriting newer work (AC-031).
     */
    async submitUpdate(
      submitter: Submitter,
      payload: { recipeId: string; expectedRevision: number; changes: unknown; idempotencyKey: string; note?: string | null },
    ): Promise<SubmitResult> {
      const existing = await repo.findByIdempotencyKey(submitter.credentialId, payload.idempotencyKey);
      if (existing) return describe(existing);
      const entry = await catalog.get(payload.recipeId);
      if (!entry) return { status: "not_found", submissionId: null, message: "No recipe with that id." };
      if (entry.revision !== payload.expectedRevision) {
        return {
          status: "conflict",
          submissionId: null,
          recipeId: entry.id,
          currentRevision: entry.revision,
          message: `The recipe is now at revision ${entry.revision}, not ${payload.expectedRevision}. Read it again and resend your changes against the current revision.`,
        };
      }
      const parsed = toolChangesSchema.safeParse(payload.changes);
      if (!parsed.success) {
        return { status: "validation_failed", submissionId: null, message: parsed.error.issues.map((i) => `${i.path.join(".") || "changes"}: ${i.message}`).join("; ") };
      }
      const fields = toEntryFields(parsed.data);
      if (Object.keys(fields).length === 0) return { status: "validation_failed", submissionId: null, message: "No changes were included." };
      const valid = validateEntry({ ...entryToInput(entry), ...fields });
      if (!valid.ok) return { status: "validation_failed", submissionId: null, errors: valid.errors, message: Object.values(valid.errors).join("; ") };
      return store(submitter, {
        type: "update",
        targetRecipeId: entry.id,
        baseRevision: entry.revision,
        proposed: valid.value,
        baseSnapshot: snapshotOfEntry(entry),
        note: payload.note?.trim() || null,
        idempotencyKey: payload.idempotencyKey,
      });
    },

    /** Status for the tool that sent it (tools only see their own submissions). */
    async statusFor(submitter: Submitter, id: string) {
      const submission = await repo.get(id);
      if (!submission || submission.credentialId !== submitter.credentialId) return null;
      return describe(submission);
    },

    get: (id: string) => repo.get(id),
    listPending: () => repo.listByStatus(["pending", "conflict"], 100),
    listDecided: () => repo.listByStatus(["applied", "rejected"], 20),
    countPending: () => repo.countPending(),

    /** Admin approval (AC-013). Only admins reach this; tools have no way to call it (AC-029). */
    async approve(id: string, admin: Actor, options: { photoIds?: string[] } = {}) {
      const submission = await repo.get(id);
      if (!submission) return null;
      if (submission.status !== "pending") return submission;
      // A photo the admin found while reviewing a new entry with none (E1).
      const photoIds = [...new Set((options.photoIds ?? []).map((p) => p.toLowerCase()).filter((p) => /^[0-9a-f-]{36}$/.test(p)))].slice(0, 20);
      const withPhotos =
        submission.type === "create" && submission.proposed.photos.length === 0 && photoIds.length > 0
          ? { ...submission, proposed: { ...submission.proposed, photos: photoIds.map((photoId) => ({ id: photoId, caption: "" })) } }
          : submission;
      return apply(withPhotos, admin.userId);
    },

    /** Admin rejection: the catalog is unchanged and no version is recorded (AC-013, AC-059). */
    async reject(id: string, admin: Actor) {
      const submission = await repo.get(id);
      if (!submission) return null;
      await repo.decide(id, ["pending", "conflict"], { status: "rejected", decidedAt: now(), decidedBy: admin.userId });
      return repo.get(id);
    },
  };
}

export type Submissions = ReturnType<typeof createSubmissions>;
