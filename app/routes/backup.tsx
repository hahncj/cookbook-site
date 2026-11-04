import { useState } from "react";
import { Link } from "react-router";
import { isCatalogEmpty } from "../../server/backup";
import { requireAdminPage } from "../admin.server";
import { buildBackup, restoreBackup, saveFile, type Progress } from "../backup-client";
import { servicesContext } from "../context";
import type { Route } from "./+types/backup";

export function meta() {
  return [{ title: "Backup · 540 Kitchen" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminPage(request, services);
  return { empty: await isCatalogEmpty(services.db) };
}

export function shouldRevalidate() {
  // Keep the restore panel on screen while a restore fills the cookbook.
  return false;
}

function ProgressLine({ progress }: { progress: Progress | null }) {
  if (!progress) return null;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div role="status" aria-live="polite" className="progress">
      <span>
        {progress.label}
        {progress.total > 1 && ` · ${progress.done} of ${progress.total}`}
      </span>
      <progress max={100} value={percent} aria-label={progress.label} />
    </div>
  );
}

export default function Backup({ loaderData }: Route.ComponentProps) {
  const [downloading, setDownloading] = useState<Progress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Progress | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restored, setRestored] = useState<{ recipes: number; photos: number } | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function download() {
    setDownloadError(null);
    try {
      const { blob, filename } = await buildBackup(setDownloading);
      saveFile(blob, filename);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "The backup failed. Try again.");
    } finally {
      setDownloading(null);
    }
  }

  async function restore() {
    if (!file) return;
    setRestoreError(null);
    try {
      setRestored(await restoreBackup(file, setRestoring));
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "The restore failed.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="narrow" style={{ maxWidth: 680 }}>
      <h1>Backup</h1>

      <section className="card" aria-labelledby="download-heading">
        <h2 id="download-heading" className="section-title">
          Download a full backup
        </h2>
        <p>
          One zip file with every recipe and idea (including deleted ones), their full version history, notes, tags,
          collections and photos.
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          Sign-ins and AI-tool connections aren't included; after a restore you sign in and reconnect them. Backups are only
          made when you press this button, so download one regularly and keep it somewhere safe.
        </p>
        <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={download} disabled={Boolean(downloading)}>
          {downloading ? "Preparing backup…" : "Download full backup"}
        </button>
        <ProgressLine progress={downloading} />
        {downloadError && (
          <p className="alert" role="alert" style={{ marginTop: 12 }}>
            {downloadError}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="restore-heading">
        <h2 id="restore-heading" className="section-title">
          Restore from a backup
        </h2>
        {restored ? (
          <p className="notice" role="status">
            Restored {restored.recipes} {restored.recipes === 1 ? "entry" : "entries"} and {restored.photos}{" "}
            {restored.photos === 1 ? "photo" : "photos"}. <Link to="/">Open the cookbook</Link>
          </p>
        ) : loaderData.empty || restoreError ? (
          <>
            <p>This cookbook is empty, so a backup can be restored into it. IDs, history, notes and photos are kept.</p>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="backup-file">Backup file (.zip)</label>
              <input id="backup-file" type="file" accept=".zip,application/zip" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={restore} disabled={!file || Boolean(restoring)}>
              {restoring ? "Restoring…" : "Restore backup"}
            </button>
            <ProgressLine progress={restoring} />
            {restoreError && (
              <p className="alert" role="alert" style={{ marginTop: 12 }}>
                {restoreError} If it stopped partway, run the restore again with the same file; it picks up safely.
              </p>
            )}
          </>
        ) : (
          <p className="muted">
            Restore is only available on an empty cookbook (for example a new installation), so it can never overwrite your
            recipes. To go back to an earlier state of one recipe, use its version history instead.
          </p>
        )}
      </section>
    </div>
  );
}
