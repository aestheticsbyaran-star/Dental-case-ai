// A CBCT volume: slices stacked into one 3D array, plus helpers to cut planes through it.
// Axes follow the DICOM slices: x = image columns, y = image rows, z = slice order (inferior to superior
// when positions are known). Voxel values are stored as 16-bit integers after rescale.
import type { CbctSlices } from "./dicom";

export interface Volume {
  dims: [number, number, number];
  /** Voxel size in mm along x, y, z. */
  spacing: [number, number, number];
  data: Int16Array;
}

export interface VolumeMeta {
  dims: [number, number, number];
  spacing: [number, number, number];
  sliceCount: number;
  notes: string[];
}

export type Plane = "axial" | "coronal" | "sagittal";

const MAGIC = "DCVOL1";

/** Largest volume we keep at full resolution (about 600 MB of memory as 16-bit). */
export const MAX_VOXELS = 300_000_000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Stacks slices into a volume. Slices from more than one series are rejected, as are slices with
 * different sizes. Very large volumes are downsampled by 2 in every direction.
 */
export function buildVolume(files: CbctSlices[], maxVoxels = MAX_VOXELS): { volume: Volume; meta: VolumeMeta } {
  if (files.length === 0) throw new Error("No CBCT slices were found.");
  const notes: string[] = [];
  const series = new Set(files.map((f) => f.seriesUid).filter(Boolean));
  if (series.size > 1) {
    throw new Error(`These files come from ${series.size} different scans. Upload one CBCT series at a time.`);
  }
  const { width, height } = files[0];
  if (files.some((f) => f.width !== width || f.height !== height)) {
    throw new Error("The slices are not all the same size, so they can't be stacked into one volume.");
  }

  // Order slices by position along the slice normal, else by instance number.
  const havePositions = files.every((f) => f.position !== undefined);
  const ordered = [...files].sort((a, b) =>
    havePositions ? a.position! - b.position! : a.instanceNumber - b.instanceNumber,
  );
  if (!havePositions) notes.push("Slice positions were missing, so slices were ordered by instance number.");

  const frames = ordered.flatMap((f) => f.frames);
  const sx = files[0].colSpacing ?? files[0].rowSpacing;
  const sy = files[0].rowSpacing ?? files[0].colSpacing;
  let sz: number | undefined;
  if (ordered.length > 1 && havePositions) {
    const gaps = ordered.slice(1).map((f, i) => Math.abs(f.position! - ordered[i].position!));
    sz = median(gaps);
    if (gaps.some((g) => Math.abs(g - sz!) > sz! * 0.1)) notes.push("Slice gaps are uneven; the median gap was used.");
  }
  sz ||= files[0].sliceSpacing;
  if (!sx || !sy) {
    notes.push("No pixel spacing in the files; assumed 1 mm voxels, so measurements are not reliable.");
  }
  if (!sz) {
    sz = sx ?? 1;
    notes.push("No slice spacing in the files; assumed cubic voxels.");
  }

  let step = 1;
  while ((width / step) * (height / step) * (frames.length / step) > maxVoxels) step *= 2;
  if (step > 1) notes.push(`The scan was very large, so it was reduced by ${step}x in each direction.`);

  const nx = Math.floor(width / step);
  const ny = Math.floor(height / step);
  const nz = Math.floor(frames.length / step);
  const data = new Int16Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    const src = frames[z * step];
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        data[(z * ny + y) * nx + x] = src[y * step * width + x * step];
      }
    }
  }
  const spacing: [number, number, number] = [(sx ?? 1) * step, (sy ?? 1) * step, sz * step];
  return {
    volume: { dims: [nx, ny, nz], spacing, data },
    meta: { dims: [nx, ny, nz], spacing, sliceCount: frames.length, notes },
  };
}

/** Size of one plane: pixel counts and pixel size in mm. */
export function planeShape(vol: Volume, plane: Plane) {
  const [nx, ny, nz] = vol.dims;
  const [sx, sy, sz] = vol.spacing;
  if (plane === "axial") return { width: nx, height: ny, pw: sx, ph: sy, depth: nz };
  if (plane === "coronal") return { width: nx, height: nz, pw: sx, ph: sz, depth: ny };
  return { width: ny, height: nz, pw: sy, ph: sz, depth: nx };
}

/** Maps a pixel (u, v) on a plane at a given slice index to voxel coordinates. */
export function planeToVoxel(vol: Volume, plane: Plane, u: number, v: number, index: number): [number, number, number] {
  const nz = vol.dims[2];
  // Coronal and sagittal views put superior (high z) at the top.
  if (plane === "axial") return [u, v, index];
  if (plane === "coronal") return [u, index, nz - 1 - v];
  return [index, u, nz - 1 - v];
}

/** Inverse of planeToVoxel: where a voxel falls on a plane, and which slice it is on. */
export function voxelToPlane(vol: Volume, plane: Plane, p: [number, number, number]): { u: number; v: number; index: number } {
  const nz = vol.dims[2];
  if (plane === "axial") return { u: p[0], v: p[1], index: p[2] };
  if (plane === "coronal") return { u: p[0], v: nz - 1 - p[2], index: p[1] };
  return { u: p[1], v: nz - 1 - p[2], index: p[0] };
}

