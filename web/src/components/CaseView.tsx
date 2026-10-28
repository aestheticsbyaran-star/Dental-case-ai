import { useCallback, useEffect, useState } from "react";
import type { Case } from "../../../shared/types";
import { api } from "../lib/api";
import { DetailsForm } from "./DetailsForm";
import { RecordsPanel } from "./RecordsPanel";
import { AnalysisPanel } from "./AnalysisPanel";

type Tab = "details" | "records" | "analysis";

export function CaseView({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const [c, setCase] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("details");

  const reload = useCallback(async () => {
    try {
      setCase(await api.getCase(caseId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [caseId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) return <div className="error">{error}</div>;
  if (!c) return <p className="muted">Loading case…</p>;

  const remove = async () => {
    const typed = window.prompt?.(`Type the case reference "${c.details.reference}" to delete this case and all its files.`);
    if (typed !== c.details.reference) return;
    await api.deleteCase(c.id);
    onClose();
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button onClick={onClose}>← All cases</button>
          <h2 className="mono">{c.details.reference || "(no reference)"}</h2>
          {c.details.chiefComplaint && <span className="muted">{c.details.chiefComplaint}</span>}
        </div>
        <button className="danger" onClick={remove}>
          Delete case
        </button>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["details", "Details & notes"],
            ["records", `Records (${c.records.length})`],
            ["analysis", `Analysis (${c.analyses.length})`],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "details" && <DetailsForm c={c} onSaved={setCase} />}
      {tab === "records" && <RecordsPanel c={c} onChange={reload} />}
      {tab === "analysis" && <AnalysisPanel c={c} onChange={reload} />}
    </div>
  );
}
