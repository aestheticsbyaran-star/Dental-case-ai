# Dental case workspace

A personal tool for analysing dental cases in one place: case notes, clinical photos, radiographs (JPEG, PNG or DICOM) and intraoral scans (STL or PLY), with calibrated measuring tools and a Claude-assisted case analysis.

It runs on your own computer. Records are stored in a local folder and the app only listens on `127.0.0.1`, so nothing is reachable from the network. The only thing that leaves the computer is what is sent to the Claude API when you press **Analyse case** (see [What is sent to Claude](#what-is-sent-to-claude)).

> This is a clinical aid for the dentist's own use. It is not a medical device and its output is not a diagnosis. Every finding and option needs to be checked against the records by the treating clinician. Before anyone else uses it, get regulatory advice: supplying it to other clinicians would make you a medical device manufacturer under UK MDR 2002.

## Setup

You need [Node.js](https://nodejs.org) 20 or later and a Claude API key from [platform.claude.com](https://platform.claude.com). Use an organisation on Anthropic's commercial terms, not a consumer Claude account, for anything involving patient data.

```bash
git clone https://github.com/aestheticsbyaran-star/dental-case-ai.git
cd dental-case-ai
npm install
cp .env.example .env   # then paste your API key into .env
npm run dev
```

Open http://127.0.0.1:5173. Without an API key everything except the AI analysis still works.

Case files are saved in `./data` (change it with `DATA_DIR` in `.env`). Back that folder up, and keep it on an encrypted disk (FileVault on a Mac, BitLocker on Windows).

## How to use it

1. **Create a case** with a reference, not the patient's name.
2. **Details & notes**: chief complaint, goals, medical and dental history, examination findings.
3. **Records**: drop in files and set the type and view for each (bitewing, periapical, OPG, ceph, CBCT slice).
   - Photos are re-drawn in the browser, which removes EXIF metadata such as location and dates.
   - DICOM files are read in the browser. The pixel spacing is used for calibration and the header (including patient details) is discarded.
   - Scans are rendered from six angles so Claude can see them.
4. **Measure**: open a record and use the Ruler, Angle or Calibrate tools.
   - DICOM radiographs with pixel spacing are calibrated automatically.
   - For JPEG or PNG images, calibrate by drawing a line over something of known length (an implant, a crown width, a ruler in a photo). Uncalibrated distances stay in pixels.
   - Scan measurements are in millimetres directly from the 3D model.
   - Add the FDI tooth number to each measurement so the analysis can use it.
5. **Analysis**: optionally ask a specific question, then **Analyse case**. The result shows a case summary, findings by tooth (each marked as coming from your measurements, your notes, or the AI's own visual impression), treatment options with pros and cons, risks, missing information and next steps.
6. **Review**: record whether you agreed and what you actually planned. **Download review log (CSV)** exports this across all cases, building a record of how the AI compares with your decisions.

## What is sent to Claude

For records ticked **Include in AI analysis**:

- the de-identified preview images (photos, rendered radiographs, six scan views), up to 24 per analysis
- the case reference, age, sex and the text fields from Details & notes
- your measurements, with units and calibration source
- your question

Original DICOM headers, file metadata and the original files themselves are not sent. Keep names, dates of birth and addresses out of the text fields.

The app uses the `claude-opus-5-5` model. Claude is instructed to only quote measurements you made, to label its own image reading as a visual impression, and not to give millimetre values from images itself.

## Current limits

- DICOM: uncompressed and baseline-JPEG files. Other compressions (JPEG 2000, JPEG-LS) need exporting as JPEG or PNG for now.
- CBCT: a multi-frame file shows its middle slice only. Full 3D CBCT viewing and segmentation is the next major step.
- Scans: STL and PLY. Scan views are fixed angles because scanners use different orientations.
- Documents (PDF) are stored but not sent to Claude; paste the relevant text into the notes.

## Development

```bash
npm run typecheck   # TypeScript
npm test            # unit tests (measurement maths, DICOM windowing, analysis prompt)
npm run build       # production build into dist/
npm start           # serve the built app and API on http://127.0.0.1:8787
```

`node tests/fixtures/make-fixtures.mjs <dir>` writes synthetic test files (a DICOM radiograph, an STL and a PNG) with no real patient data.

Layout:

- `server/` local API (Express): file storage in `store.ts`, the Claude request in `analyse.ts`
- `web/src/` React app: viewers and measuring tools in `components/`, DICOM reading and preview generation in `lib/`
- `shared/types.ts` data types used by both
