import { describe, expect, it } from "vitest";
import type { CbctSlices } from "../web/src/lib/dicom";
import {
  buildVolume,
  deserializeVolume,
  getSlice,
  gunzip,
  gzip,
  maxProjection,
  planeShape,
  planeToVoxel,
  serializeVolume,
  voxelToPlane,
  type Plane,
} from "../web/src/lib/volume";

/** A 4 x 3 slice whose voxel value encodes its position: z*100 + y*10 + x. */
function slice(z: number, position: number | undefined, extra: Partial<CbctSlices> = {}): CbctSlices {
  const frame = new Int16Array(12);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) frame[y * 4 + x] = z * 100 + y * 10 + x;
  return { width: 4, height: 3, frames: [frame], position, instanceNumber: z + 1, seriesUid: "1.2.3", rowSpacing: 0.3, colSpacing: 0.3, ...extra };
}

describe("buildVolume", () => {
  it("orders slices by position, not by upload order, and measures slice spacing", () => {
    const { volume, meta } = buildVolume([slice(2, 1.0), slice(0, 0.0), slice(1, 0.5)]);
    expect(volume.dims).toEqual([4, 3, 3]);
    expect(volume.spacing).toEqual([0.3, 0.3, 0.5]);
    expect(volume.data[2 * 12 + 1 * 4 + 3]).toBe(213);
    expect(meta.notes).toEqual([]);
  });

  it("falls back to instance number and header spacing", () => {
    const { volume, meta } = buildVolume([slice(1, undefined, { sliceSpacing: 0.4 }), slice(0, undefined, { sliceSpacing: 0.4 })]);
    expect(volume.spacing[2]).toBe(0.4);
    expect(volume.data[12]).toBe(100);
    expect(meta.notes[0]).toMatch(/instance number/);
  });

  it("rejects mixed series and mismatched slice sizes", () => {
    expect(() => buildVolume([slice(0, 0), slice(1, 1, { seriesUid: "9.9" })])).toThrow(/2 different scans/);
    expect(() => buildVolume([slice(0, 0), { ...slice(1, 1), width: 5 }])).toThrow(/not all the same size/);
  });

  it("downsamples very large volumes", () => {
    const { volume, meta } = buildVolume([0, 1, 2, 3].map((z) => slice(z, z * 0.3)), 20);
    expect(volume.dims).toEqual([2, 1, 2]);
    expect(volume.spacing).toEqual([0.6, 0.6, 0.6]);
    expect(meta.notes[0]).toMatch(/reduced by 2x/);
  });
});

describe("planes", () => {
  const { volume } = buildVolume([0, 1, 2, 3, 4].map((z) => slice(z, z)));

  it("maps plane pixels to voxels and back", () => {
    for (const plane of ["axial", "coronal", "sagittal"] as Plane[]) {
      const p = planeToVoxel(volume, plane, 1, 2, 1);
      const back = voxelToPlane(volume, plane, p);
      expect([back.u, back.v, back.index]).toEqual([1, 2, 1]);
    }
  });

  it("cuts slices with superior at the top of coronal and sagittal views", () => {
    expect(planeShape(volume, "coronal")).toMatchObject({ width: 4, height: 5, depth: 3 });
    const coronal = getSlice(volume, "coronal", 2);
    // Top row is the highest z (4), at y = 2.
    expect(coronal[0]).toBe(420);
    expect(coronal[4 * 4]).toBe(20);
    const sagittal = getSlice(volume, "sagittal", 3);
    expect(sagittal[0]).toBe(403);
    expect(getSlice(volume, "axial", 1)[5]).toBe(111);
  });

  it("takes a maximum intensity projection", () => {
    const mip = maxProjection(volume, "axial");
    expect(mip[0]).toBe(400);
  });
});

describe("serialisation", () => {
  it("round-trips through gzip with no data loss", async () => {
    const { volume } = buildVolume([slice(0, 0), slice(1, 0.5)]);
    const back = deserializeVolume(await gunzip(await gzip(serializeVolume(volume))));
    expect(back.dims).toEqual(volume.dims);
    expect(back.spacing).toEqual(volume.spacing);
    expect(Array.from(back.data)).toEqual(Array.from(volume.data));
  });
});
