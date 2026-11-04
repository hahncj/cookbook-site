import { data, redirect } from "react-router";
import type { Services } from "../server/app";
import { parseTagList, validateEntry, type Entry, type FieldErrors } from "../server/core/recipes";
import type { RecipeDraft } from "../server/core/imports";
import { requireAdminWrite } from "./admin.server";

/** Raw editor values, echoed back on errors so nothing typed is lost (AC-048). */
export interface EntryFormValues {
  kind: "recipe" | "idea";
  title: string;
  description: string;
  notes: string;
  yieldText: string;
  prepTime: string;
  cookTime: string;
  ingredients: { quantity: string; item: string }[];
  steps: string;
  sourceUrl: string;
  sourceName: string;
  tags: string;
  collectionIds: string[];
  newCollection: string;
  photos: { id: string; caption: string }[];
  changeNote: string;
  revision: number;
  /** Where a new entry came from (set by imports); ignored on edits. */
  origin: "manual" | "paste" | "web" | "image";
}

const ORIGINS = ["manual", "paste", "web", "image"] as const;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export function readEntryForm(form: FormData): EntryFormValues {
  const quantities = form.getAll("ingredientQuantity").map(String);
  const items = form.getAll("ingredientItem").map(String);
  const rows = Math.max(quantities.length, items.length);
  return {
    kind: text(form, "kind") === "idea" ? "idea" : "recipe",
    title: text(form, "title"),
    description: text(form, "description"),
    notes: text(form, "notes"),
    yieldText: text(form, "yieldText"),
    prepTime: text(form, "prepTime"),
    cookTime: text(form, "cookTime"),
    ingredients: Array.from({ length: rows }, (_, i) => ({ quantity: quantities[i] ?? "", item: items[i] ?? "" })),
    steps: text(form, "steps"),
    sourceUrl: text(form, "sourceUrl"),
    sourceName: text(form, "sourceName"),
    tags: text(form, "tags"),
    collectionIds: form.getAll("collectionIds").map(String),
    newCollection: text(form, "newCollection"),
    photos: form.getAll("photoId").map((id, i) => ({ id: String(id), caption: String(form.getAll("photoCaption")[i] ?? "") })),
    changeNote: text(form, "changeNote"),
    revision: Number(text(form, "revision")) || 0,
    origin: (ORIGINS as readonly string[]).includes(text(form, "origin")) ? (text(form, "origin") as EntryFormValues["origin"]) : "manual",
  };
}

export function entryToFormValues(entry: Entry): EntryFormValues {
  return {
    kind: entry.kind,
    title: entry.title,
    description: entry.description ?? "",
    notes: entry.notes ?? "",
    yieldText: entry.yieldText ?? "",
    prepTime: entry.prepTime ?? "",
    cookTime: entry.cookTime ?? "",
    ingredients: entry.ingredients,
    steps: entry.steps.join("\n"),
    sourceUrl: entry.sourceUrl ?? "",
    sourceName: entry.sourceName ?? "",
    tags: entry.tags.map((tag) => tag.name).join(", "),
    collectionIds: entry.collections.map((collection) => collection.id),
    newCollection: "",
    photos: entry.photos,
    changeNote: "",
    revision: entry.revision,
    origin: "manual",
  };
}

export function emptyFormValues(kind: "recipe" | "idea" = "recipe"): EntryFormValues {
  return {
    kind,
    title: "",
    description: "",
    notes: "",
    yieldText: "",
    prepTime: "",
    cookTime: "",
    ingredients: [],
    steps: "",
    sourceUrl: "",
    sourceName: "",
    tags: "",
    collectionIds: [],
    newCollection: "",
    photos: [],
    changeNote: "",
    revision: 0,
    origin: "manual",
  };
}

/** Editor values for an imported draft. The admin reviews them before saving (D2). */
export function draftToFormValues(draft: RecipeDraft, origin: EntryFormValues["origin"]): EntryFormValues {
  return {
    ...emptyFormValues(draft.kind),
    title: draft.title,
    description: draft.description ?? "",
    notes: draft.notes ?? "",
    yieldText: draft.yieldText ?? "",
    prepTime: draft.prepTime ?? "",
    cookTime: draft.cookTime ?? "",
    ingredients: draft.ingredients,
    steps: draft.steps.join("\n"),
    sourceUrl: draft.sourceUrl ?? "",
    sourceName: draft.sourceName ?? "",
    origin,
  };
}

export interface EntryActionData {
  errors: FieldErrors;
  values: EntryFormValues;
}

/** Shared create/update action. Authorization is checked first, on the server. */
export async function saveEntryAction(request: Request, services: Services, target: { id: string } | null) {
  const admin = await requireAdminWrite(request, services);
  const values = readEntryForm(await request.formData());

  const collectionIds = [...values.collectionIds];
  const errors: FieldErrors = {};
  if (values.newCollection.trim()) {
    const created = await services.catalog.createCollection(values.newCollection);
    if (created) collectionIds.push(created.id);
    else errors.collectionIds = "Collection names need 1–80 characters";
  }

  const result = validateEntry({
    kind: values.kind,
    title: values.title,
    description: values.description,
    notes: values.notes,
    yieldText: values.yieldText,
    prepTime: values.prepTime,
    cookTime: values.cookTime,
    ingredients: values.ingredients,
    steps: values.steps.split(/\r?\n/),
    sourceUrl: values.sourceUrl,
    sourceName: values.sourceName,
    tags: parseTagList(values.tags),
    collectionIds,
    photos: values.photos,
  });
  const echo = { ...values, collectionIds, newCollection: errors.collectionIds ? values.newCollection : "" };
  if (!result.ok || Object.keys(errors).length > 0) {
    return data<EntryActionData>({ errors: { ...errors, ...(result.ok ? {} : result.errors) }, values: echo }, { status: 400 });
  }

  const actor = { userId: admin.userId };
  const changeNote = values.changeNote;
  const saved = target
    ? await services.catalog.update(target.id, values.revision, result.value, actor, { changeNote })
    : await services.catalog.create(result.value, actor, { changeNote, origin: values.origin });

  if (!saved.ok) {
    const message =
      saved.reason === "conflict"
        ? "This recipe changed since you opened it, so your edit wasn't saved. Copy anything you need, then reload to see the latest version."
        : "This recipe no longer exists. It may have been deleted.";
    return data<EntryActionData>({ errors: { form: message }, values: echo }, { status: saved.reason === "conflict" ? 409 : 404 });
  }
  return redirect(`/recipes/${saved.id}`, 303);
}
