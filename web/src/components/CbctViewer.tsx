import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseRecord, Measurement } from "../../../shared/types";
import { api } from "../lib/api";
import { canvasToAiJpeg, PLANE_LABEL, renderPlane } from "../lib/cbct";
import { angleAt, distance } from "../lib/geometry";
import {
  deserializeVolume,
  densestAxialSlice,
  getSlice,
  gunzip,
  mmToVoxel,
  planeShape,
  planeToVoxel,
  voxelToMm,
  voxelToPlane,
  windowPresets,
  type Plane,
  type Volume,
} from "../lib/volume";
import { formatMeasurement } from "./ImageMeasure";

type Tool = "distance" | "angle";
type Vec3 = [number, number, number];
const POINTS_NEEDED: Record<Tool, number> = { distance: 2, angle: 3 };
const PLANES: Plane[] = ["axial", "coronal", "sagittal"];

interface Draft {
  plane: Plane;
  /** Points in voxel coordinates. */
  points: Vec3[];
}

/** Which slice a measurement sits on, and whether that is the slice being shown. */
function onSlice(vol: Volume, m: Measurement, plane: Plane, index: number): boolean {
  if (m.plane !== plane || !m.points.length) return false;
  return Math.abs(voxelToPlane(vol, plane, mmToVoxel(vol, m.points[0])).index - index) < 0.5;
}

