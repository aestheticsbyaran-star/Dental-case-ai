import { describe, expect, it } from "vitest";
import { buildCaseText } from "../server/analyse";
import { emptyDetails, type Case, type CaseRecord } from "../shared/types";

const record = (over: Partial<CaseRecord>): CaseRecord => ({
  id: "r1",
  kind: "radiograph",
  originalName: "pa.jpg",
  storedName: "x.jpg",
  mimeType: "image/jpeg",
  size: 1,
  uploadedAt: "",
  caption: "LR PA",
  previews: ["p.jpg"],
  includeInAnalysis: true,
  measurements: [],
  ...over,
});

const baseCase: Case = {
  id: "c1",
  createdAt: "",
  updatedAt: "",
  details: { ...emptyDetails(), reference: "2026-014", age: 42, sex: "female", chiefComplaint: "gap at 36" },
  records: [],
  analyses: [],
};

describe("buildCaseText", () => {
  it("lists calibrated and uncalibrated measurements with the right units", () => {
    const records = [
      record({
        mmPerPixel: 0.1,
        calibrationSource: "dicom",
        measurements: [
          { id: "m1", type: "distance", value: 11.84, calibrated: true, label: "bone height to canal", tooth: "36", points: [], createdAt: "" },
          { id: "m2", type: "angle", value: 12.04, calibrated: true, label: "37 tilt", tooth: "37", points: [], createdAt: "" },
        ],
      }),
      record({
        id: "r2",
        caption: "Upper occlusal",
        kind: "photo",
        measurements: [{ id: "m3", type: "distance", value: 240, calibrated: false, label: "", points: [], createdAt: "" }],
      }),
    ];
    const text = buildCaseText(baseCase, records, "");
    expect(text).toContain("Case reference: 2026-014");
    expect(text).toContain("- bone height to canal [tooth 36]: 11.84 mm");
    expect(text).toContain("- 37 tilt [tooth 37]: 12.0°");
    expect(text).toContain("- distance: 240.00 px (uncalibrated)");
    expect(text).toContain("calibrated, 0.1000 mm/pixel from dicom");
    expect(text).toContain("Please analyse this case");
  });

  it("marks missing details as not recorded", () => {
    const text = buildCaseText({ ...baseCase, details: emptyDetails() }, [], "Is 46 restorable?");
    expect(text).toContain("Age: not recorded");
    expect(text).toContain("Clinician measurements:\nnone");
    expect(text).toContain("Question from the dentist: Is 46 restorable?");
  });
});

describe("runAnalysis", () => {
  it("asks the chosen model for a full work-up at the highest effort", async () => {
    const { runAnalysis, analysisModel } = await import("../server/analyse");
    let params: any;
    const output = { caseSummary: "s", findings: [], treatmentOptions: [], risksAndFlags: [], missingInformation: [], suggestedNextSteps: [] };
    const client: any = {
      messages: {
        stream: (p: any) => {
          params = p;
          return { finalMessage: async () => ({ stop_reason: "end_turn", parsed_output: output, usage: { input_tokens: 1, output_tokens: 2 } }) };
        },
      },
    };
    const result = await runAnalysis(client, baseCase, [], "", analysisModel("claude-fable-5-1"));
    expect(params.model).toBe("claude-fable-5-1");
    expect(params.output_config.effort).toBe("max");
    expect(params.max_tokens).toBe(64000);
    expect(params.system).toContain("recordReviews");
    expect(result.output).toBe(output);
    expect(analysisModel("gpt-4")).toBe("claude-opus-5-5");
  });
});
