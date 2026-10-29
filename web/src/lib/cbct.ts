// Browser side of CBCT handling: reads a folder of slices, builds the volume, and renders views.
import type { VolumeInfo } from "../../../shared/types";
import { isLikelyDicom, readCbctFile, type CbctSlices } from "./dicom";
import {
  buildVolume,
  densestAxialSlice,
  getSlice,
  gzip,
  maxProjection,
  planeShape,
  serializeVolume,
  windowPresets,
  windowToRgba,
  type Plane,
  type Volume,
} from "./volume";

export const PLANE_LABEL: Record<Plane, string> = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal" };

/**
 * Draws plane values onto a canvas with square on-screen pixels, correcting for voxels that aren't
 * the same size in every direction.
 */
export function renderPlane(values: Int16Array, vol: Volume, plane: Plane, lo: number, hi: number): HTMLCanvasElement {
  const { width, height, pw, ph } = planeShape(vol, plane);
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  src.getContext("2d")!.putImageData(new ImageData(windowToRgba(values, lo, hi), width, height), 0, 0);
  const unit = Math.min(pw, ph);
  const out = document.createElement("canvas");
  out.width = Math.round((width * pw) / unit);
  out.height = Math.round((height * ph) / unit);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create image"))), "image/jpeg", 0.9),
  );
}

/** Upscales small renders so Claude gets a readable image, and caps big ones. */
function sizeForAi(canvas: HTMLCanvasElement, target = 1200): HTMLCanvasElement {
  const scale = target / Math.max(canvas.width, canvas.height);
  if (Math.abs(scale - 1) < 0.05) return canvas;
  const out = document.createElement("canvas");
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext("2d")!.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

export async function canvasToAiJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return toJpeg(sizeForAi(canvas));
}

/** Overview images for the AI: two projections and three representative slices. */
async function overviewViews(vol: Volume): Promise<{ blobs: Blob[]; labels: string[] }> {
  const [nx, ny, nz] = vol.dims;
  const { Bone: bone, Teeth: teeth } = windowPresets(vol);
  const teethZ = densestAxialSlice(vol);
  const views: [Int16Array, Plane, [number, number], string][] = [
    [maxProjection(vol, "coronal"), "coronal", teeth, "Coronal maximum intensity projection of the whole volume (front view, patient's right on the left)"],
    [maxProjection(vol, "sagittal"), "sagittal", teeth, "Sagittal maximum intensity projection of the whole volume (side view)"],
    [getSlice(vol, "axial", teethZ), "axial", bone, `Axial slice ${teethZ + 1} of ${nz}, the level with most dense structures (usually crowns)`],
    [getSlice(vol, "coronal", Math.floor(ny / 2)), "coronal", bone, "Coronal slice through the middle of the volume"],
    [getSlice(vol, "sagittal", Math.floor(nx / 2)), "sagittal", bone, "Mid-sagittal slice"],
  ];
  const blobs: Blob[] = [];
  const labels: string[] = [];
  for (const [values, plane, [lo, hi], label] of views) {
    blobs.push(await canvasToAiJpeg(renderPlane(values, vol, plane, lo, hi)));
    labels.push(label);
  }
  return { blobs, labels };
}

export interface PreparedCbct {
  /** Compressed volume file: voxels and geometry only, no DICOM headers. */
  volumeFile: File;
  previews: Blob[];
  previewLabels: string[];
  volume: VolumeInfo;
}

/** Reads every DICOM file in the selection, builds the volume, and makes overview images. */
export async function prepareCbct(files: File[], onProgress: (message: string) => void): Promise<PreparedCbct> {
  const slices: CbctSlices[] = [];
  let skipped = 0;
  for (let i = 0; i < files.length; i++) {
    if (i % 10 === 0) {
      onProgress(`Reading slice ${i + 1} of ${files.length}`);
      await new Promise((r) => setTimeout(r)); // let the page repaint
    }
    const f = files[i];
    if (/^dicomdir$/i.test(f.name)) {
      skipped++;
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!isLikelyDicom(bytes, f.name)) {
      skipped++;
      continue;
    }
    slices.push(readCbctFile(bytes));
  }
  onProgress("Building the 3D volume");
  await new Promise((r) => setTimeout(r));
  const { volume, meta } = buildVolume(slices);
  if (skipped) meta.notes.push(`${skipped} file(s) in the folder were not CBCT slices and were skipped.`);

  onProgress("Making overview images");
  const { blobs, labels } = await overviewViews(volume);

  onProgress("Compressing the volume");
  const packed = await gzip(serializeVolume(volume));
  const volumeFile = new File([packed], `cbct-${meta.sliceCount}-slices.dcvol.gz`, { type: "application/gzip" });
  return { volumeFile, previews: blobs, previewLabels: labels, volume: meta };
}
