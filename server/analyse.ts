// Builds the Claude request for a case and parses the structured analysis.
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AnalysisOutput, Case, CaseRecord } from "../shared/types.js";
import { filePath } from "./store.js";

export const MODEL = "claude-opus-5-5";
/** Keeps requests a sensible size; the dentist picks which records to include. */
export const MAX_IMAGES = 24;

const AnalysisSchema = z.object({
  caseSummary: z.string(),
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
      advantages: z.array(z.string()),
      disadvantages: z.array(z.string()),
      prerequisites: z.array(z.string()),
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

What to produce:
- caseSummary: 3-6 sentences pulling the case together around the chief complaint and patient goals.
- findings: one entry per tooth-level or arch-level finding. tooth is null for general findings. source names the record caption or note it came from.
- treatmentOptions: 2-4 realistic options that fit the patient's goals, from conservative to comprehensive. Include phased care (stabilisation, hygiene, endodontics) when relevant. addresses lists the findings each option deals with.
- risksAndFlags: medical history interactions (e.g. antiresorptives, anticoagulants, diabetes, smoking), contraindications, and anything urgent.
- missingInformation: records or tests that would change the plan (e.g. sensibility testing, periodontal charting, a CBCT for a specific site).
- suggestedNextSteps: practical steps before the treatment-planning appointment.`;

export function buildCaseText(c: Case, records: CaseRecord[], question: string): string {
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
    lines.push(`${i + 1}. [${r.kind}${view}] "${r.caption || r.originalName}" - ${r.previews.length} image(s), ${calib}`);
  });

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

function mediaType(name: string): "image/png" | "image/jpeg" {
  return name.endsWith(".png") ? "image/png" : "image/jpeg";
}

export async function buildMessageContent(
  c: Case,
  records: CaseRecord[],
  question: string,
): Promise<{ content: Anthropic.ContentBlockParam[]; imageCount: number }> {
  const content: Anthropic.ContentBlockParam[] = [];
  let imageCount = 0;
  for (const r of records) {
    for (const [i, preview] of r.previews.entries()) {
      if (imageCount >= MAX_IMAGES) break;
      const data = await fs.readFile(filePath(c.id, preview));
      const label = r.previewLabels?.[i] ? ` - ${r.previewLabels[i]}` : "";
      content.push({ type: "text", text: `Image from "${r.caption || r.originalName}" (${r.kind}${r.view ? `, ${r.view}` : ""})${label}:` });
      content.push({ type: "image", source: { type: "base64", media_type: mediaType(preview), data: data.toString("base64") } });
      imageCount++;
    }
  }
  content.push({ type: "text", text: buildCaseText(c, records, question) });
  return { content, imageCount };
}

export async function runAnalysis(
  client: Anthropic,
  c: Case,
  records: CaseRecord[],
  question: string,
): Promise<{ output: AnalysisOutput; imageCount: number; usage: { inputTokens: number; outputTokens: number } }> {
  const { content, imageCount } = await buildMessageContent(c, records, question);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { effort: "high", format: zodOutputFormat(AnalysisSchema) },
  });

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
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
