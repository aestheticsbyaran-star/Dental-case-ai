import type { Analysis, AnalysisReview, Case, CaseDetails, CaseRecord, Measurement, RadiographView, RecordKind } from "../../../shared/types";

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
    meta: { kind: RecordKind; caption: string; view?: RadiographView; mmPerPixel?: number },
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
  fileUrl: (caseId: string, storedName: string) => `/api/cases/${caseId}/files/${storedName}`,

  analyse: (caseId: string, question: string) => request<Analysis>(`/api/cases/${caseId}/analyses`, json("POST", { question })),
  saveReview: (caseId: string, analysisId: string, review: Partial<AnalysisReview>) =>
    request<Analysis>(`/api/cases/${caseId}/analyses/${analysisId}/review`, json("PUT", review)),
};