export const voxelToMm = (vol: Volume, p: number[]): [number, number, number] => [
  p[0] * vol.spacing[0],
  p[1] * vol.spacing[1],
  p[2] * vol.spacing[2],
];
export const mmToVoxel = (vol: Volume, p: number[]): [number, number, number] => [
  p[0] / vol.spacing[0],
  p[1] / vol.spacing[1],
  p[2] / vol.spacing[2],
];

/** Values of one slice through the volume. */
export function getSlice(vol: Volume, plane: Plane, index: number): Int16Array {
  const { width, height, depth } = planeShape(vol, plane);
  const i = Math.max(0, Math.min(depth - 1, Math.round(index)));
  const out = new Int16Array(width * height);
  const [nx, ny] = vol.dims;
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const [x, y, z] = planeToVoxel(vol, plane, u, v, i);
      out[v * width + u] = vol.data[(z * ny + y) * nx + x];
    }
  }
  return out;
}

/** Maximum intensity projection through a slab (whole volume by default). */
export function maxProjection(vol: Volume, plane: Plane, from = 0, to?: number): Int16Array {
  const { width, height, depth } = planeShape(vol, plane);
  const end = Math.min(depth - 1, to ?? depth - 1);
  const out = new Int16Array(width * height).fill(-32768);
  for (let i = Math.max(0, from); i <= end; i++) {
    const s = getSlice(vol, plane, i);
    for (let k = 0; k < s.length; k++) if (s[k] > out[k]) out[k] = s[k];
  }
  return out;
}

/** Window (low, high) from percentiles of a sample of voxels. */
export function percentileWindow(vol: Volume, lowPct: number, highPct: number): [number, number] {
  const step = Math.max(1, Math.floor(vol.data.length / 200_000));
  const sample: number[] = [];
  for (let i = 0; i < vol.data.length; i += step) sample.push(vol.data[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor((sample.length - 1) * lowPct)];
  const hi = sample[Math.floor((sample.length - 1) * highPct)];
  return [lo, hi > lo ? hi : lo + 1];
}

/** Contrast presets. CBCT grey values aren't true Hounsfield units, so these are relative to the scan. */
export function windowPresets(vol: Volume): Record<"Auto" | "Bone" | "Teeth" | "Soft tissue", [number, number]> {
  return {
    Auto: percentileWindow(vol, 0.01, 0.995),
    Bone: percentileWindow(vol, 0.4, 0.999),
    Teeth: percentileWindow(vol, 0.85, 0.9995),
    "Soft tissue": percentileWindow(vol, 0.05, 0.7),
  };
}

/** Axial slice with the most very dense voxels: usually the level of the crowns. */
export function densestAxialSlice(vol: Volume): number {
  const [nx, ny, nz] = vol.dims;
  const [, threshold] = percentileWindow(vol, 0, 0.995);
  let best = Math.floor(nz / 2);
  let bestCount = -1;
  for (let z = 0; z < nz; z++) {
    let count = 0;
    const base = z * nx * ny;
    for (let k = 0; k < nx * ny; k += 2) if (vol.data[base + k] >= threshold) count++;
    if (count > bestCount) {
      bestCount = count;
      best = z;
    }
  }
  return best;
}

export function windowToRgba(values: Int16Array, lo: number, hi: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(values.length * 4);
  const range = hi - lo || 1;
  for (let i = 0; i < values.length; i++) {
    const g = ((values[i] - lo) / range) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Packs a volume as: magic, header length, JSON header, then 16-bit voxels. No patient data. */
export function serializeVolume(vol: Volume): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(JSON.stringify({ dims: vol.dims, spacing: vol.spacing }));
  const headerPadded = header.length + ((header.length + MAGIC.length + 4) % 2);
  const out = new Uint8Array(MAGIC.length + 4 + headerPadded + vol.data.byteLength);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(MAGIC.length, headerPadded, true);
  out.fill(0x20, MAGIC.length + 4, MAGIC.length + 4 + headerPadded);
  out.set(header, MAGIC.length + 4);
  out.set(new Uint8Array(vol.data.buffer, vol.data.byteOffset, vol.data.byteLength), MAGIC.length + 4 + headerPadded);
  return out;
}

export function deserializeVolume(bytes: Uint8Array): Volume {
  if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) throw new Error("This is not a saved CBCT volume.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(MAGIC.length, true);
  const start = MAGIC.length + 4;
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + headerLength)));
  const dataStart = bytes.byteOffset + start + headerLength;
  const count = header.dims[0] * header.dims[1] * header.dims[2];
  const data = new Int16Array(bytes.buffer.slice(dataStart, dataStart + count * 2));
  return { dims: header.dims, spacing: header.spacing, data };
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export const gzip = (bytes: Uint8Array<ArrayBuffer>) => pipe(bytes, new CompressionStream("gzip"));
export const gunzip = (bytes: Uint8Array<ArrayBuffer>) => pipe(bytes, new DecompressionStream("gzip"));
