// Reads 2D DICOM images (and the middle frame of multi-frame files) in the browser.
// Only the pixels and pixel spacing are kept; patient details in the header never leave this computer.
import * as dicomParser from "dicom-parser";

const UNCOMPRESSED = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"]);
const JPEG_BASELINE = new Set(["1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51"]);

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

export function isLikelyDicom(bytes: Uint8Array, name: string): boolean {
  if (/\.(dcm|dicom)$/i.test(name)) return true;
  return bytes.length > 132 && String.fromCharCode(...bytes.subarray(128, 132)) === "DICM";
}

function spacing(ds: dicomParser.DataSet): Pick<DicomImage, "mmPerPixel" | "spacingSource"> {
  for (const [tag, source] of [
    ["x00280030", "pixel-spacing"],
    ["x00181164", "imager-pixel-spacing"],
  ] as const) {
    const row = ds.floatString(tag, 0);
    const col = ds.floatString(tag, 1);
    if (row && col && row > 0 && col > 0) {
      // Non-square pixels are rare in dental imaging; use the mean and note it is approximate.
      return { mmPerPixel: (row + col) / 2, spacingSource: source };
    }
  }
  return {};
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

export function readDicom(bytes: Uint8Array): DicomImage {
  const ds = dicomParser.parseDicom(bytes);
  const transfer = ds.string("x00020010") ?? "1.2.840.10008.1.2";
  const width = ds.uint16("x00280011") ?? 0;
  const height = ds.uint16("x00280010") ?? 0;
  const pixel = ds.elements.x7fe00010;
  if (!pixel || !width || !height) throw new UnsupportedDicomError("This DICOM file has no image in it.");

  const frameCount = Number(ds.intString("x00280008") ?? 1) || 1;
  const frame = Math.floor(frameCount / 2);
  const base = { width, height, modality: ds.string("x00080060") ?? "", frameCount, frameShown: frame + 1, ...spacing(ds) };

  if (JPEG_BASELINE.has(transfer)) {
    const jpeg = dicomParser.readEncapsulatedImageFrame(ds, pixel, frame);
    return { ...base, jpeg: new Uint8Array(jpeg) };
  }
  if (!UNCOMPRESSED.has(transfer)) {
    throw new UnsupportedDicomError(
      "This DICOM file uses a compression this version can't read yet. Export it from your imaging software as JPEG or PNG instead.",
    );
  }
  if (transfer === "1.2.840.10008.1.2.2") {
    throw new UnsupportedDicomError("Big-endian DICOM isn't supported. Export it as JPEG or PNG instead.");
  }

  const samples = ds.uint16("x00280002") ?? 1;
  const bits = ds.uint16("x00280100") ?? 16;
  const signed = (ds.uint16("x00280103") ?? 0) === 1;
  const photometric = (ds.string("x00280004") ?? "MONOCHROME2").trim();
  const frameLength = width * height * samples * (bits / 8);
  const offset = pixel.dataOffset + frameLength * frame;
  const buffer = bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + frameLength);

  if (samples === 3 && bits === 8) {
    // Colour (e.g. clinical photos stored as DICOM). Assume interleaved RGB.
    const src = new Uint8Array(buffer);
    const rgba = new Uint8ClampedArray(width * height * 4);
    const planar = ds.uint16("x00280006") === 1;
    const plane = width * height;
    for (let i = 0; i < plane; i++) {
      rgba[i * 4] = planar ? src[i] : src[i * 3];
      rgba[i * 4 + 1] = planar ? src[plane + i] : src[i * 3 + 1];
      rgba[i * 4 + 2] = planar ? src[2 * plane + i] : src[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return { ...base, rgba };
  }
  if (samples !== 1) throw new UnsupportedDicomError("This DICOM colour format isn't supported yet.");

  const values =
    bits === 8 ? new Uint8Array(buffer) : signed ? new Int16Array(buffer) : new Uint16Array(buffer);
  const rgba = toGreyscaleRgba(values, {
    slope: ds.floatString("x00281053") ?? 1,
    intercept: ds.floatString("x00281052") ?? 0,
    center: ds.floatString("x00281050", 0),
    width: ds.floatString("x00281051", 0),
    invert: photometric === "MONOCHROME1",
  });
  return { ...base, rgba };
}
