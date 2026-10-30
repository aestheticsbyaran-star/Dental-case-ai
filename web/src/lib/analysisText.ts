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
    "",
    "FINDINGS",
    ...o.findings.map((f) => `- ${f.tooth ? `${f.tooth}: ` : ""}${f.finding} (${BASIS[f.basis]}, ${f.confidence} confidence)`),
  ];
  if (o.risksAndFlags.length) out.push("", "RISKS AND FLAGS", ...o.risksAndFlags.map((x) => `- ${x}`));
  out.push("", "TREATMENT OPTIONS");
  o.treatmentOptions.forEach((t, i) => {
    out.push(`${String.fromCharCode(65 + i)}. ${t.title}`, `   ${t.description}`);
    if (t.advantages.length) out.push(`   Pros: ${t.advantages.join("; ")}`);
    if (t.disadvantages.length) out.push(`   Cons: ${t.disadvantages.join("; ")}`);
    if (t.prerequisites.length) out.push(`   Before starting: ${t.prerequisites.join("; ")}`);
  });
  if (o.missingInformation.length) out.push("", "MISSING INFORMATION", ...o.missingInformation.map((x) => `- ${x}`));
  if (o.suggestedNextSteps.length) out.push("", "NEXT STEPS", ...o.suggestedNextSteps.map((x) => `- ${x}`));
  if (a.review.finalPlan.trim()) out.push("", "AGREED PLAN", a.review.finalPlan.trim());
  return out.join("\n");
}
