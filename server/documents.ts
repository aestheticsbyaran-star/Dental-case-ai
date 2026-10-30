// Writes patient documents and record notes from an analysis and the dentist's own plan.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Analysis, BrandSettings, Case, DocumentContentMap, DocumentImage, DocumentKind } from "../shared/types.js";
import { MODEL } from "./analyse.js";

/** Most images a presentation can choose from. Only their labels are sent, not the images. */
const MAX_DECK_IMAGES = 40;

export const DOCUMENT_SCHEMAS = {
  letter: z.object({
    subject: z.string(),
    paragraphs: z.array(z.string()),
  }),
  records: z.object({
    text: z.string(),
  }),
  guide: z.object({
    title: z.string(),
    intro: z.string(),
    sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.string()), bullets: z.array(z.string()) })),
  }),
  presentation: z.object({
    title: z.string(),
    slides: z.array(
      z.object({
        title: z.string(),
        bullets: z.array(z.string()),
        script: z.string(),
        imageIndex: z.number().int().nullable(),
      }),
    ),
  }),
} satisfies { [K in DocumentKind]: z.ZodType<DocumentContentMap[K]> };

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  letter: "Treatment plan letter",
  records: "Clinical records note",
  guide: "Treatment plan guide",
  presentation: "Patient presentation",
};

const COMMON_RULES = `Ground rules:
- The dentist's final plan (if given) and the chosen treatment option are the authority. Follow them, and do not recommend something different.
- Only state findings that come from the dentist's notes, measurements or final plan. Findings marked "AI visual impression" are unconfirmed: leave them out of patient-facing documents unless the final plan or notes confirm them.
- Never mention AI, Claude or software. The documents come from the dentist.
- Do not write the patient's name, date of birth or any appointment dates; the app adds the greeting and date. Do not invent fees: use the fees given in the instructions, otherwise write "[fee]".
- Use UK spelling and UK dental terms. Do not use Markdown formatting such as ** or #.
- For patient-facing documents, follow GDC and Montgomery consent principles: explain what is involved, the benefits, the material risks, the reasonable alternatives (including no treatment and its likely consequences), costs and what happens next, in plain language a patient can follow. Describe teeth in words with the FDI number in brackets, e.g. "lower left first molar (36)".`;

const KIND_PROMPTS: Record<DocumentKind, string> = {
  letter: `Write a treatment plan letter from the dentist to the patient, written in the first person as the dentist.
- subject: a short subject line, e.g. "Your treatment plan: replacing the lower left back tooth".
- paragraphs: the body only, 5 to 10 short paragraphs. No greeting ("Dear ...") and no sign-off; the letterhead adds them. Start by thanking the patient for coming in and summarising what they came in about. Cover what was found, the options (including no treatment), the recommended plan step by step, risks, costs and how to go ahead or ask questions. Warm and clear, not salesy.`,
  records: `Write a clinical records note for the dentist to paste into the practice management software. This is clinician-facing: concise, standard UK clinical note style, FDI notation, abbreviations clinicians use (C/O, MH, E/O, I/O, BPE, Tx).
- text: plain text only, with section headings in capitals on their own line and short lines under each. Suggested sections: C/O, MH (relevant points), DH, EXAMINATION, INVESTIGATIONS (records taken and the dentist's measurements with units), DIAGNOSIS/FINDINGS (clinician-confirmed only), TREATMENT OPTIONS DISCUSSED (each with main risks and benefits, including no treatment), PLAN, NEXT VISIT.
- Write it so it is accurate whatever happened in the appointment: put things only the dentist can confirm in square brackets, e.g. "[Options, risks and costs discussed; patient given time to consider]" and "[Written plan and estimate given]".
- Do not mention AI. If the final plan is empty, write the plan section as "[Plan to be confirmed]".`,
  guide: `Write a treatment plan guide the patient can take home and read: a friendly, practical explanation of the recommended treatment, written to the patient ("you").
- title: e.g. "Your guide to your dental implant treatment".
- intro: 2 to 3 sentences.
- sections: 5 to 8 sections, such as: Why we are recommending this, Your treatment step by step (what happens at each visit and roughly how long it takes), What it feels like, Looking after your teeth afterwards, Risks and what to look out for, Other options, Costs, Questions and how to contact us. Use bullets for steps and lists, paragraphs for explanation. Leave bullets or paragraphs empty when not needed.`,
  presentation: `Write a slide deck the dentist will screen-record over to explain the treatment plan to the patient in a short video, about 3 to 6 minutes long.
- title: the deck title, e.g. "Your treatment plan".
- slides: 6 to 12 slides. Suggested flow: welcome and why they came in, what we found, what that means if left, the options (including no treatment), the recommended plan, the steps and timeline, risks and aftercare, costs, next steps.
- bullets: at most 4 per slide, each under 10 words. Slides are read on screen, so keep them short.
- script: what the dentist says over the slide, 40 to 120 words, first person, talking to the patient as "you", conversational and reassuring.
- imageIndex: the number of a case image that helps explain the slide (for example the photo or radiograph showing the problem tooth), or null for a text-only slide. Only use numbers from the image list, and only where an image genuinely helps.`,
};