/** Draws measurements and the draft on a canvas whose pixels map to plane pixels by (ku, kv). */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  vol: Volume,
  plane: Plane,
  ku: number,
  kv: number,
  items: { points: Vec3[]; colour: string; label?: string }[],
) {
  for (const item of items) {
    const pts = item.points.map((p) => {
      const { u, v } = voxelToPlane(vol, plane, p);
      return [(u + 0.5) * ku, (v + 0.5) * kv] as [number, number];
    });
    ctx.strokeStyle = item.colour;
    ctx.fillStyle = item.colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.stroke();
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(...p, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (item.label && pts.length) {
      const [x, y] = pts.length === 3 ? pts[1] : pts[pts.length - 1];
      ctx.font = "600 12px system-ui, sans-serif";
      const w = ctx.measureText(item.label).width;
      ctx.fillStyle = "rgba(10,14,16,0.75)";
      ctx.fillRect(x + 8, y - 17, w + 10, 19);
      ctx.fillStyle = "#fff";
      ctx.fillText(item.label, x + 13, y - 4);
    }
  }
}

export function CbctViewer({ caseId, record, onClose }: { caseId: string; record: CaseRecord; onClose: () => void }) {
  const [vol, setVol] = useState<Volume | null>(null);
  const [status, setStatus] = useState("Loading CBCT…");
  const [error, setError] = useState<string | null>(null);
  const [indices, setIndices] = useState<Record<Plane, number>>({ axial: 0, coronal: 0, sagittal: 0 });
  const [presetName, setPresetName] = useState<string>("Bone");
  const [tool, setTool] = useState<Tool | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState({ label: "", tooth: "" });
  const [measurements, setMeasurements] = useState<Measurement[]>(record.measurements);
  const [views, setViews] = useState({ previews: record.previews, labels: record.previewLabels ?? [] });
  const [viewNote, setViewNote] = useState("");
  const [sending, setSending] = useState<Plane | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(api.fileUrl(caseId, record.storedName));
        if (!res.ok) throw new Error("Couldn't load the CBCT file.");
        setStatus("Unpacking the volume…");
        const v = deserializeVolume(await gunzip(new Uint8Array(await res.arrayBuffer())));
        if (cancelled) return;
        setIndices({ axial: densestAxialSlice(v), coronal: Math.floor(v.dims[1] / 2), sagittal: Math.floor(v.dims[0] / 2) });
        setVol(v);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, record.storedName]);

  const presets = useMemo(() => (vol ? windowPresets(vol) : null), [vol]);
  const win = presets?.[presetName as keyof typeof presets] ?? [0, 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (tool || draft) {
        setTool(null);
        setDraft(null);
      } else onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [tool, draft, onClose]);

  const persist = async (next: Measurement[]) => {
    try {
      const updated = await api.updateRecord(caseId, record.id, { measurements: next });
      setMeasurements(updated.measurements);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onPick = useCallback(
    (plane: Plane, p: Vec3) => {
      if (!vol) return;
      if (!tool) {
        // Move the other two views to the clicked point.
        setIndices((cur) => ({
          axial: plane === "axial" ? cur.axial : Math.round(p[2]),
          coronal: plane === "coronal" ? cur.coronal : Math.round(p[1]),
          sagittal: plane === "sagittal" ? cur.sagittal : Math.round(p[0]),
        }));
        return;
      }
      setDraft((d) => {
        const base = d && d.plane === plane ? d.points : [];
        if (base.length >= POINTS_NEEDED[tool]) return d;
        return { plane, points: [...base, p] };
      });
    },
    [vol, tool],
  );

  const ready = Boolean(tool && draft && draft.points.length === POINTS_NEEDED[tool]);
  const draftValue =
    vol && draft && ready
      ? tool === "angle"
        ? angleAt(...(draft.points.map((p) => voxelToMm(vol, p)) as [Vec3, Vec3, Vec3]))
        : distance(voxelToMm(vol, draft.points[0]), voxelToMm(vol, draft.points[1]))
      : null;

  const save = async () => {
    if (!vol || !tool || !draft || draftValue === null) return;
    const m: Measurement = {
      id: crypto.randomUUID(),
      type: tool,
      value: draftValue,
      calibrated: true,
      label: form.label.trim(),
      tooth: form.tooth.trim() || undefined,
      points: draft.points.map((p) => voxelToMm(vol, p)),
      plane: draft.plane,
      createdAt: new Date().toISOString(),
    };
    await persist([...measurements, m]);
    setDraft(null);
    setForm({ label: "", tooth: "" });
  };

  const goTo = (m: Measurement) => {
    if (!vol || !m.plane || !m.points.length) return;
    const p = mmToVoxel(vol, m.points[0]);
    setIndices({ axial: Math.round(p[2]), coronal: Math.round(p[1]), sagittal: Math.round(p[0]) });
  };

  const overlayItems = (plane: Plane, index: number) => {
    if (!vol) return [];
    const items: { points: Vec3[]; colour: string; label?: string }[] = measurements
      .filter((m) => onSlice(vol, m, plane, index))
      .map((m) => ({
        points: m.points.map((p) => mmToVoxel(vol, p)),
        colour: m.type === "angle" ? "#f2b84b" : "#4fd1c5",
        label: `${m.tooth ? m.tooth + " " : ""}${formatMeasurement(m)}`,
      }));
    if (draft?.plane === plane) items.push({ points: draft.points, colour: "#ffffff" });
    return items;
  };

  const sendView = async (plane: Plane) => {
    if (!vol) return;
    setSending(plane);
    try {
      const index = indices[plane];
      const canvas = renderPlane(getSlice(vol, plane, index), vol, plane, win[0], win[1]);
      const { width, height } = planeShape(vol, plane);
      drawOverlay(canvas.getContext("2d")!, vol, plane, canvas.width / width, canvas.height / height, overlayItems(plane, index).filter((i) => i.label));
      const depth = planeShape(vol, plane).depth;
      const label = `${PLANE_LABEL[plane]} slice ${index + 1} of ${depth}${viewNote.trim() ? `: ${viewNote.trim()}` : ""}`;
      const updated = await api.addPreview(caseId, record.id, await canvasToAiJpeg(canvas), label);
      setViews({ previews: updated.previews, labels: updated.previewLabels ?? [] });
      setViewNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(null);
    }
  };

  const removeView = async (name: string) => {
    const updated = await api.deletePreview(caseId, record.id, name);
    setViews({ previews: updated.previews, labels: updated.previewLabels ?? [] });
  };

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true" aria-label={record.caption}>
      <div className="viewer">
        <div className="viewer-stage cbct-grid">
          {!vol && <p className="cbct-status">{error ?? status}</p>}
          {vol &&
            PLANES.map((plane) => (
              <Pane
                key={plane}
                vol={vol}
                plane={plane}
                index={indices[plane]}
                setIndex={(i) => setIndices((cur) => ({ ...cur, [plane]: i }))}
                indices={indices}
                win={win}
                crosshair={!tool}
                overlay={overlayItems(plane, indices[plane])}
                onPick={onPick}
                onSend={() => sendView(plane)}
                sending={sending === plane}
              />
            ))}
          {vol && (
            <div className="cbct-info small">
              <p>
                {vol.dims.join(" × ")} voxels · {vol.spacing.map((s) => s.toFixed(3)).join(" × ")} mm
              </p>
              {record.volume?.notes.map((n, i) => (
                <p key={i} className="muted">
                  {n}
                </p>
              ))}
              <p className="muted">
                Scroll on a view to move through slices. Click a view to move the other two to that point. Front views show the
                patient's right on the left.
              </p>
            </div>
          )}
        </div>

        <aside className="viewer-side">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>{record.caption || "CBCT"}</h3>
            <button onClick={onClose}>Close</button>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <strong className="small">Contrast</strong>
            <div className="toolbar">
              {presets &&
                Object.keys(presets).map((name) => (
                  <button key={name} className={presetName === name ? "active" : ""} onClick={() => setPresetName(name)}>
                    {name}
                  </button>
                ))}
            </div>
          </div>

          <div className="toolbar">
            <button className={tool === "distance" ? "active" : ""} onClick={() => { setTool(tool === "distance" ? null : "distance"); setDraft(null); }}>
              Ruler
            </button>
            <button className={tool === "angle" ? "active" : ""} onClick={() => { setTool(tool === "angle" ? null : "angle"); setDraft(null); }}>
              Angle
            </button>
          </div>
          {tool && !ready && (
            <div className="hint">
              {tool === "distance" ? "Click two points on one view." : "Click three points on one view: first arm, vertex, second arm."} Press Esc
              to cancel.
            </div>
          )}
          {ready && draftValue !== null && (
            <form
              className="stack panel"
              style={{ padding: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <p className="mono">{tool === "angle" ? `${draftValue.toFixed(1)}°` : `${draftValue.toFixed(2)} mm`}</p>
              <label>
                <span>What is this?</span>
                <input id="c-label" autoFocus placeholder="e.g. 36 bone height to canal" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </label>
              <label>
                <span>Tooth (FDI)</span>
                <input id="c-tooth" placeholder="e.g. 36" value={form.tooth} onChange={(e) => setForm({ ...form, tooth: e.target.value })} />
              </label>
              <div className="row">
                <button className="primary" type="submit">Save measurement</button>
                <button type="button" onClick={() => setDraft(null)}>Redo</button>
              </div>
            </form>
          )}
          {error && vol && <div className="error small">{error}</div>}

          <div className="stack" style={{ gap: 6 }}>
            <h3>Measurements</h3>
            {measurements.length === 0 && <p className="muted small">None yet.</p>}
            <div className="mlist">
              {measurements.map((m) => (
                <div key={m.id} className="mitem">
                  <button className="linklike" onClick={() => goTo(m)} title="Show this measurement">
                    {m.tooth && <strong>{m.tooth} </strong>}
                    {m.label || (m.type === "angle" ? "Angle" : "Distance")}
                    {m.plane && <span className="muted"> · {m.plane}</span>}
                  </button>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="mono">{formatMeasurement(m)}</span>
                    <button aria-label="Delete measurement" onClick={() => persist(measurements.filter((x) => x.id !== m.id))}>
                      ×
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <h3>Views sent to Claude</h3>
            <p className="muted small">
              Overview images were made on upload. Use "Send to AI" on a view to add the slice you're looking at, with any
              measurements on it.
            </p>
            <label>
              <span>Note for the next view you send</span>
              <input id="view-note" placeholder="e.g. 36 implant site, cross-section" value={viewNote} onChange={(e) => setViewNote(e.target.value)} />
            </label>
            <div className="ai-views">
              {views.previews.map((name, i) => (
                <figure key={name}>
                  <img src={api.fileUrl(caseId, name)} alt="" />
                  <figcaption className="small">
                    <span title={views.labels[i]}>{views.labels[i] || "View"}</span>
                    <button aria-label="Remove view" onClick={() => removeView(name)}>×</button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Pane(props: {
  vol: Volume;
  plane: Plane;
  index: number;
  setIndex: (i: number) => void;
  indices: Record<Plane, number>;
  win: [number, number];
  crosshair: boolean;
  overlay: { points: Vec3[]; colour: string; label?: string }[];
  onPick: (plane: Plane, p: Vec3) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const { vol, plane, index, setIndex, indices, win, overlay, onPick } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 300, h: 300 });
  const shape = planeShape(vol, plane);

  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const image = useMemo(() => renderPlane(getSlice(vol, plane, index), vol, plane, win[0], win[1]), [vol, plane, index, win]);
  const scale = Math.min(box.w / image.width, box.h / image.height);

  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = Math.max(1, Math.floor(image.width * scale));
    canvas.height = Math.max(1, Math.floor(image.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const ku = canvas.width / shape.width;
    const kv = canvas.height / shape.height;
    if (props.crosshair) {
      // Show where the other two views cut through this one.
      const at = voxelToPlane(vol, plane, [indices.sagittal, indices.coronal, indices.axial]);
      ctx.strokeStyle = "rgba(255, 196, 77, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((at.u + 0.5) * ku, 0);
      ctx.lineTo((at.u + 0.5) * ku, canvas.height);
      ctx.moveTo(0, (at.v + 0.5) * kv);
      ctx.lineTo(canvas.width, (at.v + 0.5) * kv);
      ctx.stroke();
    }
    drawOverlay(ctx, vol, plane, ku, kv, overlay);
  }, [image, scale, overlay, indices, props.crosshair, vol, plane, shape.width, shape.height]);

  const toVoxel = (e: React.MouseEvent<HTMLCanvasElement>): Vec3 => {
    const rect = e.currentTarget.getBoundingClientRect();
    const u = ((e.clientX - rect.left) / rect.width) * shape.width - 0.5;
    const v = ((e.clientY - rect.top) / rect.height) * shape.height - 0.5;
    return planeToVoxel(vol, plane, u, v, index);
  };

  return (
    <section className="cbct-pane">
      <header>
        <strong>{PLANE_LABEL[plane]}</strong>
        <input
          aria-label={`${PLANE_LABEL[plane]} slice`}
          type="range"
          min={0}
          max={shape.depth - 1}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        />
        <span className="mono small">
          {index + 1}/{shape.depth}
        </span>
        <button onClick={props.onSend} disabled={props.sending}>
          {props.sending ? "Sending…" : "Send to AI"}
        </button>
      </header>
      <div
        className="cbct-canvas"
        ref={boxRef}
        onWheel={(e) => setIndex(Math.max(0, Math.min(shape.depth - 1, index + (e.deltaY > 0 ? 1 : -1))))}
      >
        <canvas
          ref={canvasRef}
          style={{ cursor: "crosshair" }}
          onClick={(e) => {
            const p = toVoxel(e);
            onPick(plane, p);
          }}
        />
      </div>
    </section>
  );
}
