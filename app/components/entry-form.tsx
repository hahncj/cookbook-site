import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { CountedRef } from "../../server/core/catalog";
import type { FieldErrors } from "../../server/core/recipes";
import type { EntryFormValues } from "../entry-form.server";
import { CloseIcon, PlusIcon } from "./icons";
import { PhotoField } from "./photo-field";

interface Props {
  heading: string;
  /** Editing an existing entry (shows the "what changed" note). */
  editing?: boolean;
  cancelTo: string;
  values: EntryFormValues;
  errors?: FieldErrors;
  collections: CountedRef[];
}

const MIN_BLANK_ROWS = 3;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="error-text">
      {message}
    </p>
  );
}

export function EntryForm({ heading, editing = false, cancelTo, values, errors = {}, collections }: Props) {
  const navigation = useNavigation();
  const saving = navigation.state === "submitting" && navigation.formMethod?.toLowerCase() === "post";
  const [kind, setKind] = useState(values.kind);
  const [rows, setRows] = useState(() => {
    const filled = values.ingredients.map((row, i) => ({ key: i, ...row }));
    const blanks = Math.max(1, MIN_BLANK_ROWS - filled.length);
    return [...filled, ...Array.from({ length: blanks }, (_, i) => ({ key: filled.length + i, quantity: "", item: "" }))];
  });
  const [nextKey, setNextKey] = useState(rows.length);
  const [uploading, setUploading] = useState(false);

  const invalid = (field: keyof FieldErrors) => (errors[field] ? { "aria-invalid": true as const, "aria-describedby": `${field}-error` } : {});

  return (
    <Form method="post" className="form-page" noValidate>
      <div className="form-head">
        <h1>{heading}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={cancelTo} className="btn">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
            {saving ? "Saving…" : uploading ? "Adding photos…" : "Save"}
          </button>
        </div>
      </div>

      {errors.form && (
        <div className="alert" role="alert">
          <strong>Not saved</strong>
          {errors.form}
        </div>
      )}
      {!errors.form && Object.keys(errors).length > 0 && (
        <div className="alert" role="alert">
          <strong>Not saved yet</strong>
          Fix the highlighted fields below. Everything you entered is still here.
        </div>
      )}

      <input type="hidden" name="revision" value={values.revision} />

      <fieldset>
        <legend>Type</legend>
        <div className="radio-row">
          <label className="check">
            <input type="radio" name="kind" value="recipe" checked={kind === "recipe"} onChange={() => setKind("recipe")} />
            Recipe
          </label>
          <label className="check">
            <input type="radio" name="kind" value="idea" checked={kind === "idea"} onChange={() => setKind("idea")} />
            Idea
          </label>
        </div>
        {kind === "idea" && <p className="hint" style={{ marginTop: 8 }}>An idea only needs a title. Add details whenever you like.</p>}
      </fieldset>

      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" className="input-title" defaultValue={values.title} required maxLength={200} {...invalid("title")} />
        <FieldError id="title-error" message={errors.title} />
      </div>

      <div className="field">
        <label htmlFor="description">
          Description <span className="optional">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={2} defaultValue={values.description} {...invalid("description")} />
        <FieldError id="description-error" message={errors.description} />
      </div>

      <PhotoField initial={values.photos} onBusyChange={setUploading} />
      <FieldError id="photos-error" message={errors.photos} />

      <div className="grid-3">
        <div className="field">
          <label htmlFor="yieldText">Serves / makes</label>
          <input id="yieldText" name="yieldText" defaultValue={values.yieldText} placeholder="Serves 2" {...invalid("yieldText")} />
        </div>
        <div className="field">
          <label htmlFor="prepTime">Prep</label>
          <input id="prepTime" name="prepTime" defaultValue={values.prepTime} placeholder="10 min" {...invalid("prepTime")} />
        </div>
        <div className="field">
          <label htmlFor="cookTime">Cook</label>
          <input id="cookTime" name="cookTime" defaultValue={values.cookTime} placeholder="20 min" {...invalid("cookTime")} />
        </div>
      </div>

      <fieldset>
        <legend>Ingredients</legend>
        <p className="hint" style={{ marginBottom: 8 }}>
          Amounts are saved exactly as written. Leave an amount blank if you don't know it.
        </p>
        <div className="ingredient-rows">
          {rows.map((row, index) => (
            <div className="ingredient-row" key={row.key}>
              <label htmlFor={`q-${row.key}`} className="visually-hidden">
                Amount {index + 1}
              </label>
              <input id={`q-${row.key}`} className="input" name="ingredientQuantity" defaultValue={row.quantity} placeholder="Amount" />
              <label htmlFor={`i-${row.key}`} className="visually-hidden">
                Ingredient {index + 1}
              </label>
              <input id={`i-${row.key}`} className="input" name="ingredientItem" defaultValue={row.item} placeholder="Ingredient" />
              <button
                type="button"
                className="btn"
                aria-label={`Remove ingredient ${index + 1}`}
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRows((current) => [...current, { key: nextKey, quantity: "", item: "" }]);
              setNextKey((key) => key + 1);
            }}
          >
            <PlusIcon />
            Add ingredient
          </button>
        </div>
        <FieldError id="ingredients-error" message={errors.ingredients} />
      </fieldset>

      <div className="field">
        <label htmlFor="steps">Method</label>
        <p className="hint" id="steps-hint">
          One step per line.
        </p>
        <textarea id="steps" name="steps" rows={6} defaultValue={values.steps} aria-describedby="steps-hint" />
        <FieldError id="steps-error" message={errors.steps} />
      </div>

      <div className="field">
        <label htmlFor="notes">
          Notes <span className="optional">(optional)</span>
        </label>
        <textarea id="notes" name="notes" rows={3} defaultValue={values.notes} placeholder="Substitutions, tips, what to try next time" />
      </div>

      <div className="field">
        <label htmlFor="tags">
          Tags <span className="optional">(comma-separated)</span>
        </label>
        <input id="tags" name="tags" defaultValue={values.tags} placeholder="Weeknight, Noodles" {...invalid("tags")} />
        <FieldError id="tags-error" message={errors.tags} />
      </div>

      <fieldset>
        <legend>Collections</legend>
        {collections.length > 0 && (
          <div className="check-list" style={{ marginBottom: 10 }}>
            {collections.map((collection) => (
              <label key={collection.id} className="check">
                <input type="checkbox" name="collectionIds" value={collection.id} defaultChecked={values.collectionIds.includes(collection.id)} />
                {collection.name}
              </label>
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor="newCollection" className="hint" style={{ fontWeight: 400 }}>
            New collection <span className="optional">(optional)</span>
          </label>
          <input id="newCollection" name="newCollection" defaultValue={values.newCollection} placeholder="e.g. Summer grilling" {...invalid("collectionIds")} />
          <FieldError id="collectionIds-error" message={errors.collectionIds} />
        </div>
      </fieldset>

      <div className="grid-3" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <div className="field">
          <label htmlFor="sourceUrl">
            Source link <span className="optional">(optional)</span>
          </label>
          <input id="sourceUrl" name="sourceUrl" type="url" inputMode="url" defaultValue={values.sourceUrl} placeholder="https://" {...invalid("sourceUrl")} />
          <FieldError id="sourceUrl-error" message={errors.sourceUrl} />
        </div>
        <div className="field">
          <label htmlFor="sourceName">
            Source name <span className="optional">(optional)</span>
          </label>
          <input id="sourceName" name="sourceName" defaultValue={values.sourceName} placeholder="ChatGPT chat" />
        </div>
      </div>

      {editing && (
        <div className="field change-note">
          <label htmlFor="changeNote">
            What changed? <span className="optional">(saved with this version)</span>
          </label>
          <input id="changeNote" name="changeNote" defaultValue={values.changeNote} maxLength={500} placeholder="e.g. Less honey; added an egg" />
        </div>
      )}

      <div className="form-actions">
        <Link to={cancelTo} className="btn">
          Cancel
        </Link>
        <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
          {saving ? "Saving…" : uploading ? "Adding photos…" : "Save"}
        </button>
      </div>
    </Form>
  );
}
