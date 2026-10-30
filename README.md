# Dental case workspace

A personal tool for analysing dental cases in one place: case notes, clinical photos, radiographs (JPEG, PNG or DICOM), intraoral scans (STL or PLY) and CBCT scans (a folder of DICOM slices), with calibrated measuring tools and a Claude-assisted case analysis.

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
   - **CBCT**: use **choose a CBCT folder** (or drop the folder) to upload a whole export at once. The slices are read in the browser, ordered by their position, and stacked into one 3D volume. Only the voxels and voxel size are kept; the DICOM headers are dropped. Overview images (front and side projections plus three key slices) are made for Claude.
4. **Measure**: open a record and use the Ruler, Angle or Calibrate tools.
   - DICOM radiographs with pixel spacing are calibrated automatically.
   - For JPEG or PNG images, calibrate by drawing a line over something of known length (an implant, a crown width, a ruler in a photo). Uncalibrated distances stay in pixels.
   - Scan measurements are in millimetres directly from the 3D model.
   - CBCT opens in axial, coronal and sagittal views. Scroll to move through slices, click to line the other views up on a point, and switch contrast presets. Measurements are in mm on any view. **Send to AI** adds the slice you're looking at (with its measurements drawn on) to the images Claude sees, with an optional note such as "36 implant site".
   - Add the FDI tooth number to each measurement so the analysis can use it.
5. **Analysis**: optionally ask a specific question, then **Analyse case**. The result shows a case summary, findings by tooth (each marked as coming from your measurements, your notes, or the AI's own visual impression), treatment options with pros and cons, risks, missing information and next steps.
6. **Review**: record whether you agreed and what you actually planned. **Download review log (CSV)** exports this across all cases, building a record of how the AI compares with your decisions.

7. **Documents**: once you've written your final plan in the review, the Documents tab writes, from the analysis and your plan:
   - a **treatment plan letter** on your letterhead (type the patient's name when printing; it is never saved)
   - a **records note** to paste into your practice software
   - a **treatment plan guide** for the patient to take home
   - a **patient presentation**: branded slides using the patient's own photos and radiographs, with a script for each slide. **Present** shows them full screen for screen-recording a video (arrow keys to move, N for your script, Esc to finish).

   Add fees or anything to mention in the box before writing. Every document can be edited, printed or saved as a PDF, and copied as text. **Copy analysis as text** on the Analysis tab copies the analysis itself.

## Branding

**Practice settings** (top right) sets the name, qualifications, GDC number, practice details, logo and brand colour used across the app, letters, guides and slides, plus notes on your writing style (you can paste an example letter with patient details removed). These are stored in `data/settings.json` and `data/brand/`.

## What is sent to Claude

For records ticked **Include in AI analysis**:

- the de-identified preview images (photos, rendered radiographs, six scan views, CBCT overviews and the CBCT slices you chose), scaled to at most 2576 px (the most Claude reads), up to 100 per analysis. If a case has more, every record still sends its first image, photos and radiographs come next, and extra scan and CBCT views are left out first; the analysis shows how many were left out
- the case reference, age, sex and the text fields from Details & notes
- your measurements, with units and calibration source
- your question

When writing a document, only text is sent: the case details, your measurements, the analysis, your final plan, your instructions, your practice name and writing style, and for presentations the captions of the case images (not the images).

Original DICOM headers, file metadata and the original files themselves are not sent. Keep names, dates of birth and addresses out of the text fields.

The app uses the `claude-opus-5-5` model. Claude is instructed to only quote measurements you made, to label its own image reading as a visual impression, and not to give millimetre values from images itself.

## Current limits

- DICOM: uncompressed, baseline JPEG (2D only) and JPEG lossless. JPEG 2000 and JPEG-LS need exporting uncompressed for now.
- CBCT: slices are assumed to be axial (the usual export). Very large scans (over about 300 million voxels) are halved in resolution. There is no automatic segmentation or nerve tracing yet; all measurements are yours.
- CBCT grey values are not true Hounsfield units, so contrast presets are relative to each scan.
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
