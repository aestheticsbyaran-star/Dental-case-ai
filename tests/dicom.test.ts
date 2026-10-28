import { describe, expect, it } from "vitest";
import { toGreyscaleRgba } from "../web/src/lib/dicom";

describe("toGreyscaleRgba", () => {
  it("applies the window from the header", () => {
    const out = toGreyscaleRgba([0, 50, 100], { slope: 1, intercept: 0, center: 50, width: 100, invert: false });
    expect([out[0], out[4], out[8]]).toEqual([0, 128, 255]);
    expect(out[3]).toBe(255);
  });

  it("inverts MONOCHROME1 images", () => {
    const out = toGreyscaleRgba([0, 100], { slope: 1, intercept: 0, center: 50, width: 100, invert: true });
    expect([out[0], out[4]]).toEqual([255, 0]);
  });

  it("applies rescale slope and intercept", () => {
    const out = toGreyscaleRgba([0, 10], { slope: 10, intercept: -50, center: 0, width: 100, invert: false });
    // 0 -> -50 (black), 10 -> 50 (white)
    expect([out[0], out[4]]).toEqual([0, 255]);
  });
});
