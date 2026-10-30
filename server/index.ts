// Local server: stores cases on this computer and calls the Claude API for analyses.
import "dotenv/config";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Analysis,
  BrandSettings,
  CaseDetails,
  CaseRecord,
  DocumentKind,
  Measurement,
  PatientDocument,
  RecordKind,
  ReviewVerdict,
  VolumeInfo,
} from "../shared/types.js";
import {
  NotFoundError,
  createCase,
  deleteCase,
  filePath,
  filesDir,
  getCase,
  listCases,
  withCase,
  DATA_DIR,
  BRAND_DIR,
  brandFilePath,
  getBrand,
  saveBrand,
} from "./store.js";
import { MODEL, analysisModel, runAnalysis } from "./analyse.js";
import { DOCUMENT_SCHEMAS, documentImages, writeDocument } from "./documents.js";

const PORT = Number(process.env.PORT ?? 8787);
const app = express();
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  // CBCT series can be large; single 2D files and STLs are well under this.
  limits: { fileSize: 600 * 1024 * 1024, files: 12 },
});

const RECORD_KINDS: RecordKind[] = ["photo", "radiograph", "dicom", "cbct", "scan", "document"];
const VERDICTS: ReviewVerdict[] = ["pending", "agreed", "partly-agreed", "disagreed"];
const DOCUMENT_KINDS: DocumentKind[] = ["letter", "records", "guide", "presentation", "consent"];
const BRAND_TEXT_FIELDS: (keyof BrandSettings)[] = [
  "displayName",
  "qualifications",
  "gdcNumber",
  "practiceName",
  "address",
  "phone",
  "email",
  "website",
  "signOff",
  "writingStyle",
];
const LOGO_TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

function extOf(name: string): string {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return ext.length > 1 && ext.length <= 9 ? ext : "";
}

async function writeUpload(caseId: string, file: Express.Multer.File, forceExt?: string): Promise<string> {
  const stored = `${randomUUID()}${forceExt ?? extOf(file.originalname)}`;
  await fs.mkdir(filesDir(caseId), { recursive: true });
  await fs.writeFile(filePath(caseId, stored), file.buffer);
  return stored;
}

function parseVolumeInfo(v: unknown): VolumeInfo | undefined {
  const o = v as Partial<VolumeInfo> | undefined;
  const triple = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === "number" && n > 0);
  if (!o || !triple(o.dims) || !triple(o.spacing)) return undefined;
  return {
    dims: o.dims as VolumeInfo["dims"],
    spacing: o.spacing as VolumeInfo["spacing"],
    sliceCount: Number(o.sliceCount) || 0,
    notes: Array.isArray(o.notes) ? o.notes.map((n) => String(n).slice(0, 300)).slice(0, 10) : [],
  };
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const param = (req: Request, name: string): string => String(req.params[name]);

app.get("/api/status", (_req, res) => {
  res.json({ apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL, dataDir: DATA_DIR });
});

app.get("/api/settings", wrap(async (_req, res) => res.json(await getBrand())));

app.put(
  "/api/settings",
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const brand = await getBrand();
    for (const f of BRAND_TEXT_FIELDS) {
      if (typeof body[f] === "string") (brand[f] as string) = body[f].slice(0, f === "writingStyle" ? 8000 : 300);
    }
    if (typeof body.brandColour === "string" && /^#[0-9a-f]{6}$/i.test(body.brandColour)) brand.brandColour = body.brandColour;
    res.json(await saveBrand(brand));
  }),
);

app.post(
  "/api/settings/logo",
  upload.single("logo"),
  wrap(async (req, res) => {
    const ext = req.file && LOGO_TYPES[req.file.mimetype];
    if (!req.file || !ext) return res.status(400).json({ error: "The logo must be a PNG, JPEG or WebP image." });
    if (req.file.size > 5 * 1024 * 1024) return res.status(400).json({ error: "The logo must be under 5 MB." });
    const brand = await getBrand();
    const stored = `logo-${randomUUID()}${ext}`;
    await fs.mkdir(BRAND_DIR, { recursive: true });
    await fs.writeFile(brandFilePath(stored), req.file.buffer);
    if (brand.logo) await fs.rm(brandFilePath(brand.logo), { force: true });
    brand.logo = stored;
    res.json(await saveBrand(brand));
  }),
);

app.delete(
  "/api/settings/logo",
  wrap(async (_req, res) => {
    const brand = await getBrand();
    if (brand.logo) await fs.rm(brandFilePath(brand.logo), { force: true });
    delete brand.logo;
    res.json(await saveBrand(brand));
  }),
);

app.get(
  "/api/brand/:name",
  wrap(async (req, res) => {
    res.sendFile(brandFilePath(param(req, "name")), { headers: { "Cache-Control": "private, max-age=86400" } }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "File not found" });
    });
  }),
);

