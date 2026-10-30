import { useEffect, useState } from "react";
import { ANALYSIS_MODELS, type Analysis, type AnalysisModel, type AnalysisReview, type Case, type FindingBasis, type ReviewVerdict } from "../../../shared/types";
import { analysisText } from "../lib/analysisText";
import { MAX_IMAGES } from "../../../shared/imageBudget";
import { api } from "../lib/api";

const BASIS_LABEL: Record<FindingBasis, { text: string; cls: string }> = {
  "clinician-measurement": { text: "your measurement", cls: "ok" },
  "clinician-notes": { text: "your notes", cls: "" },
  "visual-impression": { text: "AI visual impression", cls: "warn" },
};

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  pending: "Not reviewed",
  agreed: "Agreed",
  "partly-agreed": "Partly agreed",
  disagreed: "Disagreed",
};

export function AnalysisPanel({ c, onChange, onWriteDocuments }: { c: Case; onChange: () => void; onWriteDocuments: () => void }) {
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState<AnalysisModel>(() => {
    try {
      const saved = localStorage.getItem("analysisModel");
      if (saved && saved in ANALYSIS_MODELS) return saved as AnalysisModel;
    } catch {}
    return "claude-opus-5-5";
  });
  const chooseModel = (m: AnalysisModel) => {
    setModel(m);
    try {
      localStorage.setItem("analysisModel", m);
    } catch {}
  };
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(c.analyses[0]?.id ?? null);

  const included = c.records.filter((r) => r.includeInAnalysis);
  const totalImages = included.reduce((n, r) => n + r.previews.length, 0);
  const imageCount = Math.min(totalImages, MAX_IMAGES);
  const measurementCount = included.reduce((n, r) => n + r.measurements.length, 0);
  const selected = c.analyses.find((a) => a.id === selectedId) ?? c.analyses[0];

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const a = await api.analyse(c.id, question, model);
      if (a.status === "failed") setError(a.error ?? "The analysis failed.");
      setSelectedId(a.id);
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
        <h2>Ask for an analysis</h2>
        <p className="small muted">
          Sends the case details, your measurements and {imageCount} de-identified image{imageCount === 1 ? "" : "s"} from{" "}
          {included.length} record{included.length === 1 ? "" : "s"} ({measurementCount} measurement{measurementCount === 1 ? "" : "s"}) to Claude.
          Choose which records to include on the Records tab. The case reference is sent; names are never stored here.
        </p>
        {totalImages > MAX_IMAGES && (
          <p className="small warn">
            These records have {totalImages} images, more than the {MAX_IMAGES} per analysis. Every record still sends its first image, and photos and
            radiographs come before extra scan and CBCT views. Untick records you don't need to keep the rest.
          </p>
        )}
        <label>
          <span>Anything specific? (optional)</span>
          <textarea
            id="question"
            rows={2}
            placeholder="e.g. Is 36 suitable for an immediate implant, and what are the alternatives if not?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <label>
          <span>Model</span>
          <select value={model} onChange={(e) => chooseModel(e.target.value as AnalysisModel)}>
            {Object.entries(ANALYSIS_MODELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button className="primary" onClick={run} disabled={running}>
            {running ? "Analysing…" : "Analyse case"}
          </button>
          {running && (
            <span className="row small muted">
              <span className="spinner" /> A full work-up usually takes 2 to 6 minutes.
            </span>
          )}
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      {c.analyses.length > 1 && (
        <section className="stack" style={{ gap: 6 }}>
          <h3>Previous analyses</h3>
          <div className="history">
            {c.analyses.map((a) => (
              <button key={a.id} className={a.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(a.id)}>
                <span>
                  {new Date(a.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  {a.question && <span className="muted"> · {a.question.slice(0, 60)}</span>}
                </span>
                <span className="small">{a.status === "failed" ? "Failed" : VERDICT_LABEL[a.review.verdict]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && <AnalysisView key={selected.id} c={c} a={selected} onChange={onChange} onWriteDocuments={onWriteDocuments} />}
    </div>
  );
}

function AnalysisView({ c, a, onChange, onWriteDocuments }: { c: Case; a: Analysis; onChange: () => void; onWriteDocuments: () => void }) {
  const [copied, setCopied] = useState(false);
  if (a.status === "failed" || !a.output) {
    return <div className="error">This analysis failed: {a.error}</div>;
  }
  const o = a.output;
  return (
    <div className="analysis">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Case summary</h2>
          <span className="small muted">
            {new Date(a.createdAt).toLocaleString("en-GB")} · {ANALYSIS_MODELS[a.model as AnalysisModel] ? ANALYSIS_MODELS[a.model as AnalysisModel].split(" (")[0] : a.model} · {a.inputSummary.imageCount} images
            {a.inputSummary.omittedImageCount ? ` (${a.inputSummary.omittedImageCount} left out)` : ""} · {a.inputSummary.measurementCount} measurements
          </span>
        </div>
        <p>{o.caseSummary}</p>
        <p className="small muted">AI-generated for your review. Check every finding against the records before relying on it.</p>
        <div className="row">
          <button
            onClick={() =>
              navigator.clipboard.writeText(analysisText(c, a)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            {copied ? "Copied" : "Copy analysis as text"}
          </button>
          <button onClick={onWriteDocuments}>Write letters, notes and presentations →</button>
        </div>
      </section>

      {o.risksAndFlags.length > 0 && (
        <section className="panel stack" style={{ borderColor: "var(--risk)" }}>
          <h3>Risks and flags</h3>
          <ul>
            {o.risksAndFlags.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
      )}

      {o.diagnoses && o.diagnoses.length > 0 && (
        <section className="panel stack">
          <h3>Working diagnoses</h3>
          <ul>
            {o.diagnoses.map((d, i) => (
              <li key={i}>
                <strong>{d.diagnosis}</strong>
                {d.teeth && <span className="mono"> ({d.teeth})</span>}. {d.rationale}
                {d.differentials.length > 0 && <span className="small muted"> Rule out: {d.differentials.join("; ")}.</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.assessments && o.assessments.length > 0 && (
        <section className="panel stack">
          <h3>Assessment by area</h3>
          <dl className="assessments">
            {o.assessments.map((x, i) => (
              <div key={i}>
                <dt>{x.area}</dt>
                <dd>{x.assessment}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {o.recordReviews && o.recordReviews.length > 0 && (
        <section className="panel stack">
          <h3>Record by record</h3>
          {o.recordReviews.map((r, i) => (
            <div key={i}>
              <strong>{r.record}</strong>
              <List items={r.observations} />
            </div>
          ))}
        </section>
      )}

      {o.toothChart && o.toothChart.length > 0 && (
        <section className="panel stack">
          <h3>Tooth chart</h3>
          <div className="table-wrap">
            <table className="findings">
              <thead>
                <tr>
                  <th>Tooth</th>
                  <th>Status</th>
                  <th>Prognosis</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {o.toothChart.map((t, i) => (
                  <tr key={i}>
                    <td className="mono">{t.tooth}</td>
                    <td>{t.status}</td>
                    <td className="small">{t.prognosis}</td>
                    <td className="small">{t.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel stack">
        <h3>Findings</h3>
        <div className="table-wrap">
          <table className="findings">
            <thead>
              <tr>
                <th>Tooth</th>
                <th>Finding</th>
                <th>Based on</th>
                <th>Source</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {o.findings.map((f, i) => (
                <tr key={i}>
                  <td className="mono">{f.tooth ?? "–"}</td>
                  <td>{f.finding}</td>
                  <td>
                    <span className={`badge ${BASIS_LABEL[f.basis].cls}`}>{BASIS_LABEL[f.basis].text}</span>
                  </td>
                  <td className="small">{f.source}</td>
                  <td className="small">{f.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        <h3>Treatment options</h3>
        <div className="options">
          {o.treatmentOptions.map((t, i) => (
            <article key={i} className="option panel">
              <h3>
                {String.fromCharCode(65 + i)}. {t.title}
              </h3>
              <p>{t.description}</p>
              {t.addresses.length > 0 && <p className="small muted">Addresses: {t.addresses.join("; ")}</p>}
              {t.sequence && t.sequence.length > 0 && <List title="Sequence" items={t.sequence} ordered />}
              <List title="Advantages" items={t.advantages} />
              <List title="Disadvantages" items={t.disadvantages} />
              <List title="Before starting" items={t.prerequisites} />
              {t.prognosis && (
                <p className="small">
                  <strong>Prognosis:</strong> {t.prognosis}
                </p>
              )}
              {t.maintenance && (
                <p className="small">
                  <strong>Maintenance:</strong> {t.maintenance}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      <div className="form-grid">
        <section className="panel stack">
          <h3>Missing information</h3>
          <List items={o.missingInformation} />
        </section>
        <section className="panel stack">
          <h3>Suggested next steps</h3>
          <List items={o.suggestedNextSteps} />
        </section>
      </div>

      <ReviewForm caseId={c.id} a={a} onChange={onChange} />
    </div>
  );
}

function List({ title, items, ordered }: { title?: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const Tag = ordered ? "ol" : "ul";
  return (
    <div>
      {title && <strong className="small">{title}</strong>}
      <Tag className="small">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </Tag>
    </div>
  );
}

function ReviewForm({ caseId, a, onChange }: { caseId: string; a: Analysis; onChange: () => void }) {
  const [review, setReview] = useState<AnalysisReview>(a.review);
  const [saved, setSaved] = useState(false);
  useEffect(() => setReview(a.review), [a.review]);

  const save = async () => {
    await api.saveReview(caseId, a.id, review);
    setSaved(true);
    onChange();
  };

  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3>Your review</h3>
      <p className="small muted">
        Recording what you actually decided builds a log of where the AI helps and where it doesn't. That log is the evidence you
        would need if this ever becomes a product.
      </p>
      <div className="row">
        {(["agreed", "partly-agreed", "disagreed"] as ReviewVerdict[]).map((v) => (
          <button
            type="button"
            key={v}
            className={review.verdict === v ? "active" : ""}
            onClick={() => {
              setReview({ ...review, verdict: v });
              setSaved(false);
            }}
          >
            {VERDICT_LABEL[v]}
          </button>
        ))}
      </div>
      <label>
        <span>Your final plan</span>
        <textarea
          id="final-plan"
          rows={3}
          value={review.finalPlan}
          onChange={(e) => {
            setReview({ ...review, finalPlan: e.target.value });
            setSaved(false);
          }}
        />
      </label>
      <label>
        <span>What the AI got wrong or missed</span>
        <textarea
          id="review-comments"
          rows={2}
          value={review.comments}
          onChange={(e) => {
            setReview({ ...review, comments: e.target.value });
            setSaved(false);
          }}
        />
      </label>
      <div className="row">
        <button className="primary" type="submit">
          Save review
        </button>
        {saved && <span className="small muted">Saved</span>}
      </div>
    </form>
  );
}
