// Reads DICOM files in the browser: single 2D radiographs, and the slices that make up a CBCT.
// Only pixels and geometry are kept; patient details in the header never leave this computer.
import * as dicomParser from "dicom-parser";
import { Decoder as LosslessDecoder } from "jpeg-lossless-decoder-js";

const UNCOMPRESSED = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"]);
const JPEG_BASELINE = new Set(["1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51"]);
// JPEG lossless (process 14, and its first-order prediction variant) is common in CBCT exports.
const JPEG_LOSSLESS = new Set(["1.2.840.10008.1.2.4.57", "1.2.840.10008.1.2.4.70"]);

export interface DicomImage {
  /** RGBA pixels, or an encoded JPEG for JPEG-compressed files. */
  rgba?: Uint8ClampedArray;
  jpeg?: Uint8Array;
  width: number;
  height: number;
  /** mm per pixel from Pixel Spacing or Imager Pixel Spacing, if present. */
  mmPerPixel?: number;
  spacingSource?: "pixel-spacing" | "imager-pixel-spacing";
  modality: string;
  frameCount: number;
  frameShown: number;
}

export class UnsupportedDicomError extends Error {}

/** CBCT exports often have no file extension, so check the "DICM" marker as well. */
export function isLikelyDicom(bytes: Uint8Array, name: string): boolean {
  if (/\.(dcm|dicom)$/i.test(name)) return true;
  return bytes.length > 132 && String.fromCharCode(...bytes.subarray(128, 132)) === "DICM";
}

type DataSet = dicomParser.DataSet;

/** Reads a value from the enhanced multi-frame shared functional groups, if present. */
function sharedGroup(ds: DataSet, sequenceTag: string): DataSet | undefined {
  const shared = ds.elements.x52009229?.items?.[0]?.dataSet;
  return shared?.elements[sequenceTag]?.items?.[0]?.dataSet;
}

function pixelSpacing(ds: DataSet): { row: number; col: number; source: "pixel-spacing" | "imager-pixel-spacing" } | undefined {
  const candidates: [DataSet | undefined, string, "pixel-spacing" | "imager-pixel-spacing"][] = [
    [ds, "x00280030", "pixel-spacing"],
    [sharedGroup(ds, "x00289110"), "x00280030", "pixel-spacing"],
    [ds, "x00181164", "imager-pixel-spacing"],
  ];
  for (const [set, tag, source] of candidates) {
    const row = set?.floatString(tag, 0);
    const col = set?.floatString(tag, 1);
    if (row && col && row > 0 && col > 0) return { row, col, source };
  }
  return undefined;
}

interface PixelInfo {
  transfer: string;
  width: number;
  height: number;
  samples: number;
  bits: number;
  signed: boolean;
  frameCount: number;
}

function pixelInfo(ds: DataSet): PixelInfo {
  return {
    transfer: (ds.string("x00020010") ?? "1.2.840.10008.1.2").replace(/\0/g, "").trim(),
    width: ds.uint16("x00280011") ?? 0,
    height: ds.uint16("x00280010") ?? 0,
    samples: ds.uint16("x00280002") ?? 1,
    bits: ds.uint16("x00280100") ?? 16,
    signed: (ds.uint16("x00280103") ?? 0) === 1,
    frameCount: Number(ds.intString("x00280008") ?? 1) || 1,
  };
}

function checkTransfer(transfer: string) {
  if (transfer === "1.2.840.10008.1.2.2") {
    throw new UnsupportedDicomError("Big-endian DICOM isn't supported. Export it as JPEG or PNG instead.");
  }
  if (!UNCOMPRESSED.has(transfer) && !JPEG_LOSSLESS.has(transfer) && !JPEG_BASELINE.has(transfer)) {
    throw new UnsupportedDicomError(
      "This DICOM file uses a compression this version can't read yet (often JPEG 2000). Export it uncompressed from your imaging software, or as JPEG/PNG for single images.",
    );
  }
}