app.get(
  "/api/cases",
  wrap(async (_req, res) => {
    const cases = await listCases();
    res.json(
      cases.map((c) => ({
        id: c.id,
        reference: c.details.reference,
        chiefComplaint: c.details.chiefComplaint,
        updatedAt: c.updatedAt,
        recordCount: c.records.length,
        analysisCount: c.analyses.length,
      })),
    );
  }),
);

app.post(
  "/api/cases",
  wrap(async (req, res) => {
    const reference = String(req.body?.reference ?? "").slice(0, 80);
    res.status(201).json(await createCase(reference));
  }),
);

app.get("/api/cases/:id", wrap(async (req, res) => res.json(await getCase(param(req, "id")))));

app.delete(
  "/api/cases/:id",
  wrap(async (req, res) => {
    await getCase(param(req, "id"));
    await deleteCase(param(req, "id"));
    res.status(204).end();
  }),
);

const DETAIL_FIELDS: (keyof CaseDetails)[] = [
  "reference",
  "chiefComplaint",
  "medicalHistory",
  "dentalHistory",
  "examination",
  "patientGoals",
  "notes",
];

app.put(
  "/api/cases/:id/details",
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const updated = await withCase(param(req, "id"), (c) => {
      for (const f of DETAIL_FIELDS) if (typeof body[f] === "string") (c.details[f] as string) = body[f];
      if (body.age === null || (typeof body.age === "number" && body.age >= 0 && body.age < 130)) c.details.age = body.age;
      if (["female", "male", "other", "not-recorded"].includes(body.sex)) c.details.sex = body.sex;
      return c;
    });
    res.json(updated);
  }),
);

// Upload one record: the original file plus browser-generated previews (de-identified images for AI).
app.post(
  "/api/cases/:id/records",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "previews", maxCount: 8 },
  ]),
  wrap(async (req, res) => {
    const caseId = param(req, "id");
    await getCase(caseId);
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const file = files?.file?.[0];
    if (!file) return res.status(400).json({ error: "No file was uploaded." });
    const meta = JSON.parse(String(req.body.meta ?? "{}"));
    const kind: RecordKind = RECORD_KINDS.includes(meta.kind) ? meta.kind : "document";

    const storedName = await writeUpload(caseId, file);
    const previews: string[] = [];
    for (const p of files?.previews ?? []) {
      const ext = p.mimetype === "image/png" ? ".png" : ".jpg";
      previews.push(await writeUpload(caseId, p, ext));
    }

    const labels: unknown[] = Array.isArray(meta.previewLabels) ? meta.previewLabels : [];
    const record: CaseRecord = {
      id: randomUUID(),
      kind,
      originalName: file.originalname.slice(0, 200),
      storedName,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      view: meta.view,
      caption: String(meta.caption ?? "").slice(0, 200),
      mmPerPixel: typeof meta.mmPerPixel === "number" && meta.mmPerPixel > 0 ? meta.mmPerPixel : undefined,
      calibrationSource: typeof meta.mmPerPixel === "number" && meta.mmPerPixel > 0 ? "dicom" : undefined,
      previews,
      previewLabels: previews.map((_, i) => String(labels[i] ?? "").slice(0, 200)),
      volume: kind === "cbct" ? parseVolumeInfo(meta.volume) : undefined,
      includeInAnalysis: previews.length > 0,
      measurements: [],
    };
    await withCase(caseId, (c) => {
      c.records.push(record);
    });
    res.status(201).json(record);
  }),
);

app.patch(
  "/api/cases/:id/records/:recordId",
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const record = await withCase(param(req, "id"), (c) => {
      const r = c.records.find((x) => x.id === param(req, "recordId"));
      if (!r) throw new NotFoundError("Record not found");
      if (typeof body.caption === "string") r.caption = body.caption.slice(0, 200);
      if (typeof body.view === "string") r.view = body.view;
      if (typeof body.includeInAnalysis === "boolean") r.includeInAnalysis = body.includeInAnalysis;
      if (body.mmPerPixel === null) {
        r.mmPerPixel = undefined;
        r.calibrationSource = undefined;
      } else if (typeof body.mmPerPixel === "number" && body.mmPerPixel > 0) {
        r.mmPerPixel = body.mmPerPixel;
        r.calibrationSource = "manual";
      }
      if (Array.isArray(body.measurements)) {
        r.measurements = (body.measurements as Measurement[])
          .filter((m) => (m.type === "distance" || m.type === "angle") && Number.isFinite(m.value))
          .map((m) => ({
            id: typeof m.id === "string" ? m.id : randomUUID(),
            type: m.type,
            value: m.value,
            calibrated: Boolean(m.calibrated),
            label: String(m.label ?? "").slice(0, 120),
            tooth: m.tooth ? String(m.tooth).slice(0, 20) : undefined,
            points: Array.isArray(m.points) ? m.points : [],
            plane: ["axial", "coronal", "sagittal"].includes(m.plane as string) ? m.plane : undefined,
            createdAt: typeof m.createdAt === "string" ? m.createdAt : new Date().toISOString(),
          }));
      }
      return r;
    });
    res.json(record);
  }),
);

