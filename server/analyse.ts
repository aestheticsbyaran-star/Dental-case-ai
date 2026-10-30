// Builds the Claude request for a case and parses the structured analysis.
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import sharp from "sharp";
import { z } from "zod";
import { selectImages } from "../shared/imageBudget.js";
import { ANALYSIS_MODELS, type AnalysisModel, type AnalysisOutput, type Case, type CaseRecord } from "../shared/types.js";
import { filePath } from "./store.js";

export const MODEL: AnalysisModel = "claude-opus-5-5";

export function analysisModel(value: unknown): AnalysisModel {
  return typeof value === "string" && value in ANALYSIS_MODELS ? (value as AnalysisModel) : MODEL;
}
/** Claude Opus 5.5 reads images up to 2576 px on the long edge; above 20 images the API rejects any over 3000 px. */
const AI_MAX_EDGE = 2576;

const AnalysisSchema = z.object({
  caseSummary: z.string(),
  recordReviews: z.array(z.object({ record: z.string(), observations: z.array(z.string()) })),
  assessments: z.array(z.object({ area: z.string(), assessment: z.string() })),
  toothChart: z.array(
    z.object({
      tooth: z.string(),
      status: z.string(),
      prognosis: z.enum(["good", "fair", "questionable", "poor", "hopeless", "not assessed"]),
      notes: z.string(),
    }),
  ),
  diagnoses: z.array(
    z.object({
      diagnosis: z.string(),
      teeth: z.string(),
      rationale: z.string(),
      differentials: z.array(z.string()),
    }),
  ),
  findings: z.array(
    z.object({
      tooth: z.string().nullable(),
      finding: z.string(),
      basis: z.enum(["clinician-measurement", "clinician-notes", "visual-impression"]),
      source: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
  treatmentOptions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      addresses: z.array(z.string()),
      sequence: z.array(z.string()),
      advantages: z.array(z.string()),
      disadvantages: z.array(z.string()),
      prerequisites: z.array(z.string()),
      prognosis: z.string(),
      maintenance: z.string(),
    }),
  ),
  risksAndFlags: z.array(z.string()),
  missingInformation: z.array(z.string()),
  suggestedNextSteps: z.array(z.string()),
});

export const SYSTEM_PROMPT = `You are assisting a UK dentist who is analysing one of their own patient cases. The dentist is the clinician responsible for every decision; your role is to organise the case, point out what they may want to look at, and lay out reasonable treatment options with their trade-offs.

Conventions:
- Use FDI tooth notation (e.g. 16, 36, 51) and UK dental terminology and spelling.
- Write for an experienced clinician: concise, specific, no patient-facing simplification.

How to treat the inputs:
- Measurements listed under "Clinician measurements" were made by the dentist with calibrated tools. These are the only numbers you may state as measured values. Mark findings based on them as basis "clinician-measurement".
- Content of the notes, history and examination is basis "clinician-notes".
- Anything you see in the images yourself is basis "visual-impression". Do not give millimetre or degree values from your own reading of an image; describe it qualitatively and say what should be measured or checked. Radiographic impressions in particular need the dentist's confirmation, so keep confidence honest (usually "low" or "medium").
- Uncalibrated measurements are in image pixels and only useful as ratios; do not convert them to mm.
- Intraoral scan images are renders of the 3D model from fixed angles; colour is not tooth shade.
- CBCT images are single slices or maximum intensity projections (MIPs) cut from the volume, labelled with the view. A MIP superimposes everything along its direction, so use it for overview only. Views the dentist added by hand may show their measurement lines drawn on.
- If records conflict (e.g. notes say a tooth is present but the radiograph suggests otherwise), say so in risksAndFlags.

Be thorough. The dentist wants a full specialist-level work-up, not a brief overview: work through every record and every area systematically, and include everything clinically relevant, including incidental findings. Depth and accuracy matter more than brevity.

What to produce:
- caseSummary: a full paragraph (6-10 sentences) pulling the case together around the chief complaint and patient goals, including the overall diagnosis, risk profile and the main decision the dentist faces.
- recordReviews: one entry per record you were given, in order, using its caption. Report a systematic read, not just the headline. For an OPG: each quadrant, missing and restored teeth, caries, periapical areas, root fillings, bone levels and pattern of loss, furcations, third molars, the inferior alveolar canals, maxillary sinuses, condyles and any incidental findings. For periapicals and bitewings: crowns, contacts, caries, restorations, root form, PDL space, bone crest. For photos: soft tissues, gingival form and recession, tooth wear, existing restorations, shade, smile line and aesthetics. For scans: arch form, alignment, spacing and crowding, wear facets, occlusion as far as the views allow. For CBCT: bone width and height qualitatively, cortical plates, canal and sinus relationships, pathology. Say plainly when an image is not of diagnostic quality.
- assessments: one entry for each of these areas, saying "not assessable from the records" where that is the case: periodontal, caries and restorative, endodontic, occlusion and TMJ, tooth wear, orthodontic and alignment, aesthetics, soft tissues and oral mucosa, edentulous spaces and implant sites.
- toothChart: an entry for every tooth you can assess (present, missing, restored, or with a finding), in FDI order. status is short (e.g. "MOD amalgam, recurrent caries distal", "missing", "sound"). prognosis is your provisional view; use "not assessed" when the records don't support one.
- diagnoses: the working diagnoses (e.g. "Generalised periodontitis, stage III grade B", "Symptomatic irreversible pulpitis 36"), each with the teeth involved, the rationale from the records, and any differential diagnoses to rule out. Use current classifications (2017 AAP/EFP for periodontal disease) where they apply.
- findings: one entry per tooth-level or arch-level finding. tooth is null for general findings. source names the record caption or note it came from.
- treatmentOptions: 2-4 realistic options that fit the patient's goals, from conservative to comprehensive. For each: sequence lists the phases in order (e.g. stabilisation and hygiene phase, endodontics, definitive restoration, replacement of missing teeth, maintenance), prognosis gives the expected outcome and its main risks, maintenance describes long-term care and review. addresses lists the findings each option deals with.
- risksAndFlags: medical history interactions (e.g. antiresorptives, anticoagulants, diabetes, smoking), contraindications, and anything urgent.
- missingInformation: records or tests that would change the plan (e.g. sensibility testing, periodontal charting, a CBCT for a specific site).
- suggestedNextSteps: practical steps before the treatment-planning appointment.`;

