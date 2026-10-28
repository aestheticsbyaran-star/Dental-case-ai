import { useState } from "react";
import type { Case, CaseRecord, RadiographView, RecordKind } from "../../../shared/types";
import { api } from "../lib/api";
import { guessKind, prepareRecord } from "../lib/previews";
import { ImageMeasure } from "./ImageMeasure";
import { ScanViewer } from "./ScanViewer";

export const KIND_LABELS: Record<RecordKind, string> = {
  photo: "Clinical photo",
  radiograph: "Radiograph (image)",
  dicom: "Radiograph (DICOM)",
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
  kind: RecordKind;
  view?: RadiographView;
  caption: string;
  state: "ready" | "uploading" | "error";
  error?: string;
}

const isRadiograph = (k: RecordKind) => k === "radiograph" || k === "dicom";

export function RecordsPanel({ c, onChange }: { c: Case; onChange: () => void }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [open, setOpen] = useState<CaseRecord | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files).map((file): Pending => {
      const guess = guessKind(file.name);
      return {
        key: `${file.name}-${file.size}-${Math.random()}`,
        file,
        kind: guess === "unknown" ? "document" : guess,
        view: guess === "dicom" ? "periapical" : undefined,
        caption: file.name.replace(/\.[^.]+$/, ""),
        state: "ready",
      };
    });
    setPending((p) => [...p, ...next]);
  };

  const update = (key: string, patch: Partial<Pending>) =>
    setPending((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const uploadOne = async (p: Pending) => {
    update(p.key, { state: "uploading", error: undefined });
    try {
      const prepared = await prepareRecord(p.file, p.kind);
      await api.uploadRecord(c.id, p.file, prepared.previews, {
        kind: prepared.kind,
        caption: p.caption,
        view: isRadiograph(prepared.kind) ? (prepared.view ?? p.view) : undefined,
        mmPerPixel: prepared.mmPerPixel,
      });
      if (prepared.note) setNotes((n) => [...n, `${p.caption}: ${prepared.note}`]);
      setPending((list) => list.filter((x) => x.key !== p.key));
    } catch (e) {
      update(p.key, { state: "error", error: (e as Error).message });
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
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <p>
            Drop photos, radiographs (JPEG, PNG or DICOM) and intraoral scans (STL or PLY) here, or{" "}
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
                  {p.file.name} <span className="muted">({(p.file.size / 1024 / 1024).toFixed(1)} MB)</span>
                </span>
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
      {open && open.kind !== "scan" && open.previews.length > 0 && (
        <ImageMeasure caseId={c.id} record={open} onClose={() => { setOpen(null); onChange(); }} />
      )}
    </div>
  );
}

function RecordCard({ caseId, r, onOpen, onChange }: { caseId: string; r: CaseRecord; onOpen: () => void; onChange: () => void }) {
  const [caption, setCaption] = useState(r.caption);
  const canOpen = r.kind === "scan" || r.previews.length > 0;

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
          {r.kind !== "scan" && r.kind !== "document" && (
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
            {r.kind === "scan" ? "View & measure" : "Open & measure"}
          </button>
          <button className="danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
