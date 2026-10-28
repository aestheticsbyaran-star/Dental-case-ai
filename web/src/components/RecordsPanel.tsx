import { useState } from "react";
import type { Case, CaseRecord, RadiographView, RecordKind } from "../../../shared/types";
import { api } from "../lib/api";
import { guessKind, prepareRecord } from "../lib/previews";
import { prepareCbct } from "../lib/cbct";
import { ImageMeasure } from "./ImageMeasure";
import { ScanViewer } from "./ScanViewer";
import { CbctViewer } from "./CbctViewer";

export const KIND_LABELS: Record<RecordKind, string> = {
  photo: "Clinical photo",
  radiograph: "Radiograph (image)",
  dicom: "Radiograph (DICOM)",
  cbct: "CBCT",
  scan: "Intraoral scan",
  document: "Document",
};

export const VIEW_LABELS: Record<RadiographView, string> = {
  bitewing: "Bitewing",
  periapical: "Periapical",
  opg: "OPG / panoramic",
  ceph: "Lateral ceph",
  "cbct-slice": "CBCT slice",
  other: "Other",
};

interface Pending {
  key: string;
  file: File;
  /** All slice files when this is a CBCT series. */
  files?: File[];
  progress?: string;
  kind: RecordKind;
  view?: RadiographView;
  caption: string;
  state: "ready" | "uploading" | "error";
  error?: string;
}

const isRadiograph = (k: RecordKind) => k === "radiograph" || k === "dicom";

/** CBCT slices usually come as many .dcm files, or files with no extension at all. */
const looksLikeSlice = (f: File) => /\.(dcm|dicom)$/i.test(f.name) || (!/\.[a-z0-9]{2,5}$/i.test(f.name) && !/^dicomdir$/i.test(f.name));
/** This many DICOM files dropped together are treated as one CBCT series. */
const SERIES_THRESHOLD = 8;

/** Reads every file inside dropped folders. */
async function filesFromDrop(items: DataTransferItemList): Promise<{ files: File[]; hadFolder: boolean }> {
  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));
  let hadFolder = false;
  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      files.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      hadFolder = true;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches until it returns an empty list.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return { files, hadFolder };
}

