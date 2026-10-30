import { useEffect, useState } from "react";
import type { BrandSettings } from "../../../shared/types";
import { api } from "../lib/api";
import { useBrand } from "../lib/brand";
import { LetterPaper } from "./DocumentViews";

const FIELDS: { key: keyof BrandSettings; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: "displayName", label: "Name", placeholder: "Dr Aran Maxwell-Cox" },
  { key: "qualifications", label: "Qualifications", placeholder: "e.g. BDS MJDF RCS (Eng)" },
  { key: "gdcNumber", label: "GDC number", placeholder: "e.g. 123456" },
  { key: "practiceName", label: "Practice name", placeholder: "Shown on letters, guides and slides" },
  { key: "address", label: "Practice address", placeholder: "One line per row", multiline: true },
  { key: "phone", label: "Phone", placeholder: "" },
  { key: "email", label: "Email", placeholder: "" },
  { key: "website", label: "Website", placeholder: "" },
  { key: "signOff", label: "Letter sign-off", placeholder: "Kind regards" },
];

export function SettingsPage() {
  const { brand, setBrand } = useBrand();
  const [b, setB] = useState<BrandSettings>(brand);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(b) !== JSON.stringify(brand);

  useEffect(() => setB(brand), [brand]);

  const set = <K extends keyof BrandSettings>(key: K, value: BrandSettings[K]) => {
    setB((prev) => ({ ...prev, [key]: value }));
    setState("idle");
  };

  const save = async () => {
    setState("saving");
    setError(null);
    try {
      setBrand(await api.saveBrand(b));
      setState("saved");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const saved = await api.uploadLogo(file);
      setBrand(saved);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sample = { subject: "Your treatment plan", paragraphs: ["This is how your letters will look. The text is written for each patient on the Documents tab of a case."] };

  return (
    <div className="settings">
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>Practice settings</h2>
        <p className="small muted">
          These details brand the app and appear on letters, guides and patient presentations. They are saved on this computer only.
        </p>

        <div className="stack" style={{ gap: 6 }}>
          <strong className="small">Logo</strong>
          <div className="row">
            <label className="filepick">
              <span>{brand.logo ? "Replace logo" : "Upload logo"}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </label>
            {brand.logo && (
              <button type="button" className="danger" onClick={() => api.deleteLogo().then(setBrand)}>
                Remove logo
              </button>
            )}
          </div>
          <span className="small muted">PNG with a transparent background works best.</span>
        </div>

        <label>
          <span>Brand colour</span>
          <span className="row">
            <input type="color" style={{ width: 52, padding: 2, height: 34 }} value={b.brandColour} onChange={(e) => set("brandColour", e.target.value)} />
            <input className="mono" style={{ maxWidth: 120 }} value={b.brandColour} onChange={(e) => set("brandColour", e.target.value)} />
          </span>
        </label>

        <div className="form-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className={f.multiline ? "wide" : undefined}>
              <span>{f.label}</span>
              {f.multiline ? (
                <textarea rows={3} placeholder={f.placeholder} value={b[f.key] as string} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input placeholder={f.placeholder} value={b[f.key] as string} onChange={(e) => set(f.key, e.target.value)} />
              )}
            </label>
          ))}
          <label className="wide">
            <span>Writing style for patient documents</span>
            <textarea
              rows={6}
              placeholder={
                "How you like letters to sound, phrases you always use, and anything to avoid. You can paste an example letter (with patient details removed) and it will be matched."
              }
              value={b.writingStyle}
              onChange={(e) => set("writingStyle", e.target.value)}
            />
          </label>
        </div>

        <div className="row">
          <button className="primary" type="submit" disabled={!dirty || state === "saving" || !/^#[0-9a-f]{6}$/i.test(b.brandColour)}>
            {state === "saving" ? "Saving…" : "Save settings"}
          </button>
          {state === "saved" && !dirty && <span className="small muted">Saved</span>}
          {dirty && state !== "saving" && <span className="small muted">Unsaved changes</span>}
        </div>
        {error && <div className="error">{error}</div>}
      </form>

      <section className="stack">
        <h3>Letter preview</h3>
        <div className="paper-scroll">
          <LetterPaper brand={{ ...b, logo: brand.logo }} content={sample} patientName="" />
        </div>
      </section>
    </div>
  );
}