/** Raw stored greyscale values for one frame (before rescale). */
function frameValues(ds: DataSet, bytes: Uint8Array, info: PixelInfo, frame: number): Uint8Array | Uint16Array | Int16Array {
  const pixel = ds.elements.x7fe00010;
  if (JPEG_LOSSLESS.has(info.transfer)) {
    const encoded = dicomParser.readEncapsulatedImageFrame(ds, pixel, frame);
    const copy = new Uint8Array(encoded).buffer;
    const decoded = new LosslessDecoder().decode(copy, 0, copy.byteLength, info.bits <= 8 ? 1 : 2);
    if (info.bits <= 8) return new Uint8Array(decoded.buffer, decoded.byteOffset, info.width * info.height);
    return info.signed
      ? new Int16Array(decoded.buffer, decoded.byteOffset, info.width * info.height)
      : new Uint16Array(decoded.buffer, decoded.byteOffset, info.width * info.height);
  }
  const frameLength = info.width * info.height * (info.bits / 8);
  const offset = pixel.dataOffset + frameLength * frame;
  const buffer = bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + frameLength);
  if (info.bits === 8) return new Uint8Array(buffer);
  return info.signed ? new Int16Array(buffer) : new Uint16Array(buffer);
}

/** Converts raw stored values to 8-bit greyscale using rescale and VOI windowing. */
export function toGreyscaleRgba(
  values: ArrayLike<number>,
  opts: { slope: number; intercept: number; center?: number; width?: number; invert: boolean },
): Uint8ClampedArray {
  const n = values.length;
  let lo: number;
  let hi: number;
  if (opts.center !== undefined && opts.width !== undefined && opts.width > 1) {
    lo = opts.center - opts.width / 2;
    hi = opts.center + opts.width / 2;
  } else {
    // No window in the header: use the 0.5th-99.5th percentile so outliers don't flatten contrast.
    const sample: number[] = [];
    const step = Math.max(1, Math.floor(n / 50000));
    for (let i = 0; i < n; i += step) sample.push(values[i] * opts.slope + opts.intercept);
    sample.sort((a, b) => a - b);
    lo = sample[Math.floor(sample.length * 0.005)] ?? 0;
    hi = sample[Math.floor(sample.length * 0.995)] ?? 1;
    if (hi <= lo) hi = lo + 1;
  }
  const out = new Uint8ClampedArray(n * 4);
  const range = hi - lo;
  for (let i = 0; i < n; i++) {
    const v = values[i] * opts.slope + opts.intercept;
    let g = ((v - lo) / range) * 255;
    if (opts.invert) g = 255 - g;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Reads a single 2D image (or the middle frame of a multi-frame file) for display. */
export function readDicom(bytes: Uint8Array): DicomImage {
  const ds = dicomParser.parseDicom(bytes);
  const info = pixelInfo(ds);
  if (!ds.elements.x7fe00010 || !info.width || !info.height) throw new UnsupportedDicomError("This DICOM file has no image in it.");
  checkTransfer(info.transfer);

  const frame = Math.floor(info.frameCount / 2);
  const sp = pixelSpacing(ds);
  const base = {
    width: info.width,
    height: info.height,
    modality: ds.string("x00080060") ?? "",
    frameCount: info.frameCount,
    frameShown: frame + 1,
    // Non-square pixels are rare in dental imaging; use the mean.
    mmPerPixel: sp ? (sp.row + sp.col) / 2 : undefined,
    spacingSource: sp?.source,
  };

  if (JPEG_BASELINE.has(info.transfer)) {
    const jpeg = dicomParser.readEncapsulatedImageFrame(ds, ds.elements.x7fe00010, frame);
    return { ...base, jpeg: new Uint8Array(jpeg) };
  }

  if (info.samples === 3 && info.bits === 8 && UNCOMPRESSED.has(info.transfer)) {
    // Colour (e.g. clinical photos stored as DICOM).
    const pixel = ds.elements.x7fe00010;
    const plane = info.width * info.height;
    const src = bytes.subarray(pixel.dataOffset + plane * 3 * frame, pixel.dataOffset + plane * 3 * (frame + 1));
    const rgba = new Uint8ClampedArray(plane * 4);
    const planar = ds.uint16("x00280006") === 1;
    for (let i = 0; i < plane; i++) {
      rgba[i * 4] = planar ? src[i] : src[i * 3];
      rgba[i * 4 + 1] = planar ? src[plane + i] : src[i * 3 + 1];
      rgba[i * 4 + 2] = planar ? src[2 * plane + i] : src[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return { ...base, rgba };
  }
  if (info.samples !== 1) throw new UnsupportedDicomError("This DICOM colour format isn't supported yet.");

  const rgba = toGreyscaleRgba(frameValues(ds, bytes, info, frame), {
    slope: ds.floatString("x00281053") ?? 1,
    intercept: ds.floatString("x00281052") ?? 0,
    center: ds.floatString("x00281050", 0),
    width: ds.floatString("x00281051", 0),
    invert: (ds.string("x00280004") ?? "").trim() === "MONOCHROME1",
  });
  return { ...base, rgba };
}

/** One CBCT slice (or every frame of a multi-frame CBCT file), rescaled and ready to stack. */
export interface CbctSlices {
  width: number;
  height: number;
  /** Rescaled values for each frame in this file, as 16-bit integers to keep memory down. */
  frames: Int16Array[];
  /** Position of the first frame along the slice normal, in mm, if known. */
  position?: number;
  instanceNumber: number;
  seriesUid: string;
  rowSpacing?: number;
  colSpacing?: number;
  /** Spacing between frames from the header (used for multi-frame files or as a fallback). */
  sliceSpacing?: number;
}

function sliceNormalPosition(ds: DataSet): number | undefined {
  const pos = [0, 1, 2].map((i) => ds.floatString("x00200032", i));
  if (pos.some((v) => v === undefined)) return undefined;
  const o = [0, 1, 2, 3, 4, 5].map((i) => ds.floatString("x00200037", i));
  if (o.some((v) => v === undefined)) return pos[2];
  const [r0, r1, r2, c0, c1, c2] = o as number[];
  const normal = [r1 * c2 - r2 * c1, r2 * c0 - r0 * c2, r0 * c1 - r1 * c0];
  return normal[0] * pos[0]! + normal[1] * pos[1]! + normal[2] * pos[2]!;
}

export function readCbctFile(bytes: Uint8Array): CbctSlices {
  const ds = dicomParser.parseDicom(bytes);
  const info = pixelInfo(ds);
  if (!ds.elements.x7fe00010 || !info.width || !info.height) throw new UnsupportedDicomError("A file in this series has no image in it.");
  checkTransfer(info.transfer);
  if (JPEG_BASELINE.has(info.transfer)) {
    throw new UnsupportedDicomError("This CBCT uses lossy JPEG compression, which isn't suitable for measuring. Export it uncompressed.");
  }
  if (info.samples !== 1) throw new UnsupportedDicomError("Colour CBCT data isn't supported.");

  const slope = ds.floatString("x00281053") ?? 1;
  const intercept = ds.floatString("x00281052") ?? 0;
  const frames: Int16Array[] = [];
  for (let f = 0; f < info.frameCount; f++) {
    const raw = frameValues(ds, bytes, info, f);
    const out = new Int16Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const v = Math.round(raw[i] * slope + intercept);
      out[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
    }
    frames.push(out);
  }
  const sp = pixelSpacing(ds);
  const measures = sharedGroup(ds, "x00289110");
  return {
    width: info.width,
    height: info.height,
    frames,
    position: sliceNormalPosition(ds),
    instanceNumber: Number(ds.intString("x00200013") ?? 0) || 0,
    seriesUid: (ds.string("x0020000e") ?? "").trim(),
    rowSpacing: sp?.row,
    colSpacing: sp?.col,
    sliceSpacing:
      ds.floatString("x00180088") ?? measures?.floatString("x00180088") ?? ds.floatString("x00180050") ?? measures?.floatString("x00180050"),
  };
}
