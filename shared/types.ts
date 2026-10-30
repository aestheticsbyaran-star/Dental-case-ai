// Types shared by the local server and the web app.

export type RecordKind = "photo" | "radiograph" | "dicom" | "cbct" | "scan" | "document";

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
  /** Points in image pixels (2D) or mm (scans and CBCT), for redrawing. */
  points: number[][];
  /** CBCT only: the view the measurement was made on. */
  plane?: "axial" | "coronal" | "sagittal";
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
  /** What each preview shows, e.g. "Axial slice 212 of 400", in the same order as previews. */
  previewLabels?: string[];
  /** For CBCT: size and voxel spacing of the stored volume. */
  volume?: VolumeInfo;
  /** Include this record when asking Claude for an analysis. */
  includeInAnalysis: boolean;
  measurements: Measurement[];
}

export interface VolumeInfo {
  dims: [number, number, number];
  /** Voxel size in mm along x, y, z. */
  spacing: [number, number, number];
  sliceCount: number;
  notes: string[];
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
  /** Patient-facing documents and record notes written from an analysis. Older cases have none. */
  documents?: PatientDocument[];
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
  /** Order of treatment, phase by phase. */
  sequence?: string[];
  prognosis?: string;
  maintenance?: string;
}

export type Prognosis = "good" | "fair" | "questionable" | "poor" | "hopeless" | "not assessed";

export interface RecordReview {
  /** Record caption, e.g. "OPG" or "Upper occlusal photo". */
  record: string;
  observations: string[];
}

export interface ToothEntry {
  tooth: string;
  status: string;
  prognosis: Prognosis;
  notes: string;
}

export interface Assessment {
  area: string;
  assessment: string;
}

export interface Diagnosis {
  diagnosis: string;
  teeth: string;
  rationale: string;
  differentials: string[];
}

/** Claude models the dentist can choose for an analysis. */
export const ANALYSIS_MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 (standard)",
  "claude-fable-5-1": "Claude Fable 5.1 (most capable, about 2.5x the cost)",
} as const;
export type AnalysisModel = keyof typeof ANALYSIS_MODELS;

export interface AnalysisOutput {
  caseSummary: string;
  /** Older analyses don't have the sections below. */
  recordReviews?: RecordReview[];
  assessments?: Assessment[];
  toothChart?: ToothEntry[];
  diagnoses?: Diagnosis[];
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
  inputSummary: { recordIds: string[]; imageCount: number; measurementCount: number; omittedImageCount?: number };
  status: "complete" | "failed";
  output?: AnalysisOutput;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  review: AnalysisReview;
}

export type DocumentKind = "letter" | "records" | "guide" | "presentation";

export interface LetterContent {
  subject: string;
  /** Body paragraphs. The greeting, date and sign-off come from the letterhead. */
  paragraphs: string[];
}

export interface RecordsContent {
  /** Plain text for pasting into the practice's clinical records. */
  text: string;
}

export interface GuideSection {
  heading: string;
  paragraphs: string[];
  bullets: string[];
}

export interface GuideContent {
  title: string;
  intro: string;
  sections: GuideSection[];
}

export interface Slide {
  title: string;
  bullets: string[];
  /** What the dentist says over this slide while recording. */
  script: string;
  /** Index into the case images offered when the deck was written, or null for a text slide. */
  imageIndex: number | null;
}

export interface PresentationContent {
  title: string;
  slides: Slide[];
}

export interface DocumentContentMap {
  letter: LetterContent;
  records: RecordsContent;
  guide: GuideContent;
  presentation: PresentationContent;
}

/** A preview image a presentation can show: the record and which of its previews. */
export interface DocumentImage {
  recordId: string;
  preview: string;
  label: string;
}

export interface PatientDocument<K extends DocumentKind = DocumentKind> {
  id: string;
  kind: K;
  createdAt: string;
  updatedAt: string;
  analysisId: string;
  /** The treatment option the document is about, or empty for the dentist's final plan. */
  optionTitle: string;
  instructions: string;
  model: string;
  status: "complete" | "failed";
  content?: DocumentContentMap[K];
  /** Images offered to Claude for a presentation, in the order imageIndex refers to. */
  images?: DocumentImage[];
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** How the dentist and practice appear on screen, letters and slides. Stored in data/settings.json. */
export interface BrandSettings {
  displayName: string;
  qualifications: string;
  gdcNumber: string;
  practiceName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Hex colour used for the header, letterheads and slides. */
  brandColour: string;
  signOff: string;
  /** How documents should sound, and any example letter text to match. Sent to Claude. */
  writingStyle: string;
  /** Stored file name of the uploaded logo, if any. */
  logo?: string;
}

export const defaultBrand = (): BrandSettings => ({
  displayName: "Dr Aran Maxwell-Cox",
  qualifications: "",
  gdcNumber: "",
  practiceName: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  brandColour: "#1f3b57",
  signOff: "Kind regards",
  writingStyle: "",
});

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