// Add an extra view (e.g. a CBCT slice the dentist chose) to the images sent for analysis.
app.post(
  "/api/cases/:id/records/:recordId/previews",
  upload.single("preview"),
  wrap(async (req, res) => {
    const caseId = param(req, "id");
    if (!req.file) return res.status(400).json({ error: "No image was uploaded." });
    if (!["image/jpeg", "image/png"].includes(req.file.mimetype)) return res.status(400).json({ error: "Views must be JPEG or PNG." });
    await getCase(caseId);
    const stored = await writeUpload(caseId, req.file, req.file.mimetype === "image/png" ? ".png" : ".jpg");
    const record = await withCase(caseId, (c) => {
      const r = c.records.find((x) => x.id === param(req, "recordId"));
      if (!r) throw new NotFoundError("Record not found");
      r.previewLabels = r.previews.map((_, i) => r.previewLabels?.[i] ?? "");
      r.previews.push(stored);
      r.previewLabels.push(String(req.body.label ?? "").slice(0, 200));
      r.includeInAnalysis = true;
      return r;
    });
    res.status(201).json(record);
  }),
);

app.delete(
  "/api/cases/:id/records/:recordId/previews/:name",
  wrap(async (req, res) => {
    const caseId = param(req, "id");
    const name = param(req, "name");
    const record = await withCase(caseId, (c) => {
      const r = c.records.find((x) => x.id === param(req, "recordId"));
      const i = r?.previews.indexOf(name) ?? -1;
      if (!r || i < 0) throw new NotFoundError("View not found");
      r.previews.splice(i, 1);
      r.previewLabels?.splice(i, 1);
      return r;
    });
    await fs.rm(filePath(caseId, name), { force: true });
    res.json(record);
  }),
);

app.delete(
  "/api/cases/:id/records/:recordId",
  wrap(async (req, res) => {
    const caseId = param(req, "id");
    const removed = await withCase(caseId, (c) => {
      const i = c.records.findIndex((x) => x.id === param(req, "recordId"));
      if (i < 0) throw new NotFoundError("Record not found");
      return c.records.splice(i, 1)[0];
    });
    for (const name of [removed.storedName, ...removed.previews]) {
      await fs.rm(filePath(caseId, name), { force: true });
    }
    res.status(204).end();
  }),
);

app.get(
  "/api/cases/:id/files/:name",
  wrap(async (req, res) => {
    const p = filePath(param(req, "id"), param(req, "name"));
    res.sendFile(p, { headers: { "Cache-Control": "private, max-age=3600" } }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "File not found" });
    });
  }),
);

app.post(
  "/api/cases/:id/analyses",
  wrap(async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: "No Claude API key is set. Add ANTHROPIC_API_KEY to the .env file and restart." });
    }
    const caseId = param(req, "id");
    const c = await getCase(caseId);
    const question = String(req.body?.question ?? "").slice(0, 4000);
    const records = c.records.filter((r) => r.includeInAnalysis);
    const model = analysisModel(req.body?.model);

    const analysis: Analysis = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      model,
      question,
      inputSummary: {
        recordIds: records.map((r) => r.id),
        imageCount: 0,
        measurementCount: records.reduce((n, r) => n + r.measurements.length, 0),
      },
      status: "complete",
      review: { verdict: "pending", finalPlan: "", comments: "" },
    };
    try {
      const result = await runAnalysis(new Anthropic(), c, records, question, model);
      analysis.output = result.output;
      analysis.usage = result.usage;
      analysis.inputSummary.imageCount = result.imageCount;
      analysis.inputSummary.omittedImageCount = result.omittedImageCount;
    } catch (err) {
      analysis.status = "failed";
      analysis.error = err instanceof Anthropic.APIError ? `Claude API error ${err.status ?? ""}: ${err.message}` : String((err as Error).message ?? err);
      console.error("Analysis failed:", err);
    }
    await withCase(caseId, (fresh) => {
      fresh.analyses.unshift(analysis);
    });
    res.status(analysis.status === "complete" ? 201 : 502).json(analysis);
  }),
);