export function RecordsPanel({ c, onChange }: { c: Case; onChange: () => void }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [open, setOpen] = useState<CaseRecord | null>(null);

  const addFiles = (list: FileList | File[] | null, fromFolder = false) => {
    if (!list) return;
    const all = Array.from(list).filter((f) => !f.name.startsWith("."));
    const slices = all.filter(looksLikeSlice);
    const asSeries = slices.length >= SERIES_THRESHOLD || (fromFolder && slices.length > 1);
    // The DICOMDIR index file that comes with CBCT exports isn't needed.
    const singles = asSeries ? all.filter((f) => !slices.includes(f) && !/^dicomdir$/i.test(f.name)) : all;
    const next: Pending[] = singles.map((file): Pending => {
      const guess = guessKind(file.name);
      return {
        key: `${file.name}-${file.size}-${Math.random()}`,
        file,
        kind: guess === "unknown" ? (looksLikeSlice(file) ? "dicom" : "document") : guess,
        view: guess === "dicom" ? "periapical" : undefined,
        caption: file.name.replace(/\.[^.]+$/, ""),
        state: "ready",
      };
    });
    if (asSeries) {
      const folder = (slices[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0];
      next.unshift({
        key: `cbct-${Math.random()}`,
        file: slices[0],
        files: slices,
        kind: "cbct",
        caption: folder ? `CBCT ${folder}` : "CBCT",
        state: "ready",
      });
    }
    setPending((p) => [...p, ...next]);
  };

  const update = (key: string, patch: Partial<Pending>) =>
    setPending((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const uploadOne = async (p: Pending) => {
    update(p.key, { state: "uploading", error: undefined });
    try {
      if (p.kind === "cbct") {
        const prepared = await prepareCbct(p.files ?? [p.file], (progress) => update(p.key, { progress }));
        update(p.key, { progress: "Saving" });
        await api.uploadRecord(c.id, prepared.volumeFile, prepared.previews, {
          kind: "cbct",
          caption: p.caption,
          previewLabels: prepared.previewLabels,
          volume: prepared.volume,
        });
        if (prepared.volume.notes.length) setNotes((n) => [...n, `${p.caption}: ${prepared.volume.notes.join(" ")}`]);
      } else {
        const prepared = await prepareRecord(p.file, p.kind);
        await api.uploadRecord(c.id, p.file, prepared.previews, {
          kind: prepared.kind,
          caption: p.caption,
          view: isRadiograph(prepared.kind) ? (prepared.view ?? p.view) : undefined,
          mmPerPixel: prepared.mmPerPixel,
        });
        if (prepared.note) setNotes((n) => [...n, `${p.caption}: ${prepared.note}`]);
      }
      setPending((list) => list.filter((x) => x.key !== p.key));
    } catch (e) {
      update(p.key, { state: "error", progress: undefined, error: (e as Error).message });
    }
  };

  const uploadAll = async () => {
    for (const p of pending.filter((x) => x.state !== "uploading")) await uploadOne(p);
    onChange();
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setOver(false);
            const plain = e.dataTransfer.files;
            const { files, hadFolder } = await filesFromDrop(e.dataTransfer.items);
            addFiles(hadFolder ? files : plain, hadFolder);
          }}
        >
          <p>
            Drop photos, radiographs (JPEG, PNG or DICOM), intraoral scans (STL or PLY) or a CBCT folder here, or{" "}
            <label style={{ display: "inline", color: "var(--accent)", cursor: "pointer" }}>
              choose files
              <input
                id="file-input"
                type="file"
                multiple
                hidden
                accept=".jpg,.jpeg,.png,.webp,.heic,.dcm,.dicom,.stl,.ply,.pdf,.txt"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            , or{" "}
            <label style={{ display: "inline", color: "var(--accent)", cursor: "pointer" }}>
              choose a CBCT folder
              <input
                id="folder-input"
                type="file"
                hidden
                {...{ webkitdirectory: "", directory: "" }}
                onChange={(e) => {
                  addFiles(e.target.files, true);
                  e.target.value = "";
                }}
              />
            </label>
            .
          </p>
          <p className="small">
            Photos are re-saved without their hidden metadata, and DICOM headers are read here and never sent anywhere.
          </p>
        </div>

        {pending.length > 0 && (
          <div className="stack">
            {pending.map((p) => (
              <div key={p.key} className="pending">
                <span className="small" title={p.file.name} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.files ? `${p.files.length} slice files` : p.file.name}{" "}
                  <span className="muted">
                    ({((p.files ?? [p.file]).reduce((n, f) => n + f.size, 0) / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </span>
                {p.files ? (
                  <span className="badge">CBCT series</span>
                ) : (
                <select
                  aria-label="Record type"
                  value={p.kind}
                  onChange={(e) => update(p.key, { kind: e.target.value as RecordKind })}
                >
                  {Object.entries(KIND_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                )}
                {isRadiograph(p.kind) ? (
                  <select
                    aria-label="Radiograph view"
                    value={p.view ?? "other"}
                    onChange={(e) => update(p.key, { view: e.target.value as RadiographView })}
                  >
                    {Object.entries(VIEW_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span />
                )}
                <input
                  aria-label="Caption"
                  placeholder="Caption, e.g. Pre-op LR PA"
                  value={p.caption}
                  onChange={(e) => update(p.key, { caption: e.target.value })}
                />
                <div className="row">
                  {p.state === "uploading" && <span className="spinner" aria-label="Uploading" />}
                  {p.progress && <span className="small muted">{p.progress}</span>}
                  <button onClick={() => setPending((l) => l.filter((x) => x.key !== p.key))} disabled={p.state === "uploading"}>
                    Remove
                  </button>
                </div>
                {p.error && <div className="error small" style={{ gridColumn: "1 / -1" }}>{p.error}</div>}
              </div>
            ))}
            <div>
              <button className="primary" onClick={uploadAll} disabled={pending.some((p) => p.state === "uploading")}>
                Add {pending.length} {pending.length === 1 ? "record" : "records"} to case
              </button>
            </div>
          </div>
        )}
        {notes.length > 0 && (
          <div className="banner info small stack" style={{ gap: 4 }}>
            {notes.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
            <button style={{ alignSelf: "flex-start" }} onClick={() => setNotes([])}>
              Dismiss
            </button>
          </div>
        )}
      </section>

      {c.records.length === 0 ? (
        <p className="muted">No records yet.</p>
      ) : (
        <div className="records">
          {c.records.map((r) => (
            <RecordCard key={r.id} caseId={c.id} r={r} onOpen={() => setOpen(r)} onChange={onChange} />
          ))}
        </div>
      )}

      {open && open.kind === "scan" && (
        <ScanViewer caseId={c.id} record={open} onClose={() => { setOpen(null); onChange(); }} />
      )}
      {open && open.kind === "cbct" && (
        <CbctViewer caseId={c.id} record={open} onClose={() => { setOpen(null); onChange(); }} />
      )}
      {open && open.kind !== "scan" && open.kind !== "cbct" && open.previews.length > 0 && (
        <ImageMeasure caseId={c.id} record={open} onClose={() => { setOpen(null); onChange(); }} />
      )}
    </div>
  );
}

function RecordCard({ caseId, r, onOpen, onChange }: { caseId: string; r: CaseRecord; onOpen: () => void; onChange: () => void }) {
  const [caption, setCaption] = useState(r.caption);
  const canOpen = r.kind === "scan" || r.kind === "cbct" || r.previews.length > 0;

  const patch = async (p: Parameters<typeof api.updateRecord>[2]) => {
    await api.updateRecord(caseId, r.id, p);
    onChange();
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${r.caption || r.originalName}" and its measurements?`)) return;
    await api.deleteRecord(caseId, r.id);
    onChange();
  };

  return (
    <article className="record">
      <button className="thumb" onClick={onOpen} disabled={!canOpen} aria-label={`Open ${r.caption || r.originalName}`}>
        {r.previews[0] ? <img src={api.fileUrl(caseId, r.previews[0])} alt="" loading="lazy" /> : <span>{KIND_LABELS[r.kind]}</span>}
      </button>
      <div className="body">
        <div className="row" style={{ gap: 6 }}>
          <span className="badge">{r.view ? VIEW_LABELS[r.view] : KIND_LABELS[r.kind]}</span>
          {r.volume && (
            <span className="badge ok">
              {r.volume.dims.join("×")} · {r.volume.spacing[0].toFixed(2)} mm
            </span>
          )}
          {r.kind !== "scan" && r.kind !== "document" && r.kind !== "cbct" && (
            <span className={`badge ${r.mmPerPixel ? "ok" : "warn"}`}>{r.mmPerPixel ? "calibrated" : "not calibrated"}</span>
          )}
          {r.measurements.length > 0 && <span className="badge">{r.measurements.length} measured</span>}
        </div>
        <input
          aria-label="Caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== r.caption && patch({ caption })}
        />
        <label className="row small" style={{ flexDirection: "row", gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={r.includeInAnalysis}
            disabled={r.previews.length === 0}
            onChange={(e) => patch({ includeInAnalysis: e.target.checked })}
          />
          Include in AI analysis
        </label>
        <div className="actions">
          <button onClick={onOpen} disabled={!canOpen}>
            {r.kind === "scan" || r.kind === "cbct" ? "View & measure" : "Open & measure"}
          </button>
          <button className="danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
