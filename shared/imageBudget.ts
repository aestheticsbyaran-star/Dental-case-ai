// Chooses which preview images go to Claude when a case has more than the per-analysis limit.
// Used by the server to build the request and by the web app to say what will be sent.
import type { CaseRecord } from "./types";

/** Images per analysis. The API takes up to 600; this keeps the cost of one analysis to about £1.50 at most. */
export const MAX_IMAGES = 100;

/** The first five CBCT previews are the automatic overviews; later ones were added by hand. */
export const CBCT_OVERVIEW_COUNT = 5;

export interface ImageChoice {
  recordIndex: number;
  previewIndex: number;
}

function tier(r: CaseRecord, i: number): number {
  if (i === 0) return 0;
  if (r.kind === "photo" || r.kind === "radiograph" || r.kind === "dicom") return 1;
  if (r.kind === "cbct" && i >= CBCT_OVERVIEW_COUNT) return 1;
  return 2;
}

/**
 * Every record gets its first image, then photos, radiographs and hand-picked CBCT views,
 * then the remaining scan and CBCT overview images shared out evenly between records.
 * Returned in record order so images stay grouped by record.
 */
export function selectImages(records: CaseRecord[], max = MAX_IMAGES): ImageChoice[] {
  const all = records.flatMap((r, recordIndex) =>
    r.previews.map((_, previewIndex) => ({ recordIndex, previewIndex, tier: tier(r, previewIndex) })),
  );
  const chosen = [...all]
    .sort((a, b) => a.tier - b.tier || a.previewIndex - b.previewIndex || a.recordIndex - b.recordIndex)
    .slice(0, max);
  return chosen
    .sort((a, b) => a.recordIndex - b.recordIndex || a.previewIndex - b.previewIndex)
    .map(({ recordIndex, previewIndex }) => ({ recordIndex, previewIndex }));
}
