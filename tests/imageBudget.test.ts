import { describe, expect, it } from "vitest";
import { selectImages } from "../shared/imageBudget";
import type { CaseRecord } from "../shared/types";

const rec = (id: string, kind: CaseRecord["kind"], n: number): CaseRecord => ({
  id,
  kind,
  originalName: id,
  storedName: id,
  mimeType: "",
  size: 1,
  uploadedAt: "",
  caption: id,
  previews: Array.from({ length: n }, (_, i) => `${id}-${i}.jpg`),
  includeInAnalysis: true,
  measurements: [],
});

describe("selectImages", () => {
  it("keeps the OPG and photos when scans and CBCT come first", () => {
    const records = [rec("cbct", "cbct", 7), rec("upper", "scan", 6), rec("lower", "scan", 6), rec("bite", "scan", 6), rec("opg", "dicom", 1), rec("photo1", "photo", 1), rec("photo2", "photo", 1)];
    const chosen = selectImages(records, 24);
    expect(chosen).toHaveLength(24);
    const has = (r: number, p: number) => chosen.some((c) => c.recordIndex === r && c.previewIndex === p);
    expect(has(4, 0) && has(5, 0) && has(6, 0)).toBe(true);
    // Hand-picked CBCT views (index 5 and 6) are kept.
    expect(has(0, 5) && has(0, 6)).toBe(true);
    // Results come back grouped in record order.
    const keys = chosen.map((c) => c.recordIndex * 100 + c.previewIndex);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });

  it("sends everything when under the limit", () => {
    expect(selectImages([rec("a", "photo", 3), rec("b", "scan", 6)], 40)).toHaveLength(9);
  });
});
