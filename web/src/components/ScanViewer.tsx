import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CaseRecord, Measurement } from "../../../shared/types";
import { api } from "../lib/api";
import { addLights, loadMesh, meshMaterial } from "../lib/previews";
import { angleAt, distance, type Point } from "../lib/geometry";
import { formatMeasurement } from "./ImageMeasure";

type Tool = "distance" | "angle";
const POINTS_NEEDED: Record<Tool, number> = { distance: 2, angle: 3 };

interface SceneRefs {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  mesh: THREE.Mesh;
  overlay: THREE.Group;
  markerSize: number;
}

export function ScanViewer({ caseId, record, onClose }: { caseId: string; record: CaseRecord; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const refs = useRef<SceneRefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [clicks, setClicks] = useState<Point[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>(record.measurements);
  const [draft, setDraft] = useState({ label: "", tooth: "" });
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Set up the 3D scene once.
  useEffect(() => {
    const mount = mountRef.current!;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x1d2327);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    addLights(scene);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let frame = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };

    fetch(api.fileUrl(caseId, record.storedName))
      .then((r) => {
        if (!r.ok) throw new Error("Couldn't load the scan file.");
        return r.arrayBuffer();
      })
      .then((buf) => loadMesh(buf, record.originalName))
      .then((geometry) => {
        if (disposed) return;
        const mesh = new THREE.Mesh(geometry, meshMaterial(geometry));
        scene.add(mesh);
        const overlay = new THREE.Group();
        scene.add(overlay);
        const box = geometry.boundingBox!;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        camera.near = size / 200;
        camera.far = size * 20;
        camera.position.copy(center).add(new THREE.Vector3(0, 0, size * 1.4));
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        refs.current = { scene, camera, renderer, controls, mesh, overlay, markerSize: size / 250 };
        resize();
        setLoading(false);
        loop();
      })
      .catch((e) => setError(e.message));

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      refs.current = null;
    };
  }, [caseId, record.storedName, record.originalName]);

  // Redraw markers and lines whenever measurements or clicks change.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.overlay.clear();
    const add = (pts: Point[], colour: number) => {
      const material = new THREE.MeshBasicMaterial({ color: colour, depthTest: false });
      for (const p of pts) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r.markerSize, 12, 12), material);
        s.position.set(p[0], p[1], p[2]);
        s.renderOrder = 10;
        r.overlay.add(s);
      }
      if (pts.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))),
          new THREE.LineBasicMaterial({ color: colour, depthTest: false }),
        );
        line.renderOrder = 10;
        r.overlay.add(line);
      }
    };
    for (const m of measurements) add(m.points, m.type === "angle" ? 0xf2b84b : 0x4fd1c5);
    if (clicks.length) add(clicks, 0xffffff);
  }, [measurements, clicks, loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (toolRef.current) {
        setTool(null);
        setClicks([]);
      } else onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  // Click (not drag) on the surface to place a point.
  const down = useRef<[number, number] | null>(null);
  const onPointerDown = (e: React.PointerEvent) => (down.current = [e.clientX, e.clientY]);
  const onPointerUp = (e: React.PointerEvent) => {
    const r = refs.current;
    const start = down.current;
    down.current = null;
    const t = toolRef.current;
    if (!r || !start || !t || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) return;
    if (clicks.length >= POINTS_NEEDED[t]) return;
    const rect = r.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, r.camera);
    const hit = ray.intersectObject(r.mesh)[0];
    if (hit) setClicks((c) => [...c, [hit.point.x, hit.point.y, hit.point.z]]);
  };

  const persist = async (next: Measurement[]) => {
    try {
      const updated = await api.updateRecord(caseId, record.id, { measurements: next });
      setMeasurements(updated.measurements);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ready = tool !== null && clicks.length === POINTS_NEEDED[tool];
  const save = async () => {
    if (!tool || !ready) return;
    const m: Measurement = {
      id: crypto.randomUUID(),
      type: tool,
      value: tool === "angle" ? angleAt(clicks[0], clicks[1], clicks[2]) : distance(clicks[0], clicks[1]),
      calibrated: true,
      label: draft.label.trim(),
      tooth: draft.tooth.trim() || undefined,
      points: clicks,
      createdAt: new Date().toISOString(),
    };
    await persist([...measurements, m]);
    setClicks([]);
    setDraft({ label: "", tooth: "" });
  };

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true" aria-label={record.caption}>
      <div className="viewer">
        <div
          className="viewer-stage"
          ref={mountRef}
          style={{ overflow: "hidden", cursor: tool ? "crosshair" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {loading && !error && (
            <p style={{ color: "#cfd8dc", position: "absolute", inset: "auto 0 50% 0", textAlign: "center" }}>Loading scan…</p>
          )}
        </div>
        <aside className="viewer-side">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>{record.caption || record.originalName}</h3>
            <button onClick={onClose}>Close</button>
          </div>
          <p className="muted small">Drag to rotate, right-drag to pan, scroll to zoom. Scan units are millimetres.</p>
          <div className="toolbar">
            <button className={tool === "distance" ? "active" : ""} onClick={() => { setTool(tool === "distance" ? null : "distance"); setClicks([]); }}>
              Ruler
            </button>
            <button className={tool === "angle" ? "active" : ""} onClick={() => { setTool(tool === "angle" ? null : "angle"); setClicks([]); }}>
              Angle
            </button>
          </div>
          {tool && !ready && (
            <div className="hint">
              {tool === "distance" ? "Click two points on the surface." : "Click three points: first arm, vertex, second arm."} Press Esc to cancel.
            </div>
          )}
          {ready && (
            <form
              className="stack panel"
              style={{ padding: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <p className="mono">
                {tool === "angle"
                  ? `${angleAt(clicks[0], clicks[1], clicks[2]).toFixed(1)}°`
                  : `${distance(clicks[0], clicks[1]).toFixed(2)} mm`}
              </p>
              <label>
                <span>What is this?</span>
                <input id="s-label" autoFocus placeholder="e.g. 36 space mesiodistal" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
              <label>
                <span>Tooth (FDI)</span>
                <input id="s-tooth" placeholder="e.g. 36" value={draft.tooth} onChange={(e) => setDraft({ ...draft, tooth: e.target.value })} />
              </label>
              <div className="row">
                <button className="primary" type="submit">Save measurement</button>
                <button type="button" onClick={() => setClicks([])}>Redo</button>
              </div>
            </form>
          )}
          {error && <div className="error small">{error}</div>}
          <div className="stack" style={{ gap: 6 }}>
            <h3>Measurements</h3>
            {measurements.length === 0 && <p className="muted small">None yet.</p>}
            <div className="mlist">
              {measurements.map((m) => (
                <div key={m.id} className="mitem">
                  <span>
                    {m.tooth && <strong>{m.tooth} </strong>}
                    {m.label || (m.type === "angle" ? "Angle" : "Distance")}
                  </span>
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
        </aside>
      </div>
    </div>
  );
}