export function documentSystemPrompt(kind: DocumentKind, brand: BrandSettings): string {
  const who = [brand.displayName, brand.qualifications].filter(Boolean).join(", ");
  const practice = brand.practiceName ? ` at ${brand.practiceName}` : "";
  const style = brand.writingStyle.trim()
    ? `\n\nThe dentist's own notes on style (follow these, and match the tone of any example text):\n${brand.writingStyle.trim()}`
    : "";
  return `You write documents for ${who || "a UK dentist"}${practice}, a UK dentist, about one of their patients' treatment. The dentist reads and edits everything before it is used.\n\n${KIND_PROMPTS[kind]}\n\n${COMMON_RULES}${style}`;
}

/** Images a presentation may show: photos and radiographs first, then scan views and hand-picked CBCT views. */
export function documentImages(c: Case): DocumentImage[] {
  const out: DocumentImage[] = [];
  const add = (recordIndex: number, previewIndex: number) => {
    const r = c.records[recordIndex];
    const extra = r.previewLabels?.[previewIndex];
    const view = r.view ? `, ${r.view}` : "";
    out.push({
      recordId: r.id,
      preview: r.previews[previewIndex],
      label: `${r.caption || r.originalName} (${r.kind}${view})${extra ? ` - ${extra}` : ""}`,
    });
  };
  c.records.forEach((r, ri) => {
    if (r.kind === "photo" || r.kind === "radiograph" || r.kind === "dicom") r.previews.forEach((_, pi) => add(ri, pi));
  });
  c.records.forEach((r, ri) => {
    if (r.kind === "scan") r.previews.slice(0, 2).forEach((_, pi) => add(ri, pi));
    if (r.kind === "cbct") r.previews.forEach((_, pi) => pi >= 5 && add(ri, pi));
  });
  return out.slice(0, MAX_DECK_IMAGES);
}

