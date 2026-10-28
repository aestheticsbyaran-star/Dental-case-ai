import { useEffect, useState } from "react";
import type { Case, CaseDetails, Sex } from "../../../shared/types";
import { api } from "../lib/api";

const TEXT_FIELDS: { key: keyof CaseDetails; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "chiefComplaint", label: "Chief complaint", placeholder: "In the patient's words, e.g. \"gap at the back, wants something fixed\"" },
  { key: "patientGoals", label: "Patient goals and constraints", placeholder: "Aesthetic priorities, budget, time, anxiety, preference for fixed or removable" },
  { key: "medicalHistory", label: "Medical history", placeholder: "Conditions, medications (e.g. bisphosphonates, anticoagulants), allergies, smoking", wide: true },
  { key: "dentalHistory", label: "Dental history", placeholder: "Previous treatment, extractions, ortho, bruxism, attendance" },
  { key: "examination", label: "Examination findings", placeholder: "Extraoral, soft tissue, BPE/perio, caries, mobility, occlusion, TMJ" },
  { key: "notes", label: "Other notes", placeholder: "Anything else, including text pasted from letters or reports", wide: true },
];

export function DetailsForm({ c, onSaved }: { c: Case; onSaved: (c: Case) => void }) {
  const [d, setD] = useState<CaseDetails>(c.details);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = JSON.stringify(d) !== JSON.stringify(c.details);

  useEffect(() => setD(c.details), [c.details]);

  const set = <K extends keyof CaseDetails>(key: K, value: CaseDetails[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    setState("idle");
  };

  const save = async () => {
    setState("saving");
    try {
      onSaved(await api.saveDetails(c.id, d));
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="form-grid">
        <label>
          <span>Case reference</span>
          <input id="ref" value={d.reference} onChange={(e) => set("reference", e.target.value)} />
        </label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ flex: 1 }}>
            <span>Age</span>
            <input
              id="age"
              type="number"
              min={0}
              max={120}
              value={d.age ?? ""}
              onChange={(e) => set("age", e.target.value === "" ? null : Number(e.target.value))}
            />
          </label>
          <label style={{ flex: 1 }}>
            <span>Sex</span>
            <select id="sex" value={d.sex} onChange={(e) => set("sex", e.target.value as Sex)}>
              <option value="not-recorded">Not recorded</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        {TEXT_FIELDS.map((f) => (
          <label key={f.key} className={f.wide ? "wide" : undefined}>
            <span>{f.label}</span>
            <textarea
              id={f.key}
              rows={f.wide ? 4 : 3}
              placeholder={f.placeholder}
              value={d[f.key] as string}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="row">
        <button className="primary" type="submit" disabled={!dirty || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save details"}
        </button>
        {state === "saved" && !dirty && <span className="muted small">Saved</span>}
        {state === "error" && <span className="error small">Couldn't save. Is the local server running?</span>}
        {dirty && state !== "saving" && <span className="muted small">Unsaved changes</span>}
      </div>
    </form>
  );
}
