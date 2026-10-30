import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  BrandSettings,
  Case,
  ConsentContent,
  DocumentKind,
  GuideContent,
  GuideSection,
  LetterContent,
  PatientDocument,
  PresentationContent,
  RecordsContent,
  Slide,
} from "../../../shared/types";
import { api } from "../lib/api";
import { PrintOnly, fullName, useBrand } from "../lib/brand";
import { CONSENT_DECLARATIONS, ConsentPaper, CoverSlide, EndSlide, GuidePaper, LetterPaper, SlideFrame } from "./DocumentViews";

export const DOCUMENT_KINDS: { kind: DocumentKind; label: string; blurb: string; placeholder: string }[] = [
  {
    kind: "letter",
    label: "Treatment plan letter",
    blurb: "A letter to the patient setting out the options, risks and costs, on your letterhead.",
    placeholder: "e.g. Fees: implant £2,450, crown £1,050. Mention our 0% finance. Patient is nervous, keep it reassuring.",
  },
  {
    kind: "records",
    label: "Records note",
    blurb: "Clinical note text to paste into your practice software.",
    placeholder: "e.g. BPE 2/1/2 2/2/1. Sensibility tested 36: negative. Patient wants time to think.",
  },
  {
    kind: "guide",
    label: "Treatment plan guide",
    blurb: "A take-home guide explaining each stage, aftercare and what to expect.",
    placeholder: "e.g. Healing time 3 months before the crown. Include our aftercare advice for implants.",
  },
  {
    kind: "presentation",
    label: "Patient presentation",
    blurb: "Slides with the patient's own photos and X-rays and a script to read while you screen-record.",
    placeholder: "e.g. Keep it under 4 minutes. Show the OPG when explaining the bone loss.",
  },
  {
    kind: "consent",
    label: "Consent form",
    blurb: "Treatment-specific risks, benefits and alternatives (including no treatment), with declarations and signature boxes.",
    placeholder: "e.g. Fee £2,450. Under local anaesthetic, no sedation. Mention the bone graft may be needed.",
  },
];

const KIND_LABEL = Object.fromEntries(DOCUMENT_KINDS.map((k) => [k.kind, k.label])) as Record<DocumentKind, string>;

const paragraphsOf = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

async function copy(text: string, done: () => void) {
  await navigator.clipboard.writeText(text);
  done();
}

function CopyButton({ text, label = "Copy text" }: { text: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button type="button" onClick={() => copy(text(), () => setCopied(true))}>
      {copied ? "Copied" : label}
    </button>
  );
}

