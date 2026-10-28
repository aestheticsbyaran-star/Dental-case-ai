import { useEffect, useRef, useState } from "react";
import type { CaseRecord, Measurement } from "../../../shared/types";
import { api } from "../lib/api";
import { angleAt, calibrationFromLine, measuredLength, type Point } from "../lib/geometry";

type Tool = "distance" | "angle" | "calibrate";
const POINTS_NEEDED: Record<Tool, number> = { distance: 2, angle: 3, calibrate: 2 };
const HINTS: Record<Tool, string> = {
  distance: "Click the two ends of the distance.",
  angle: "Click three points: first arm, the vertex, then the second arm.",
  calibrate: "Click both ends of something of known length (e.g. an implant, a ruler, a known crown width).",
};

function recompute(measurements: Measurement[], mmPerPixel?: number): Measurement[] {
  return measurements.map((m) =>
    m.type === "distance" && m.points.length === 2 ? { ...m, ...measuredLength(m.points[0], m.points[1], mmPerPixel) } : m,
  );
}

export function formatMeasurement(m: Measurement): string {
  if (m.type === "angle") return `${m.value.toFixed(1)}°`;
  return m.calibrated ? `${m.value.toFixed(2)} mm` : `${m.value.toFixed(0)} px`;
}

export function ImageMeasure({ caseId, record, onClose }: { caseId: string; record: CaseRecord; onClose: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<Tool | null>(null);
  const [clicks, setClicks] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>(record.measurements);
  const [mmPerPixel, setMmPerPixel] = useState<number | undefined>(record.mmPerPixel);
  const [calibSource, setCalibSource] = useState(record.calibrationSource);
  const [draft, setDraft] = useState<{ label: string; tooth: string; knownMm: string }>({ label: "", tooth: "", knownMm: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = api.fileUrl(caseId, record.previews[0]);
  }, [caseId, record.previews]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (tool) {
          setTool(null);
          setClicks([]);
        } else onClose();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [tool, onClose]);

  // Work out the display scale.
  useEffect(() => {
    if (!img || !stageRef.current) return;
    const fit = () => {
      const s = stageRef.current!;
      const f = Math.min((s.clientWidth - 8) / img.naturalWidth, (s.clientHeight - 8) / img.naturalHeight);
      setScale(zoom === "fit" ? f : zoom);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [img, zoom]);

  // Draw image and overlays.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const px = (p: Point): [number, number] => [p[0] * scale, p[1] * scale];
    const drawPath = (pts: Point[], colour: string, label?: string) => {
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(...px(p)) : ctx.lineTo(...px(p))));
      ctx.stroke();
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(...px(p), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (label && pts.length) {
        const anchor = px(pts.length === 3 ? pts[1] : pts[pts.length - 1]);
        ctx.font = "600 13px system-ui, sans-serif";
        const w = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(10,14,16,0.75)";
        ctx.fillRect(anchor[0] + 8, anchor[1] - 18, w + 10, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, anchor[0] + 13, anchor[1] - 4);
      }
    };
    for (const m of measurements) {
      drawPath(m.points, m.type === "angle" ? "#f2b84b" : "#4fd1c5", `${m.tooth ? m.tooth + " " : ""}${formatMeasurement(m)}`);
    }
    if (tool && clicks.length) {
      drawPath(hover && clicks.length < POINTS_NEEDED[tool] ? [...clicks, hover] : clicks, tool === "calibrate" ? "#ff7a90" : "#ffffff");
    }
  }, [img, scale, measurements, clicks, hover, tool]);

  const toImage = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale];
  };

  const persist = async (next: Measurement[], nextMmPerPixel?: number | null) => {
    try {
      const updated = await api.updateRecord(caseId, record.id, {
        measurements: next,
        ...(nextMmPerPixel !== undefined ? { mmPerPixel: nextMmPerPixel } : {}),
      });
      setMeasurements(updated.measurements);
      setMmPerPixel(updated.mmPerPixel);
      setCalibSource(updated.calibrationSource);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ready = tool !== null && clicks.length === POINTS_NEEDED[tool];

  const confirm = async () => {
    if (!tool || !ready) return;
    try {
      if (tool === "calibrate") {
        const next = calibrationFromLine(clicks[0], clicks[1], Number(draft.knownMm));
        await persist(recompute(measurements, next), next);
      } else {
        const value =
          tool === "angle" ? { value: angleAt(clicks[0], clicks[1], clicks[2]), calibrated: true } : measuredLength(clicks[0], clicks[1], mmPerPixel);
        const m: Measurement = {
          id: crypto.randomUUID(),
          type: tool,
          ...value,
          label: draft.label.trim(),
          tooth: draft.tooth.trim() || undefined,
          points: clicks,
          createdAt: new Date().toISOString(),
        };
        await persist([...measurements, m]);
      }
      setClicks([]);
      setDraft({ label: "", tooth: "", knownMm: "" });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const chooseTool = (t: Tool) => {
    setTool(tool === t ? null : t);
    setClicks([]);
  };

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true" aria-label={record.caption}>
      <div className="viewer">
        <div className="viewer-stage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            style={{ cursor: tool ? "crosshair" : "default", margin: 4 }}
            onClick={(e) => {
              if (!tool || ready) return;
              const point = toImage(e);
              setClicks((c) => [...c, point]);
            }}
            onMouseMove={(e) => tool && setHover(toImage(e))}
            onMouseLeave={() => setHover(null)}
          />
        </div>
        <aside className="viewer-side">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>{record.caption || record.originalName}</h3>
            <button onClick={onClose}>Close</button>
          </div>

          <div className="small">
            {mmPerPixel ? (
              <span className="badge ok">
                Calibrated · {mmPerPixel.toFixed(4)} mm/px · {calibSource === "dicom" ? "from DICOM" : "manual"}
              </span>
            ) : (
              <span className="badge warn">Not calibrated: distances are in pixels</span>
            )}
            {record.view === "opg" && (
              <p className="muted small" style={{ marginTop: 6 }}>
                OPG magnification varies across the image, so linear measurements are approximate.
              </p>
            )}
          </div>

          <div className="toolbar">
            <button className={tool === "distance" ? "active" : ""} onClick={() => chooseTool("distance")}>Ruler</button>
            <button className={tool === "angle" ? "active" : ""} onClick={() => chooseTool("angle")}>Angle</button>
            <button className={tool === "calibrate" ? "active" : ""} onClick={() => chooseTool("calibrate")}>Calibrate</button>
          </div>
          <div className="toolbar">
            <button className={zoom === "fit" ? "active" : ""} onClick={() => setZoom("fit")}>Fit</button>
            <button className={zoom === 1 ? "active" : ""} onClick={() => setZoom(1)}>100%</button>
            <button className={zoom === 2 ? "active" : ""} onClick={() => setZoom(2)}>200%</button>
          </div>

          {tool && !ready && <div className="hint">{HINTS[tool]} Press Esc to cancel.</div>}

          {ready && (
            <form
              className="stack panel"
              style={{ padding: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                confirm();
              }}
            >
              {tool === "calibrate" ? (
                <label>
                  <span>Known length (mm)</span>
                  <input
                    id="known-mm"
                    autoFocus
                    type="number"
                    step="0.01"
                    min="0"
                    value={draft.knownMm}
                    onChange={(e) => setDraft({ ...draft, knownMm: e.target.value })}
                  />
                </label>
              ) : (
                <>
                  <label>
                    <span>What is this?</span>
                    <input
                      id="m-label"
                      autoFocus
                      placeholder={tool === "angle" ? "e.g. 37 mesial tilt" : "e.g. bone height to canal"}
                      value={draft.label}
                      onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Tooth (FDI)</span>
                    <input id="m-tooth" placeholder="e.g. 36" value={draft.tooth} onChange={(e) => setDraft({ ...draft, tooth: e.target.value })} />
                  </label>
                </>
              )}
              <div className="row">
                <button className="primary" type="submit">
                  {tool === "calibrate" ? "Set calibration" : "Save measurement"}
                </button>
                <button type="button" onClick={() => setClicks([])}>
                  Redo
                </button>
              </div>
            </form>
          )}

          {error && <div className="error small">{error}</div>}

          <div className="stack" style={{ gap: 6 }}>
            <h3>Measurements</h3>
            {measurements.length === 0 && <p className="muted small">None yet. Pick Ruler or Angle and click on the image.</p>}
            <div className="mlist">
              {measurements.map((m) => (
                <div key={m.id} className="mitem">
                  <span>
                    {m.tooth && <strong>{m.tooth} </strong>}
                    {m.label || (m.type === "angle" ? "Angle" : "Distance")}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="mono">{formatMeasurement(m)}</span>
                    <button
                      aria-label="Delete measurement"
                      onClick={() => persist(measurements.filter((x) => x.id !== m.id))}
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {mmPerPixel && calibSource === "manual" && (
              <button style={{ alignSelf: "flex-start" }} onClick={() => persist(recompute(measurements, undefined), null)}>
                Remove calibration
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
