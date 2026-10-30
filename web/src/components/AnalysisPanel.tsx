import { useEffect, useState } from "react";
import type { Analysis, AnalysisReview, Case, FindingBasis, ReviewVerdict } from "../../../shared/types";
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

export function AnalysisPanel({ c, onChange }: { c: Case; onChange: () => void }) {
  const [question, setQuestion] = useState("");
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
      const a = await api.analyse(c.id, question);
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
        <div className="row">
          <button className="primary" onClick={run} disabled={running}>
            {running ? "Analysing…" : "Analyse case"}
          </button>
          {running && (
            <span className="row small muted">
              <span className="spinner" /> This usually takes 30 to 90 seconds.
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

      {selected && <AnalysisView key={selected.id} caseId={c.id} a={selected} onChange={onChange} />}
    </div>
  );
}

function AnalysisView({ caseId, a, onChange }: { caseId: string; a: Analysis; onChange: () => void }) {
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
            {new Date(a.createdAt).toLocaleString("en-GB")} · {a.inputSummary.imageCount} images
            {a.inputSummary.omittedImageCount ? ` (${a.inputSummary.omittedImageCount} left out)` : ""} · {a.inputSummary.measurementCount} measurements
          </span>
        </div>
        <p>{o.caseSummary}</p>
        <p className="small muted">AI-generated for your review. Check every finding against the records before relying on it.</p>
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
              <List title="Advantages" items={t.advantages} />
              <List title="Disadvantages" items={t.disadvantages} />
              <List title="Before starting" items={t.prerequisites} />
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

      <ReviewForm caseId={caseId} a={a} onChange={onChange} />
    </div>
  );
}

function List({ title, items }: { title?: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      {title && <strong className="small">{title}</strong>}
      <ul className="small">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
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