export function DocumentsPanel({ c, onChange }: { c: Case; onChange: () => void }) {
  const docs = c.documents ?? [];
  const analyses = c.analyses.filter((a) => a.status === "complete");
  const [analysisId, setAnalysisId] = useState(analyses[0]?.id ?? "");
  const [optionTitle, setOptionTitle] = useState("");
  const [kind, setKind] = useState<DocumentKind>("letter");
  const [instructions, setInstructions] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(docs[0]?.id ?? null);

  const analysis = analyses.find((a) => a.id === analysisId);
  useEffect(() => {
    if (!analysis && analyses[0]) setAnalysisId(analyses[0].id);
  }, [analysis, analyses]);
  const selected = docs.find((d) => d.id === selectedId) ?? docs[0];
  const kindInfo = DOCUMENT_KINDS.find((k) => k.kind === kind)!;

  if (analyses.length === 0) {
    return (
      <section className="panel stack">
        <h2>Patient documents</h2>
        <p className="muted">
          Run an analysis on the Analysis tab first. Letters, records notes, guides, presentations and consent forms are written from an analysis and
          your final plan.
        </p>
      </section>
    );
  }

  const write = async () => {
    setRunning(true);
    setError(null);
    try {
      const d = await api.writeDocument(c.id, { kind, analysisId, optionTitle, instructions });
      if (d.status === "failed") setError(d.error ?? "The document could not be written.");
      setSelectedId(d.id);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <h2>Write a document</h2>
        <div className="doc-kinds" role="radiogroup">
          {DOCUMENT_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              className={`doc-kind${kind === k.kind ? " active" : ""}`}
              onClick={() => setKind(k.kind)}
            >
              <strong>{k.label}</strong>
              <span className="small muted">{k.blurb}</span>
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label>
            <span>From analysis</span>
            <select value={analysisId} onChange={(e) => setAnalysisId(e.target.value)}>
              {analyses.map((a) => (
                <option key={a.id} value={a.id}>
                  {new Date(a.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  {a.question ? ` · ${a.question.slice(0, 50)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>About</span>
            <select value={optionTitle} onChange={(e) => setOptionTitle(e.target.value)}>
              <option value="">Your final plan{analysis?.review.finalPlan.trim() ? "" : " (not written yet)"}</option>
              {analysis?.output?.treatmentOptions.map((t, i) => (
                <option key={i} value={t.title}>
                  Option {String.fromCharCode(65 + i)}: {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>Anything to include? (optional)</span>
            <textarea rows={3} placeholder={kindInfo.placeholder} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </label>
        </div>
        {analysis && !analysis.review.finalPlan.trim() && (
          <p className="small warn">
            Tip: write your final plan under "Your review" on the Analysis tab. Documents follow your plan rather than the AI's options.
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={write} disabled={running || !analysisId}>
            {running ? "Writing…" : `Write ${kindInfo.label.toLowerCase()}`}
          </button>
          {running && (
            <span className="row small muted">
              <span className="spinner" /> This usually takes 20 to 60 seconds.
            </span>
          )}
        </div>
        <p className="small muted">
          Uses the case details, your measurements, the analysis and your final plan. No images are sent. Always read and edit before giving
          anything to a patient.
        </p>
        {error && <div className="error">{error}</div>}
      </section>

      {docs.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <h3>Documents for this case</h3>
          <div className="history">
            {docs.map((d) => (
              <button key={d.id} className={d.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(d.id)}>
                <span>
                  {KIND_LABEL[d.kind]}
                  {d.optionTitle && <span className="muted"> · {d.optionTitle.slice(0, 60)}</span>}
                </span>
                <span className="small">
                  {d.status === "failed" ? "Failed · " : ""}
                  {new Date(d.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && <DocumentView key={selected.id} c={c} doc={selected} onChange={onChange} />}
    </div>
  );
}

function DocumentView({ c, doc, onChange }: { c: Case; doc: PatientDocument; onChange: () => void }) {
  const remove = async () => {
    if (!window.confirm(`Delete this ${KIND_LABEL[doc.kind].toLowerCase()}?`)) return;
    await api.deleteDocument(c.id, doc.id);
    onChange();
  };
  const save = async (content: PatientDocument["content"]) => {
    await api.saveDocument(c.id, doc.id, content!);
    onChange();
  };

  if (doc.status === "failed" || !doc.content) {
    return (
      <div className="stack">
        <div className="error">This document could not be written: {doc.error}</div>
        <div>
          <button className="danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  const props = { c, onSave: save, onDelete: remove };
  switch (doc.kind) {
    case "letter":
      return <LetterView {...props} content={doc.content as LetterContent} />;
    case "records":
      return <RecordsView {...props} content={doc.content as RecordsContent} />;
    case "guide":
      return <GuideView {...props} content={doc.content as GuideContent} />;
    case "presentation":
      return <PresentationView {...props} doc={doc} content={doc.content as PresentationContent} />;
    case "consent":
      return <ConsentView {...props} content={doc.content as ConsentContent} />;
  }
}

interface ViewProps<T> {
  c: Case;
  content: T;
  onSave: (content: T) => Promise<void>;
  onDelete: () => void;
}

/** Edit / Save / Cancel state shared by every document view. */
function useDraft<T>(content: T, onSave: (content: T) => Promise<void>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(content);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(content), [content]);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);
  const cancel = () => {
    setDraft(content);
    setEditing(false);
  };
  return { editing, setEditing, draft, setDraft, save, cancel, saving };
}

interface DraftControls {
  editing: boolean;
  setEditing: (v: boolean) => void;
  save: () => void;
  cancel: () => void;
  saving: boolean;
}

function EditBar({ d, onDelete, children }: { d: DraftControls; onDelete: () => void; children?: ReactNode }) {
  return (
    <div className="row doc-toolbar">
      {d.editing ? (
        <>
          <button className="primary" onClick={d.save} disabled={d.saving}>
            {d.saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={d.cancel}>Cancel</button>
        </>
      ) : (
        <>
          {children}
          <button onClick={() => d.setEditing(true)}>Edit</button>
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function letterText(brand: BrandSettings, l: LetterContent, name: string) {
  return [
    `Dear ${name.trim() || "[patient name]"},`,
    l.subject,
    ...l.paragraphs,
    `${brand.signOff || "Kind regards"},`,
    [fullName(brand), brand.gdcNumber ? `GDC ${brand.gdcNumber}` : ""].filter(Boolean).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function LetterView({ content, onSave, onDelete }: ViewProps<LetterContent>) {
  const { brand } = useBrand();
  const d = useDraft(content, onSave);
  // The patient's name is only used on screen and in print; it is never saved or sent.
  const [name, setName] = useState("");

  return (
    <div className="stack">
      <EditBar d={d} onDelete={onDelete}>
        <label className="inline-label">
          <span>Patient name (not saved)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mrs Smith" style={{ width: 200 }} />
        </label>
        <button className="primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <CopyButton text={() => letterText(brand, content, name)} />
      </EditBar>
      {d.editing ? (
        <div className="panel stack">
          <label>
            <span>Subject</span>
            <input value={d.draft.subject} onChange={(e) => d.setDraft({ ...d.draft, subject: e.target.value })} />
          </label>
          <label>
            <span>Letter (leave a blank line between paragraphs)</span>
            <textarea
              rows={20}
              value={d.draft.paragraphs.join("\n\n")}
              onChange={(e) => d.setDraft({ ...d.draft, paragraphs: paragraphsOf(e.target.value) })}
            />
          </label>
        </div>
      ) : (
        <div className="paper-scroll">
          <LetterPaper brand={brand} content={content} patientName={name} />
        </div>
      )}
      <PrintOnly>
        <LetterPaper brand={brand} content={content} patientName={name} />
      </PrintOnly>
    </div>
  );
}

/** "Name: detail" lines, for editing risks and alternatives as text. */
const pairsText = <T,>(items: T[], a: keyof T, b: keyof T) => items.map((x) => (x[b] ? `${x[a]}: ${x[b]}` : String(x[a]))).join("\n");
const pairsOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""];
    });
const listOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function consentText(brand: BrandSettings, k: ConsentContent) {
  return [
    k.title,
    k.teeth && `Teeth: ${k.teeth}`,
    `THE PROPOSED TREATMENT\n${k.treatment}`,
    k.benefits.length && `BENEFITS\n${k.benefits.map((b) => `- ${b}`).join("\n")}`,
    `RISKS\n${k.risks.map((r) => `- ${r.risk}${r.detail ? `: ${r.detail}` : ""}`).join("\n")}`,
    `ALTERNATIVES\n${[...k.alternatives.map((a) => `- ${a.option}${a.summary ? `: ${a.summary}` : ""}`), `- No treatment: ${k.noTreatment}`].join("\n")}`,
    k.aftercare.length && `WHAT YOU NEED TO DO\n${k.aftercare.map((a) => `- ${a}`).join("\n")}`,
    `COST\n${k.cost || "[fee]"}`,
    `DECLARATION\n${CONSENT_DECLARATIONS.map((d) => `- ${d}`).join("\n")}`,
    `Clinician: ${fullName(brand)}${brand.gdcNumber ? `, GDC ${brand.gdcNumber}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function ConsentView({ content, onSave, onDelete }: ViewProps<ConsentContent>) {
  const { brand } = useBrand();
  const d = useDraft(content, onSave);
  const [name, setName] = useState("");
  // List fields are edited as text and parsed on save, so typing isn't reformatted under the cursor.
  const [text, setText] = useState(() => ({ benefits: "", risks: "", alternatives: "", aftercare: "" }));
  useEffect(
    () =>
      setText({
        benefits: content.benefits.join("\n"),
        risks: pairsText(content.risks, "risk", "detail"),
        alternatives: pairsText(content.alternatives, "option", "summary"),
        aftercare: content.aftercare.join("\n"),
      }),
    [content, d.editing],
  );
  const setList = (key: keyof typeof text, value: string) => {
    setText({ ...text, [key]: value });
    if (key === "risks") d.setDraft({ ...d.draft, risks: pairsOf(value).map(([risk, detail]) => ({ risk, detail })) });
    else if (key === "alternatives") d.setDraft({ ...d.draft, alternatives: pairsOf(value).map(([option, summary]) => ({ option, summary })) });
    else d.setDraft({ ...d.draft, [key]: listOf(value) });
  };

  return (
    <div className="stack">
      <EditBar d={d} onDelete={onDelete}>
        <label className="inline-label">
          <span>Patient name (not saved)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mrs Smith" style={{ width: 200 }} />
        </label>
        <button className="primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <CopyButton text={() => consentText(brand, content)} />
      </EditBar>
      <p className="small muted">
        Check that every material risk for this patient is listed before printing. Give the patient time to read it and ask questions before they sign.
      </p>
      {d.editing ? (
        <div className="panel stack">
          <label>
            <span>Title</span>
            <input value={d.draft.title} onChange={(e) => d.setDraft({ ...d.draft, title: e.target.value })} />
          </label>
          <div className="form-grid">
            <label>
              <span>Teeth</span>
              <input value={d.draft.teeth} onChange={(e) => d.setDraft({ ...d.draft, teeth: e.target.value })} />
            </label>
            <label>
              <span>Cost</span>
              <input value={d.draft.cost} onChange={(e) => d.setDraft({ ...d.draft, cost: e.target.value })} />
            </label>
          </div>
          <label>
            <span>The proposed treatment</span>
            <textarea rows={4} value={d.draft.treatment} onChange={(e) => d.setDraft({ ...d.draft, treatment: e.target.value })} />
          </label>
          <label>
            <span>Benefits (one per line)</span>
            <textarea rows={4} value={text.benefits} onChange={(e) => setList("benefits", e.target.value)} />
          </label>
          <label>
            <span>Risks (one per line, as "Risk: what it means")</span>
            <textarea rows={8} value={text.risks} onChange={(e) => setList("risks", e.target.value)} />
          </label>
          <label>
            <span>Alternatives (one per line, as "Option: trade-off")</span>
            <textarea rows={4} value={text.alternatives} onChange={(e) => setList("alternatives", e.target.value)} />
          </label>
          <label>
            <span>If no treatment</span>
            <textarea rows={3} value={d.draft.noTreatment} onChange={(e) => d.setDraft({ ...d.draft, noTreatment: e.target.value })} />
          </label>
          <label>
            <span>What the patient needs to do (one per line)</span>
            <textarea rows={4} value={text.aftercare} onChange={(e) => setList("aftercare", e.target.value)} />
          </label>
        </div>
      ) : (
        <div className="paper-scroll">
          <ConsentPaper brand={brand} content={content} patientName={name} />
        </div>
      )}
      <PrintOnly>
        <ConsentPaper brand={brand} content={content} patientName={name} />
      </PrintOnly>
    </div>
  );
}

function RecordsView({ content, onSave, onDelete }: ViewProps<RecordsContent>) {
  const d = useDraft(content, onSave);
  return (
    <div className="stack">
      <EditBar d={d} onDelete={onDelete}>
        <CopyButton text={() => content.text} label="Copy to clipboard" />
      </EditBar>
      <section className="panel stack">
        <p className="small muted">Check every line, fill in anything in [square brackets], then paste it into your clinical records.</p>
        {d.editing ? (
          <textarea className="mono records-text" rows={28} value={d.draft.text} onChange={(e) => d.setDraft({ text: e.target.value })} />
        ) : (
          <pre className="records-text">{content.text}</pre>
        )}
      </section>
    </div>
  );
}

const sectionText = (s: GuideSection) => [...s.paragraphs, s.bullets.map((b) => `- ${b}`).join("\n")].filter(Boolean).join("\n\n");

function parseSectionText(heading: string, text: string): GuideSection {
  const paragraphs: string[] = [];
  const bullets: string[] = [];
  for (const block of paragraphsOf(text)) {
    const rows = block.split("\n").map((r) => r.trim());
    if (rows.every((r) => /^[-•*]\s*/.test(r))) bullets.push(...rows.map((r) => r.replace(/^[-•*]\s*/, "")).filter(Boolean));
    else paragraphs.push(block);
  }
  return { heading, paragraphs, bullets };
}

function guideText(g: GuideContent) {
  return [g.title, g.intro, ...g.sections.map((s) => `${s.heading.toUpperCase()}\n\n${sectionText(s)}`)].filter(Boolean).join("\n\n");
}

function GuideView({ content, onSave, onDelete }: ViewProps<GuideContent>) {
  const { brand } = useBrand();
  const d = useDraft(content, onSave);
  // Section bodies are edited as text and parsed on save, so typing isn't reformatted under the cursor.
  const [bodies, setBodies] = useState<string[]>(() => content.sections.map(sectionText));
  useEffect(() => setBodies(content.sections.map(sectionText)), [content, d.editing]);

  const setSection = (i: number, heading: string, body: string) => {
    const next = [...bodies];
    next[i] = body;
    setBodies(next);
    d.setDraft({ ...d.draft, sections: d.draft.sections.map((s, j) => (j === i ? parseSectionText(heading, body) : s)) });
  };
  const removeSection = (i: number) => {
    setBodies(bodies.filter((_, j) => j !== i));
    d.setDraft({ ...d.draft, sections: d.draft.sections.filter((_, j) => j !== i) });
  };
  const addSection = () => {
    setBodies([...bodies, ""]);
    d.setDraft({ ...d.draft, sections: [...d.draft.sections, { heading: "New section", paragraphs: [], bullets: [] }] });
  };

  return (
    <div className="stack">
      <EditBar d={d} onDelete={onDelete}>
        <button className="primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <CopyButton text={() => guideText(content)} />
      </EditBar>
      {d.editing ? (
        <div className="panel stack">
          <label>
            <span>Title</span>
            <input value={d.draft.title} onChange={(e) => d.setDraft({ ...d.draft, title: e.target.value })} />
          </label>
          <label>
            <span>Introduction</span>
            <textarea rows={3} value={d.draft.intro} onChange={(e) => d.setDraft({ ...d.draft, intro: e.target.value })} />
          </label>
          <p className="small muted">In each section, leave a blank line between paragraphs and start bullet points with "- ".</p>
          {d.draft.sections.map((s, i) => (
            <div key={i} className="stack edit-block">
              <div className="row">
                <input style={{ flex: 1 }} value={s.heading} onChange={(e) => setSection(i, e.target.value, bodies[i] ?? "")} />
                <button className="danger" onClick={() => removeSection(i)}>
                  Remove
                </button>
              </div>
              <textarea rows={6} value={bodies[i] ?? ""} onChange={(e) => setSection(i, s.heading, e.target.value)} />
            </div>
          ))}
          <div>
            <button onClick={addSection}>Add section</button>
          </div>
        </div>
      ) : (
        <div className="paper-scroll">
          <GuidePaper brand={brand} content={content} />
        </div>
      )}
      <PrintOnly>
        <GuidePaper brand={brand} content={content} />
      </PrintOnly>
    </div>
  );
}

function PresentationView({ c, doc, content, onSave, onDelete }: ViewProps<PresentationContent> & { doc: PatientDocument }) {
  const { brand } = useBrand();
  const d = useDraft(content, onSave);
  const [presenting, setPresenting] = useState<number | null>(null);
  const images = doc.images ?? [];
  const imageUrl = (s: Slide) => {
    const img = s.imageIndex === null ? undefined : images[s.imageIndex];
    return img ? api.fileUrl(c.id, img.preview) : undefined;
  };
  const deck = d.editing ? d.draft : content;
  const script = () => deck.slides.map((s, i) => `Slide ${i + 1}: ${s.title}\n${s.script}`).join("\n\n");

  const setSlide = (i: number, patch: Partial<Slide>) =>
    d.setDraft({ ...d.draft, slides: d.draft.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveSlide = (i: number, by: number) => {
    const slides = [...d.draft.slides];
    const [s] = slides.splice(i, 1);
    slides.splice(i + by, 0, s);
    d.setDraft({ ...d.draft, slides });
  };

  return (
    <div className="stack">
      <EditBar d={d} onDelete={onDelete}>
        <button className="primary" onClick={() => setPresenting(0)}>
          Present
        </button>
        <CopyButton text={script} label="Copy script" />
        <button onClick={() => window.print()}>Print slides and script</button>
      </EditBar>
      <p className="small muted">
        Present opens the slides full screen for recording. Use the arrow keys to move between slides, N to show or hide your script, and
        Esc to finish.
      </p>

      {d.editing && (
        <label className="panel">
          <span>Deck title (shown on the cover slide)</span>
          <input value={d.draft.title} onChange={(e) => d.setDraft({ ...d.draft, title: e.target.value })} />
        </label>
      )}

      <div className="slide-list">
        <div className="slide-row">
          <CoverSlide brand={brand} title={deck.title} />
          <div className="small muted">Cover slide, added automatically from your practice settings.</div>
        </div>
        {deck.slides.map((s, i) => (
          <div key={i} className="slide-row">
            <button className="slide-thumb" onClick={() => setPresenting(i + 1)} title="Present from this slide">
              <SlideFrame brand={brand} slide={s} imageUrl={imageUrl(s)} number={i + 1} />
            </button>
            {d.editing ? (
              <div className="stack" style={{ gap: 8 }}>
                <input value={s.title} onChange={(e) => setSlide(i, { title: e.target.value })} />
                <label>
                  <span>Bullet points (one per line)</span>
                  <textarea
                    rows={4}
                    value={s.bullets.join("\n")}
                    onChange={(e) => setSlide(i, { bullets: e.target.value.split("\n") })}
                    onBlur={(e) => setSlide(i, { bullets: e.target.value.split("\n").map((b) => b.trim()).filter(Boolean) })}
                  />
                </label>
                <label>
                  <span>Script</span>
                  <textarea rows={5} value={s.script} onChange={(e) => setSlide(i, { script: e.target.value })} />
                </label>
                <label>
                  <span>Image</span>
                  <select
                    value={s.imageIndex ?? ""}
                    onChange={(e) => setSlide(i, { imageIndex: e.target.value === "" ? null : Number(e.target.value) })}
                  >
                    <option value="">No image</option>
                    {images.map((img, j) => (
                      <option key={j} value={j}>
                        {img.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="row">
                  <button disabled={i === 0} onClick={() => moveSlide(i, -1)}>
                    Move up
                  </button>
                  <button disabled={i === d.draft.slides.length - 1} onClick={() => moveSlide(i, 1)}>
                    Move down
                  </button>
                  <button className="danger" onClick={() => d.setDraft({ ...d.draft, slides: d.draft.slides.filter((_, j) => j !== i) })}>
                    Remove slide
                  </button>
                </div>
              </div>
            ) : (
              <div className="stack" style={{ gap: 4 }}>
                <strong className="small">Script</strong>
                <p className="small">{s.script}</p>
              </div>
            )}
          </div>
        ))}
        {d.editing && (
          <div>
            <button
              onClick={() =>
                d.setDraft({ ...d.draft, slides: [...d.draft.slides, { title: "New slide", bullets: [], script: "", imageIndex: null }] })
              }
            >
              Add slide
            </button>
          </div>
        )}
        <div className="slide-row">
          <EndSlide brand={brand} />
          <div className="small muted">Closing slide with your contact details.</div>
        </div>
      </div>

      {presenting !== null && (
        <SlideShow brand={brand} deck={content} imageUrl={imageUrl} start={presenting} onClose={() => setPresenting(null)} />
      )}

      <PrintOnly landscape>
        <div className="print-slide">
          <CoverSlide brand={brand} title={content.title} />
        </div>
        {content.slides.map((s, i) => (
          <div key={i} className="print-slide">
            <SlideFrame brand={brand} slide={s} imageUrl={imageUrl(s)} number={i + 1} />
            <p className="print-script">
              <strong>Script:</strong> {s.script}
            </p>
          </div>
        ))}
      </PrintOnly>
    </div>
  );
}

function SlideShow({
  brand,
  deck,
  imageUrl,
  start,
  onClose,
}: {
  brand: BrandSettings;
  deck: PresentationContent;
  imageUrl: (s: Slide) => string | undefined;
  start: number;
  onClose: () => void;
}) {
  const total = deck.slides.length + 2;
  const [i, setI] = useState(start);
  const [notes, setNotes] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onClose = () => close.current();
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) setI((n) => Math.min(total - 1, n + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) setI((n) => Math.max(0, n - 1));
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
    };
    const onFullscreen = () => !document.fullscreenElement && onClose();
    addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [total]);

  const slide = i >= 1 && i <= deck.slides.length ? deck.slides[i - 1] : null;
  return (
    <div className="slideshow" onClick={() => setI((n) => Math.min(total - 1, n + 1))}>
      <div className="slideshow-stage">
        {i === 0 ? (
          <CoverSlide brand={brand} title={deck.title} />
        ) : slide ? (
          <SlideFrame brand={brand} slide={slide} imageUrl={imageUrl(slide)} number={i} />
        ) : (
          <EndSlide brand={brand} />
        )}
      </div>
      {notes && (
        <div className="slideshow-notes" onClick={(e) => e.stopPropagation()}>
          <span className="small">
            {i + 1} / {total}
          </span>
          <p>{slide?.script ?? (i === 0 ? "Introduce yourself and what this video covers." : "Invite questions and explain how to book.")}</p>
        </div>
      )}
    </div>
  );
}
