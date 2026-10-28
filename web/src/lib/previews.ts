// Turns an uploaded file into de-identified preview images in the browser.
// Photos are re-drawn on a canvas, which drops EXIF data (GPS, device, dates).
// DICOM headers are read locally for pixel spacing and then discarded.
// Intraoral scans are rendered from several angles so Claude can see them.
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { RadiographView, RecordKind } from "../../../shared/types";
import { isLikelyDicom, readDicom } from "./dicom";

/** Long edge of the stored preview, which is also the image you measure on. */
export const PREVIEW_MAX_EDGE = 2400;

export interface PreparedRecord {
  kind: RecordKind;
  view?: RadiographView;
  previews: Blob[];
  /** mm per pixel of previews[0]. */
  mmPerPixel?: number;
  note?: string;
}

export function guessKind(name: string): RecordKind | "unknown" {
  const n = name.toLowerCase();
  if (/\.(stl|ply)$/.test(n)) return "scan";
  if (/\.(dcm|dicom)$/.test(n)) return "dicom";
  if (/\.(jpe?g|png|heic|webp|bmp|tiff?)$/.test(n)) return "photo";
  if (/\.(pdf|txt|docx?)$/.test(n)) return "document";
  return "unknown";
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create image"))), "image/jpeg", quality),
  );
}

function fitCanvas(width: number, height: number, maxEdge = PREVIEW_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  return { canvas, scale, ctx: canvas.getContext("2d")! };
}

async function imagePreview(file: Blob): Promise<{ blob: Blob; scale: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image format can't be opened in the browser. Save it as JPEG or PNG and try again.");
  }
  const { canvas, ctx, scale } = fitCanvas(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { blob: await canvasToJpeg(canvas), scale };
}

async function dicomPreview(bytes: Uint8Array): Promise<PreparedRecord> {
  const img = readDicom(bytes);
  let source: Blob;
  if (img.jpeg) {
    source = new Blob([img.jpeg as BlobPart], { type: "image/jpeg" });
  } else {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.putImageData(new ImageData(img.rgba! as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
    source = await canvasToJpeg(c, 0.95);
  }
  const { blob, scale } = await imagePreview(source);
  const view: RadiographView | undefined = img.frameCount > 1 || img.modality === "CT" ? "cbct-slice" : undefined;
  const notes: string[] = [];
  if (img.frameCount > 1) notes.push(`Multi-frame file: showing frame ${img.frameShown} of ${img.frameCount}.`);
  if (img.spacingSource === "imager-pixel-spacing") notes.push("Calibration is from detector spacing, so magnification is not corrected.");
  if (!img.mmPerPixel) notes.push("No pixel spacing in this file. Calibrate it with a known length before measuring.");
  return {
    kind: "dicom",
    view,
    previews: [blob],
    mmPerPixel: img.mmPerPixel ? img.mmPerPixel / scale : undefined,
    note: notes.join(" ") || undefined,
  };
}

export async function loadMesh(buffer: ArrayBuffer, name: string): Promise<THREE.BufferGeometry> {
  const geometry = /\.ply$/i.test(name) ? new PLYLoader().parse(buffer) : new STLLoader().parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

export function meshMaterial(geometry: THREE.BufferGeometry): THREE.Material {
  return geometry.getAttribute("color")
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })
    : new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.55, metalness: 0.02 });
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1, 1.5, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-2, -1, 1);
  scene.add(fill);
}

/** Renders the mesh from six directions around its bounding box. */
async function scanPreviews(geometry: THREE.BufferGeometry): Promise<Blob[]> {
  const width = 1200;
  const height = 900;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x20262b);
  const scene = new THREE.Scene();
  addLights(scene);
  const mesh = new THREE.Mesh(geometry, meshMaterial(geometry));
  scene.add(mesh);

  const box = geometry.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const camera = new THREE.PerspectiveCamera(30, width / height, radius / 100, radius * 20);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.9;
  const directions: [THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
  ];
  const blobs: Blob[] = [];
  for (const [dir, up] of directions) {
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.up.copy(up);
    camera.lookAt(center);
    renderer.render(scene, camera);
    blobs.push(await canvasToJpeg(renderer.domElement, 0.9));
  }
  renderer.dispose();
  return blobs;
}

export async function prepareRecord(file: File, chosenKind: RecordKind): Promise<PreparedRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (chosenKind === "scan") {
    const geometry = await loadMesh(bytes.buffer, file.name);
    if (!geometry.getAttribute("position")?.count) throw new Error("This scan file has no geometry in it.");
    return {
      kind: "scan",
      previews: await scanPreviews(geometry),
      note: "Scan orientation varies between scanners, so the six rendered views may not line up with occlusal/buccal.",
    };
  }
  if (chosenKind === "dicom" || isLikelyDicom(bytes, file.name)) {
    return dicomPreview(bytes);
  }
  if (chosenKind === "document") {
    return { kind: "document", previews: [], note: "Documents are stored with the case but not yet sent to Claude. Paste key text into the notes." };
  }
  const { blob } = await imagePreview(file);
  return { kind: chosenKind, previews: [blob] };
}