export function buildDocumentText(
  c: Case,
  analysis: Analysis,
  kind: DocumentKind,
  optionTitle: string,
  instructions: string,
  images: DocumentImage[],
): string {
  const d = c.details;
  const o = analysis.output;
  const lines: string[] = [
    `Age: ${d.age ?? "not recorded"} | Sex: ${d.sex}`,
    `Chief complaint: ${d.chiefComplaint || "not recorded"}`,
    `Patient goals: ${d.patientGoals || "not recorded"}`,
    "",
    `Medical history:\n${d.medicalHistory || "not recorded"}`,
    "",
    `Dental history:\n${d.dentalHistory || "not recorded"}`,
    "",
    `Examination findings (dentist's notes):\n${d.examination || "not recorded"}`,
    "",
    `Other notes:\n${d.notes || "none"}`,
  ];

  const measured = c.records.flatMap((r) => r.measurements.map((m) => ({ r, m })));
  if (measured.length) {
    lines.push("", "Dentist's measurements:");
    for (const { r, m } of measured) {
      const unit = m.type === "angle" ? "°" : m.calibrated ? " mm" : " px (uncalibrated, do not quote)";
      lines.push(`- ${m.label || m.type}${m.tooth ? ` [tooth ${m.tooth}]` : ""}: ${m.value.toFixed(m.type === "angle" ? 1 : 2)}${unit} (on "${r.caption || r.originalName}")`);
    }
  }

  if (o) {
    lines.push("", "Case analysis (prepared for the dentist):", o.caseSummary);
    if (o.diagnoses?.length) {
      lines.push("", "Working diagnoses (AI, check against the dentist's notes and final plan):");
      for (const d of o.diagnoses) lines.push(`- ${d.diagnosis}${d.teeth ? ` (${d.teeth})` : ""}`);
    }
    lines.push("", "Findings:");
    for (const f of o.findings) {
      const basis = f.basis === "visual-impression" ? "AI visual impression, unconfirmed" : f.basis === "clinician-measurement" ? "dentist's measurement" : "dentist's notes";
      lines.push(`- ${f.tooth ? `[${f.tooth}] ` : ""}${f.finding} (${basis})`);
    }
    lines.push("", "Treatment options:");
    o.treatmentOptions.forEach((t, i) => {
      lines.push(`${String.fromCharCode(65 + i)}. ${t.title}: ${t.description}`);
      if (t.sequence?.length) lines.push(`   Sequence: ${t.sequence.join(" -> ")}`);
      if (t.advantages.length) lines.push(`   Advantages: ${t.advantages.join("; ")}`);
      if (t.disadvantages.length) lines.push(`   Disadvantages: ${t.disadvantages.join("; ")}`);
      if (t.prerequisites.length) lines.push(`   Before starting: ${t.prerequisites.join("; ")}`);
    });
    if (o.risksAndFlags.length) lines.push("", "Risks and flags:", ...o.risksAndFlags.map((x) => `- ${x}`));
  }

  lines.push("", `Dentist's final plan:\n${analysis.review.finalPlan.trim() || "not written yet"}`);
  lines.push("", `Treatment option to write about: ${optionTitle || "the dentist's final plan above"}`);

  if (kind === "presentation") {
    lines.push("", "Case images available for slides (use the number as imageIndex):");
    if (images.length === 0) lines.push("none (use null for every slide)");
    images.forEach((img, i) => lines.push(`${i}. ${img.label}`));
  }

  lines.push("", `Instructions from the dentist: ${instructions.trim() || "none"}`);
  lines.push("", `Please write the ${DOCUMENT_LABELS[kind].toLowerCase()}.`);
  return lines.join("\n");
}

type AnyContent = DocumentContentMap[DocumentKind];

export async function writeDocument(
  client: Anthropic,
  args: { c: Case; analysis: Analysis; kind: DocumentKind; optionTitle: string; instructions: string; brand: BrandSettings; images: DocumentImage[] },
): Promise<{ content: AnyContent; usage: { inputTokens: number; outputTokens: number } }> {
  const { c, analysis, kind, optionTitle, instructions, brand, images } = args;
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: documentSystemPrompt(kind, brand),
    messages: [{ role: "user", content: buildDocumentText(c, analysis, kind, optionTitle, instructions, images) }],
    output_config: { effort: "medium", format: zodOutputFormat(DOCUMENT_SCHEMAS[kind] as z.ZodType<AnyContent>) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("The document was cut off because it was too long. Try again with shorter instructions.");
  const content = response.parsed_output;
  if (!content) throw new Error("Claude's answer could not be read as a document.");

  if ("slides" in content) {
    for (const s of content.slides) {
      if (s.imageIndex !== null && !(s.imageIndex >= 0 && s.imageIndex < images.length)) s.imageIndex = null;
    }
  }
  return { content, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
}
