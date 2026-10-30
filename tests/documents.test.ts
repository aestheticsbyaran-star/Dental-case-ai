import { describe, expect, it } from "vitest";
import { DOCUMENT_SCHEMAS, buildDocumentText, documentImages, documentSystemPrompt } from "../server/documents";
import { defaultBrand, emptyDetails, type Analysis, type Case, type CaseRecord } from "../shared/types";

const record = (over: Partial<CaseRecord>): CaseRecord => ({
  id: "r1",
  kind: "photo",
  originalName: "img.jpg",
  storedName: "x.jpg",
  mimeType: "image/jpeg",
  size: 1,
  uploadedAt: "",
  caption: "",
  previews: ["p.jpg"],
  includeInAnalysis: true,
  measurements: [],
  ...over,
});

const analysis: Analysis = {
  id: "a1",
  createdAt: "",
  model: "m",
  question: "",
  inputSummary: { recordIds: [], imageCount: 0, measurementCount: 0 },
  status: "complete",
  output: {
    caseSummary: "Missing 36.",
    findings: [
      { tooth: "36", finding: "Missing", basis: "clinician-notes", source: "notes", confidence: "high" },
      { tooth: "37", finding: "Possible caries distally", basis: "visual-impression", source: "BW", confidence: "low" },
    ],
    treatmentOptions: [
      { title: "Implant at 36", description: "Single implant", addresses: [], advantages: ["Fixed"], disadvantages: ["Surgery"], prerequisites: [] },
    ],
    risksAndFlags: [],
    missingInformation: [],
    suggestedNextSteps: [],
  },
  review: { verdict: "agreed", finalPlan: "Implant 36 after perio stabilisation", comments: "" },
};

const c: Case = {
  id: "c1",
  createdAt: "",
  updatedAt: "",
  details: { ...emptyDetails(), reference: "2026-014", age: 52, chiefComplaint: "gap at the back" },
  records: [
    record({ id: "scan", kind: "scan", caption: "Lower scan", previews: ["s0.png", "s1.png", "s2.png"] }),
    record({ id: "opg", kind: "radiograph", view: "opg", caption: "OPG" }),
    record({ id: "cbct", kind: "cbct", caption: "CBCT", previews: ["c0", "c1", "c2", "c3", "c4", "c5"], previewLabels: ["", "", "", "", "", "36 site"] }),
  ],
  analyses: [analysis],
};

describe("patient documents", () => {
  it("offers photos and radiographs first, then two scan views and hand-picked CBCT views", () => {
    const images = documentImages(c);
    expect(images.map((i) => i.preview)).toEqual(["p.jpg", "s0.png", "s1.png", "c5"]);
    expect(images[0].label).toBe("OPG (radiograph, opg)");
    expect(images[3].label).toContain("36 site");
  });

  it("marks AI impressions as unconfirmed and puts the final plan first in authority", () => {
    const text = buildDocumentText(c, analysis, "letter", "", "Fee £2,450", []);
    expect(text).toContain("Possible caries distally (AI visual impression, unconfirmed)");
    expect(text).toContain("Dentist's final plan:\nImplant 36 after perio stabilisation");
    expect(text).toContain("Instructions from the dentist: Fee £2,450");
    expect(text).not.toContain("2026-014");
    expect(text).not.toContain("Case images available");
  });

  it("lists numbered images only for presentations", () => {
    const text = buildDocumentText(c, analysis, "presentation", "Implant at 36", "", documentImages(c));
    expect(text).toContain("0. OPG (radiograph, opg)");
    expect(text).toContain("Treatment option to write about: Implant at 36");
  });

  it("writes as the dentist and includes their style notes", () => {
    const prompt = documentSystemPrompt("records", { ...defaultBrand(), qualifications: "BDS", writingStyle: "Always say 'we'." });
    expect(prompt).toContain("Dr Aran Maxwell-Cox, BDS");
    expect(prompt).toContain("Always say 'we'.");
    expect(prompt).toContain("clinical records note");
  });

  it("rejects edited content of the wrong shape", () => {
    expect(DOCUMENT_SCHEMAS.letter.safeParse({ subject: "x", paragraphs: ["a"] }).success).toBe(true);
    expect(DOCUMENT_SCHEMAS.presentation.safeParse({ title: "x", slides: [{ title: "t" }] }).success).toBe(false);
  });
});
