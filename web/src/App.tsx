import { useCallback, useEffect, useState } from "react";
import { api, type CaseSummary, type Status } from "./lib/api";
import { CaseView } from "./components/CaseView";

function useHashCaseId(): [string | null, (id: string | null) => void] {
  const read = () => {
    const m = location.hash.match(/^#case-([a-f0-9-]{36})$/);
    return m ? m[1] : null;
  };
  const [id, setId] = useState(read);
  useEffect(() => {
    const onHash = () => setId(read());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((next: string | null) => {
    location.hash = next ? `case-${next}` : "";
  }, []);
  return [id, go];
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [caseId, openCase] = useHashCaseId();

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>
            <a href="#" style={{ color: "inherit", textDecoration: "none" }}>
              Case workspace
            </a>
          </h1>
          <small>personal tool · records stay on this computer</small>
        </div>
        <a className="small" href="/api/review-log.csv">
          Download review log (CSV)
        </a>
      </header>

      {status && !status.apiKeyConfigured && (
        <div className="banner">
          AI analysis is off because no Claude API key is set. Add <span className="mono">ANTHROPIC_API_KEY</span> to the{" "}
          <span className="mono">.env</span> file and restart. Records and measurements still work.
        </div>
      )}

      {caseId ? <CaseView caseId={caseId} onClose={() => openCase(null)} /> : <CaseList onOpen={openCase} />}
    </div>
  );
}

function CaseList({ onOpen }: { onOpen: (id: string) => void }) {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCases().then(setCases).catch((e) => setError(e.message));
  }, []);

  const create = async () => {
    try {
      const c = await api.createCase(reference.trim());
      onOpen(c.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <h2>New case</h2>
        <p className="muted small">
          Use a case reference, not the patient's name (for example your practice record number or "2026-014"). Names and
          dates of birth are never needed here.
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input
            id="new-case-ref"
            style={{ maxWidth: 280 }}
            placeholder="Case reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <button className="primary" type="submit" disabled={!reference.trim()}>
            Create case
          </button>
        </form>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="stack">
        <h2>Cases</h2>
        {cases === null && !error && <p className="muted">Loading cases…</p>}
        {cases?.length === 0 && <p className="muted">No cases yet. Create one above to start uploading records.</p>}
        <div className="case-list">
          {cases?.map((c) => (
            <button key={c.id} className="case-card" onClick={() => onOpen(c.id)}>
              <span className="ref">{c.reference || "(no reference)"}</span>
              <span>{c.chiefComplaint || <span className="muted">No chief complaint yet</span>}</span>
              <span className="muted small">
                {c.recordCount} records · {c.analysisCount} analyses · updated {new Date(c.updatedAt).toLocaleDateString("en-GB")}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
