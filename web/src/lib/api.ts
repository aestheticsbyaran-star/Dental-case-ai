import type {
  Analysis,
  AnalysisReview,
  BrandSettings,
  Case,
  CaseDetails,
  CaseRecord,
  DocumentContentMap,
  DocumentKind,
  Measurement,
  PatientDocument,
  RadiographView,
  RecordKind,
  VolumeInfo,
} from "../../../shared/types";

export interface CaseSummary {
  id: string;
  reference: string;
  chiefComplaint: string;
  updatedAt: string;
  recordCount: number;
  analysisCount: number;
}

export interface Status {
  apiKeyConfigured: boolean;
  model: string;
  dataDir: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !(body && typeof body === "object" && "status" in body)) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  status: () => request<Status>("/api/status"),
  listCases: () => request<CaseSummary[]>("/api/cases"),
  createCase: (reference: string) => request<Case>("/api/cases", json("POST", { reference })),
  getCase: (id: string) => request<Case>(`/api/cases/${id}`),
  deleteCase: (id: string) => request<void>(`/api/cases/${id}`, { method: "DELETE" }),
  saveDetails: (id: string, details: CaseDetails) => request<Case>(`/api/cases/${id}/details`, json("PUT", details)),

  uploadRecord: (
    caseId: string,
    file: File,
    previews: Blob[],
    meta: {
      kind: RecordKind;
      caption: string;
      view?: RadiographView;
      mmPerPixel?: number;
      previewLabels?: string[];
      volume?: VolumeInfo;
    },
  ) => {
    const form = new FormData();
    form.append("file", file, file.name);
    previews.forEach((p, i) => form.append("previews", p, `preview-${i}.jpg`));
    form.append("meta", JSON.stringify(meta));
    return request<CaseRecord>(`/api/cases/${caseId}/records`, { method: "POST", body: form });
  },
  updateRecord: (
    caseId: string,
    recordId: string,
    patch: Partial<{ caption: string; view: RadiographView; includeInAnalysis: boolean; mmPerPixel: number | null; measurements: Measurement[] }>,
  ) => request<CaseRecord>(`/api/cases/${caseId}/records/${recordId}`, json("PATCH", patch)),
  deleteRecord: (caseId: string, recordId: string) =>
    request<void>(`/api/cases/${caseId}/records/${recordId}`, { method: "DELETE" }),
  addPreview: (caseId: string, recordId: string, image: Blob, label: string) => {
    const form = new FormData();
    form.append("preview", image, "view.jpg");
    form.append("label", label);
    return request<CaseRecord>(`/api/cases/${caseId}/records/${recordId}/previews`, { method: "POST", body: form });
  },
  deletePreview: (caseId: string, recordId: string, name: string) =>
    request<CaseRecord>(`/api/cases/${caseId}/records/${recordId}/previews/${name}`, { method: "DELETE" }),
  fileUrl: (caseId: string, storedName: string) => `/api/cases/${caseId}/files/${storedName}`,

  analyse: (caseId: string, question: string) => request<Analysis>(`/api/cases/${caseId}/analyses`, json("POST", { question })),
  saveReview: (caseId: string, analysisId: string, review: Partial<AnalysisReview>) =>
    request<Analysis>(`/api/cases/${caseId}/analyses/${analysisId}/review`, json("PUT", review)),

  writeDocument: (caseId: string, body: { kind: DocumentKind; analysisId: string; optionTitle: string; instructions: string }) =>
    request<PatientDocument>(`/api/cases/${caseId}/documents`, json("POST", body)),
  saveDocument: (caseId: string, docId: string, content: DocumentContentMap[DocumentKind]) =>
    request<PatientDocument>(`/api/cases/${caseId}/documents/${docId}`, json("PUT", { content })),
  deleteDocument: (caseId: string, docId: string) => request<void>(`/api/cases/${caseId}/documents/${docId}`, { method: "DELETE" }),

  getBrand: () => request<BrandSettings>("/api/settings"),
  saveBrand: (brand: BrandSettings) => request<BrandSettings>("/api/settings", json("PUT", brand)),
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append("logo", file, file.name);
    return request<BrandSettings>("/api/settings/logo", { method: "POST", body: form });
  },
  deleteLogo: () => request<BrandSettings>("/api/settings/logo", { method: "DELETE" }),
  logoUrl: (name: string) => `/api/brand/${name}`,
};
