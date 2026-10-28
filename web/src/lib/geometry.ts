// Measurement maths, kept separate so it can be tested without a browser.

export type Point = number[];

export function distance(a: Point, b: Point): number {
  let sum = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) sum += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return Math.sqrt(sum);
}

/** Angle at vertex b formed by a-b-c, in degrees (0-180). */
export function angleAt(a: Point, b: Point, c: Point): number {
  const u = a.map((v, i) => v - (b[i] ?? 0));
  const w = c.map((v, i) => v - (b[i] ?? 0));
  const dot = u.reduce((s, v, i) => s + v * (w[i] ?? 0), 0);
  const len = Math.sqrt(u.reduce((s, v) => s + v * v, 0)) * Math.sqrt(w.reduce((s, v) => s + v * v, 0));
  if (len === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot / len))) * 180) / Math.PI;
}

/** mm per pixel from a line of known length drawn on the image. */
export function calibrationFromLine(a: Point, b: Point, knownMm: number): number {
  const px = distance(a, b);
  if (px <= 0 || !(knownMm > 0)) throw new Error("Draw a longer line and enter a length above 0 mm.");
  return knownMm / px;
}

/** Distance in mm if calibrated, otherwise in pixels. */
export function measuredLength(a: Point, b: Point, mmPerPixel?: number): { value: number; calibrated: boolean } {
  const px = distance(a, b);
  return mmPerPixel ? { value: px * mmPerPixel, calibrated: true } : { value: px, calibrated: false };
}
