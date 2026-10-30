// Plain-text version of an analysis, for pasting into notes or a referral.
import type { Analysis, Case, FindingBasis } from "../../../shared/types";

const BASIS: Record<FindingBasis, string> = {
  "clinician-measurement": "measured",
  "clinician-notes": "from notes",
  "visual-impression": "AI visual impression, to confirm",
};

export function analysisText(c: Case, a: Analysis): string {
  const o = a.output;
  if (!o) return "";
  const out: string[] = [
    `CASE ANALYSIS ${c.details.reference ? `(${c.details.reference}) ` : ""}${new Date(a.createdAt).toLocaleDateString("en-GB")}`,
    "AI-assisted, reviewed by the treating clinician.",
    "",
    "SUMMARY",
    o.caseSummary,
  ];
  if (o.diagnoses?.length) {
    out.push("", "WORKING DIAGNOSES");
    for (const d of o.diagnoses) {
      out.push(`- ${d.diagnosis}${d.teeth ? ` (${d.teeth})` : ""}: ${d.rationale}${d.differentials.length ? ` Rule out: ${d.differentials.join("; ")}.` : ""}`);
    }
  }
  if (o.assessments?.length) out.push("", "ASSESSMENT BY AREA", ...o.assessments.map((x) => `- ${x.area}: ${x.assessment}`));
  if (o.recordReviews?.length) {
    out.push("", "RECORD BY RECORD");
    for (const r of o.recordReviews) out.push(`${r.record}:`, ...r.observations.map((x) => `  - ${x}`));
  }
  if (o.toothChart?.length) {
    out.push("", "TOOTH CHART", ...o.toothChart.map((t) => `- ${t.tooth}: ${t.status}; prognosis ${t.prognosis}${t.notes ? `. ${t.notes}` : ""}`));
  }
  out.push(
    "",
    "FINDINGS",
    ...o.findings.map((f) => `- ${f.tooth ? `${f.tooth}: ` : ""}${f.finding} (${BASIS[f.basis]}, ${f.confidence} confidence)`),
  );
  if (o.risksAndFlags.length) out.push("", "RISKS AND FLAGS", ...o.risksAndFlags.map((x) => `- ${x}`));
  out.push("", "TREATMENT OPTIONS");
  o.treatmentOptions.forEach((t, i) => {
    out.push(`${String.fromCharCode(65 + i)}. ${t.title}`, `   ${t.description}`);
    if (t.sequence?.length) out.push(`   Sequence: ${t.sequence.map((x, n) => `${n + 1}) ${x}`).join(" ")}`);
    if (t.advantages.length) out.push(`   Pros: ${t.advantages.join("; ")}`);
    if (t.disadvantages.length) out.push(`   Cons: ${t.disadvantages.join("; ")}`);
    if (t.prerequisites.length) out.push(`   Before starting: ${t.prerequisites.join("; ")}`);
    if (t.prognosis) out.push(`   Prognosis: ${t.prognosis}`);
    if (t.maintenance) out.push(`   Maintenance: ${t.maintenance}`);
  });
  if (o.missingInformation.length) out.push("", "MISSING INFORMATION", ...o.missingInformation.map((x) => `- ${x}`));
  if (o.suggestedNextSteps.length) out.push("", "NEXT STEPS", ...o.suggestedNextSteps.map((x) => `- ${x}`));
  if (a.review.finalPlan.trim()) out.push("", "AGREED PLAN", a.review.finalPlan.trim());
  return out.join("\n");
}
