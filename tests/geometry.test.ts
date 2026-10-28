import { describe, expect, it } from "vitest";
import { angleAt, calibrationFromLine, distance, measuredLength } from "../web/src/lib/geometry";

describe("geometry", () => {
  it("measures 2D and 3D distances", () => {
    expect(distance([0, 0], [3, 4])).toBe(5);
    expect(distance([1, 2, 3], [1, 2, 13])).toBe(10);
  });

  it("measures the angle at the middle point", () => {
    expect(angleAt([1, 0], [0, 0], [0, 1])).toBeCloseTo(90);
    expect(angleAt([1, 0], [0, 0], [1, 1])).toBeCloseTo(45);
    expect(angleAt([1, 0, 0], [0, 0, 0], [-1, 0, 0])).toBeCloseTo(180);
  });

  it("calibrates from a known length and converts later lines to mm", () => {
    const mmPerPx = calibrationFromLine([0, 0], [200, 0], 10);
    expect(mmPerPx).toBeCloseTo(0.05);
    expect(measuredLength([0, 0], [0, 100], mmPerPx)).toEqual({ value: 5, calibrated: true });
    expect(measuredLength([0, 0], [0, 100])).toEqual({ value: 100, calibrated: false });
  });

  it("rejects a zero-length calibration line", () => {
    expect(() => calibrationFromLine([5, 5], [5, 5], 10)).toThrow();
  });
});