export function buildCaseText(c: Case, records: CaseRecord[], question: string, sentCounts?: number[]): string {
  const d = c.details;
  const lines: string[] = [
    `Case reference: ${d.reference || "(none)"}`,
    `Age: ${d.age ?? "not recorded"} | Sex: ${d.sex}`,
    "",
    `Chief complaint: ${d.chiefComplaint || "not recorded"}`,
    `Patient goals: ${d.patientGoals || "not recorded"}`,
    "",
    `Medical history:\n${d.medicalHistory || "not recorded"}`,
    "",
    `Dental history:\n${d.dentalHistory || "not recorded"}`,
    "",
    `Examination findings:\n${d.examination || "not recorded"}`,
    "",
    `Other notes:\n${d.notes || "none"}`,
    "",
    "Records included (images follow in this order):",
  ];
  records.forEach((r, i) => {
    const view = r.view ? ` (${r.view})` : "";
    const calib =
      r.kind === "scan"
        ? "3D model in mm"
        : r.kind === "cbct" && r.volume
          ? `CBCT volume ${r.volume.dims.join(" x ")} voxels, voxel size ${r.volume.spacing.map((s) => s.toFixed(3)).join(" x ")} mm`
          : r.mmPerPixel
          ? `calibrated, ${r.mmPerPixel.toFixed(4)} mm/pixel from ${r.calibrationSource}`
          : "not calibrated";
    const sent = sentCounts?.[i] ?? r.previews.length;
    const images = sent === r.previews.length ? `${sent} image(s)` : `${sent} of ${r.previews.length} images sent`;
    lines.push(`${i + 1}. [${r.kind}${view}] "${r.caption || r.originalName}" - ${images}, ${calib}`);
  });
  const omitted = records.reduce((n, r, i) => n + r.previews.length - (sentCounts?.[i] ?? r.previews.length), 0);
  if (omitted > 0) {
    lines.push(`(${omitted} further image(s) were left out to keep within the per-analysis limit; mention it if they would matter.)`);
  }

  const measured = records.flatMap((r) => r.measurements.map((m) => ({ r, m })));
  lines.push("", "Clinician measurements:");
  if (measured.length === 0) lines.push("none");
  for (const { r, m } of measured) {
    const unit = m.type === "angle" ? "°" : m.calibrated ? " mm" : " px (uncalibrated)";
    const tooth = m.tooth ? ` [tooth ${m.tooth}]` : "";
    const where = m.plane ? `, ${m.plane} view` : "";
    lines.push(`- ${m.label || m.type}${tooth}: ${m.value.toFixed(m.type === "angle" ? 1 : 2)}${unit} (on "${r.caption || r.originalName}"${where})`);
  }

  lines.push("", `Question from the dentist: ${question || "Please analyse this case and outline treatment options."}`);
  return lines.join("\n");
}

/** Scales an image down for Claude. Stored previews stay full size for measuring. */
export async function imageForAi(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .resize({ width: AI_MAX_EDGE, height: AI_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

export async function buildMessageContent(
  c: Case,
  records: CaseRecord[],
  question: string,
): Promise<{ content: Anthropic.ContentBlockParam[]; imageCount: number; omittedImageCount: number }> {
  const content: Anthropic.ContentBlockParam[] = [];
  const choices = selectImages(records);
  const sentCounts = records.map(() => 0);
  for (const { recordIndex, previewIndex } of choices) {
    const r = records[recordIndex];
    const preview = r.previews[previewIndex];
    const data = await imageForAi(await fs.readFile(filePath(c.id, preview)));
    const label = r.previewLabels?.[previewIndex] ? ` - ${r.previewLabels[previewIndex]}` : "";
    content.push({ type: "text", text: `Image from "${r.caption || r.originalName}" (${r.kind}${r.view ? `, ${r.view}` : ""})${label}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } });
    sentCounts[recordIndex]++;
  }
  content.push({ type: "text", text: buildCaseText(c, records, question, sentCounts) });
  const total = records.reduce((n, r) => n + r.previews.length, 0);
  return { content, imageCount: choices.length, omittedImageCount: total - choices.length };
}

export async function runAnalysis(
  client: Anthropic,
  c: Case,
  records: CaseRecord[],
  question: string,
  model: AnalysisModel = MODEL,
): Promise<{ output: AnalysisOutput; imageCount: number; omittedImageCount: number; usage: { inputTokens: number; outputTokens: number } }> {
  const { content, imageCount, omittedImageCount } = await buildMessageContent(c, records, question);
  // Highest effort: accuracy matters more than speed or cost here. Streaming avoids HTTP
  // timeouts on long answers, and max_tokens leaves room for thinking plus a full work-up.
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 64000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: { effort: "max", format: zodOutputFormat(AnalysisSchema) },
    },
    { timeout: 30 * 60 * 1000 },
  );
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The analysis was cut off because it was too long. Try including fewer records.");
  }
  if (!response.parsed_output) throw new Error("Claude's answer could not be read as an analysis.");

  return {
    output: response.parsed_output,
    imageCount,
    omittedImageCount,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