app.put(
  "/api/cases/:id/analyses/:analysisId/review",
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const analysis = await withCase(param(req, "id"), (c) => {
      const a = c.analyses.find((x) => x.id === param(req, "analysisId"));
      if (!a) throw new NotFoundError("Analysis not found");
      a.review = {
        verdict: VERDICTS.includes(body.verdict) ? body.verdict : a.review.verdict,
        finalPlan: typeof body.finalPlan === "string" ? body.finalPlan : a.review.finalPlan,
        comments: typeof body.comments === "string" ? body.comments : a.review.comments,
        reviewedAt: new Date().toISOString(),
      };
      return a;
    });
    res.json(analysis);
  }),
);

// Write a letter, records note, guide, presentation or consent form from an analysis.
app.post(
  "/api/cases/:id/documents",
  wrap(async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: "No Claude API key is set. Add ANTHROPIC_API_KEY to the .env file and restart." });
    }
    const body = req.body ?? {};
    const kind = body.kind as DocumentKind;
    if (!DOCUMENT_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown document type." });
    const caseId = param(req, "id");
    const c = await getCase(caseId);
    const analysis = c.analyses.find((a) => a.id === body.analysisId);
    if (!analysis || analysis.status !== "complete") return res.status(400).json({ error: "Choose a completed analysis first." });
    const optionTitle = String(body.optionTitle ?? "").slice(0, 300);
    const instructions = String(body.instructions ?? "").slice(0, 4000);
    const images = kind === "presentation" ? documentImages(c) : undefined;

    const now = new Date().toISOString();
    const doc: PatientDocument = {
      id: randomUUID(),
      kind,
      createdAt: now,
      updatedAt: now,
      analysisId: analysis.id,
      optionTitle,
      instructions,
      model: MODEL,
      status: "complete",
      images,
    };
    try {
      const result = await writeDocument(new Anthropic(), {
        c,
        analysis,
        kind,
        optionTitle,
        instructions,
        brand: await getBrand(),
        images: images ?? [],
      });
      doc.content = result.content;
      doc.usage = result.usage;
    } catch (err) {
      doc.status = "failed";
      doc.error = err instanceof Anthropic.APIError ? `Claude API error ${err.status ?? ""}: ${err.message}` : String((err as Error).message ?? err);
      console.error("Document failed:", err);
    }
    await withCase(caseId, (fresh) => {
      fresh.documents = [doc, ...(fresh.documents ?? [])];
    });
    res.status(doc.status === "complete" ? 201 : 502).json(doc);
  }),
);

// Save the dentist's edits to a document.
app.put(
  "/api/cases/:id/documents/:docId",
  wrap(async (req, res) => {
    const doc = await withCase(param(req, "id"), (c) => {
      const d = c.documents?.find((x) => x.id === param(req, "docId"));
      if (!d) throw new NotFoundError("Document not found");
      const parsed = DOCUMENT_SCHEMAS[d.kind].safeParse(req.body?.content);
      if (!parsed.success) return null;
      if ("slides" in parsed.data) {
        const count = d.images?.length ?? 0;
        for (const s of parsed.data.slides) if (s.imageIndex !== null && !(s.imageIndex >= 0 && s.imageIndex < count)) s.imageIndex = null;
      }
      d.content = parsed.data;
      d.updatedAt = new Date().toISOString();
      return d;
    });
    if (!doc) return res.status(400).json({ error: "The document could not be saved because its contents were not valid." });
    res.json(doc);
  }),
);

app.delete(
  "/api/cases/:id/documents/:docId",
  wrap(async (req, res) => {
    await withCase(param(req, "id"), (c) => {
      const before = c.documents?.length ?? 0;
      c.documents = (c.documents ?? []).filter((x) => x.id !== param(req, "docId"));
      if (c.documents.length === before) throw new NotFoundError("Document not found");
    });
    res.status(204).end();
  }),
);

// Export the review log across all cases as CSV, for tracking how often the AI matched your plan.
app.get(
  "/api/review-log.csv",
  wrap(async (_req, res) => {
    const cases = await listCases();
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["case_reference", "analysis_date", "model", "status", "verdict", "options_suggested", "final_plan", "comments"].join(",")];
    for (const c of cases) {
      for (const a of c.analyses) {
        rows.push(
          [
            c.details.reference,
            a.createdAt,
            a.model,
            a.status,
            a.review.verdict,
            (a.output?.treatmentOptions ?? []).map((o) => o.title).join(" | "),
            a.review.finalPlan,
            a.review.comments,
          ]
            .map(esc)
            .join(","),
        );
      }
    }
    res.type("text/csv").attachment("review-log.csv").send(rows.join("\n"));
  }),
);

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the local server. Check the terminal for details." });
});

// Listen on this computer only.
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Case server on http://127.0.0.1:${PORT} (data in ${DATA_DIR})`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("Note: ANTHROPIC_API_KEY is not set, so AI analysis is disabled.");
});
