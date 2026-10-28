// Types shared by the local server and the web app.

export type RecordKind = "photo" | "radiograph" | "dicom" | "scan" | "document";

export type RadiographView =
  | "bitewing"
  | "periapical"
  | "opg"
  | "ceph"
  | "cbct-slice"
  | "other";

export interface Measurement {
  id: string;
  type: "distance" | "angle";
  /** Value in mm for distances, degrees for angles. */
  value: number;
  /** Whether the distance is in true mm (calibrated) or only in image pixels. */
  calibrated: boolean;
  label: string;
  /** FDI tooth number(s) the measurement relates to, e.g. "36" or "35-37". */
  tooth?: string;
  /** Points in image pixels (2D) or model mm (3D), for redrawing. */
  points: number[][];
  createdAt: string;
}

export interface CaseRecord {
  id: string;
  kind: RecordKind;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  view?: RadiographView;
  /** Free-text caption, e.g. "Pre-op upper occlusal". */
  caption: string;
  /** mm per image pixel, from DICOM headers or a manual calibration line. */
  mmPerPixel?: number;
  calibrationSource?: "dicom" | "manual";
  /** De-identified PNG/JPEG previews generated in the browser, used for AI analysis. */
  previews: string[];
  /** Include this record when asking Claude for an analysis. */
  includeInAnalysis: boolean;
  measurements: Measurement[];
}

export type Sex = "female" | "male" | "other" | "not-recorded";

export interface CaseDetails {
  /** A reference that is not the patient's name, e.g. "2026-014". */
  reference: string;
  age: number | null;
  sex: Sex;
  chiefComplaint: string;
  medicalHistory: string;
  dentalHistory: string;
  examination: string;
  patientGoals: string;
  notes: string;
}

export interface Case {
  id: string;
  createdAt: string;
  updatedAt: string;
  details: CaseDetails;
  records: CaseRecord[];
  analyses: Analysis[];
}

export type FindingBasis = "clinician-measurement" | "clinician-notes" | "visual-impression";

export interface Finding {
  tooth: string | null;
  finding: string;
  basis: FindingBasis;
  /** Which record(s) or note the finding comes from. */
  source: string;
  confidence: "low" | "medium" | "high";
}

export interface TreatmentOption {
  title: string;
  description: string;
  addresses: string[];
  advantages: string[];
  disadvantages: string[];
  prerequisites: string[];
}

export interface AnalysisOutput {
  caseSummary: string;
  findings: Finding[];
  treatmentOptions: TreatmentOption[];
  risksAndFlags: string[];
  missingInformation: string[];
  suggestedNextSteps: string[];
}

export type ReviewVerdict = "pending" | "agreed" | "partly-agreed" | "disagreed";

export interface AnalysisReview {
  verdict: ReviewVerdict;
  /** What the dentist actually decided, for comparison with the AI output. */
  finalPlan: string;
  comments: string;
  reviewedAt?: string;
}

export interface Analysis {
  id: string;
  createdAt: string;
  model: string;
  question: string;
  /** What was sent: record ids, number of images, and measurement count. */
  inputSummary: { recordIds: string[]; imageCount: number; measurementCount: number };
  status: "complete" | "failed";
  output?: AnalysisOutput;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  review: AnalysisReview;
}

export const emptyDetails = (): CaseDetails => ({
  reference: "",
  age: null,
  sex: "not-recorded",
  chiefComplaint: "",
  medicalHistory: "",
  dentalHistory: "",
  examination: "",
  patientGoals: "",
  notes: "",
});
