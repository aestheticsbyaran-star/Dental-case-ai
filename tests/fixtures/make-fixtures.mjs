// Generates small synthetic test files: a 16-bit DICOM radiograph, a binary STL and a PNG photo.
// No real patient data. Run: node tests/fixtures/make-fixtures.mjs <outDir>
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";

const out = process.argv[2] ?? "tests/fixtures/out";
mkdirSync(out, { recursive: true });

// --- DICOM (explicit VR little endian) ---
function el(group, element, vr, value) {
  const long = ["OB", "OW", "UN", "SQ", "UT"].includes(vr);
  const header = Buffer.alloc(long ? 12 : 8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(element, 2);
  header.write(vr, 4, "ascii");
  let data = Buffer.isBuffer(value) ? value : null;
  if (!data) {
    if (vr === "US") { data = Buffer.alloc(2); data.writeUInt16LE(value); }
    else { data = Buffer.from(String(value), "ascii"); if (data.length % 2) data = Buffer.concat([data, Buffer.from(vr === "UI" ? "\0" : " ")]); }
  }
  if (long) header.writeUInt32LE(data.length, 8); else header.writeUInt16LE(data.length, 6);
  return Buffer.concat([header, data]);
}
const W = 320, H = 240;
const pixels = Buffer.alloc(W * H * 2);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let v = 400 + x * 4;                                  // gradient
  if (x > 100 && x < 160 && y > 60 && y < 200) v = 3000; // bright "tooth"
  pixels.writeUInt16LE(v, (y * W + x) * 2);
}
const metaBody = Buffer.concat([
  el(0x0002, 0x0001, "OB", Buffer.from([0, 1])),
  el(0x0002, 0x0002, "UI", "1.2.840.10008.5.1.4.1.1.1.3"),
  el(0x0002, 0x0003, "UI", "1.2.3.4.5"),
  el(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"),
]);
const metaLen = Buffer.alloc(4); metaLen.writeUInt32LE(metaBody.length);
const dicom = Buffer.concat([
  Buffer.alloc(128), Buffer.from("DICM"),
]);
const groupLen = Buffer.concat([Buffer.from([0x02, 0x00, 0x00, 0x00]), Buffer.from("UL"), Buffer.from([4, 0]), metaLen]);
const body = Buffer.concat([
  el(0x0008, 0x0060, "CS", "IO"),
  el(0x0010, 0x0010, "PN", "TEST^SHOULDNOTLEAVE"),
  el(0x0028, 0x0002, "US", 1),
  el(0x0028, 0x0004, "CS", "MONOCHROME2"),
  el(0x0028, 0x0010, "US", H),
  el(0x0028, 0x0011, "US", W),
  el(0x0028, 0x0030, "DS", "0.1\\0.1"),
  el(0x0028, 0x0100, "US", 16),
  el(0x0028, 0x0101, "US", 12),
  el(0x0028, 0x0102, "US", 11),
  el(0x0028, 0x0103, "US", 0),
  el(0x7fe0, 0x0010, "OW", pixels),
]);
writeFileSync(path.join(out, "sample-pa.dcm"), Buffer.concat([dicom, groupLen, metaBody, body]));

// --- CBCT series: one file per axial slice, no extensions, like many CBCT exports ---
// A U-shaped arch of dense "teeth" on a bone block, with a low-density canal on the right side.
const CW = 160, CH = 140, CZ = 100, VOX = 0.3;
const cbctDir = path.join(out, "sample-cbct");
mkdirSync(cbctDir, { recursive: true });
for (let z = 0; z < CZ; z++) {
  const px = Buffer.alloc(CW * CH * 2);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    let v = 0; // air (stored value; rescale intercept -1000 makes it -1000)
    const dx = (x - 80) / 60, dy = (y - 30) / 80;
    const r = Math.hypot(dx, dy);
    const onArch = y >= 30 && r > 0.75 && r < 1.0;
    if (onArch && z < 60) v = 1800;                                  // bone
    if (onArch && z >= 40 && z < 85 && Math.floor(Math.atan2(dy, dx) * 9) % 2 === 0) v = 3200; // teeth
    if (onArch && z < 40 && Math.hypot(x - 128, y - 75) < 3) v = 1000; // canal, on the patient's left
    px.writeUInt16LE(v, (y * CW + x) * 2);
  }
  const slice = Buffer.concat([
    el(0x0008, 0x0060, "CS", "CT"),
    el(0x0010, 0x0010, "PN", "TEST^SHOULDNOTLEAVE"),
    el(0x0018, 0x0050, "DS", String(VOX)),
    el(0x0020, 0x000e, "UI", "1.2.826.0.1.999.1"),
    el(0x0020, 0x0013, "IS", String(z + 1)),
    el(0x0020, 0x0032, "DS", `0\\0\\${(z * VOX).toFixed(2)}`),
    el(0x0020, 0x0037, "DS", "1\\0\\0\\0\\1\\0"),
    el(0x0028, 0x0002, "US", 1),
    el(0x0028, 0x0004, "CS", "MONOCHROME2"),
    el(0x0028, 0x0010, "US", CH),
    el(0x0028, 0x0011, "US", CW),
    el(0x0028, 0x0030, "DS", `${VOX}\\${VOX}`),
    el(0x0028, 0x0100, "US", 16),
    el(0x0028, 0x0101, "US", 12),
    el(0x0028, 0x0102, "US", 11),
    el(0x0028, 0x0103, "US", 0),
    el(0x0028, 0x1052, "DS", "-1000"),
    el(0x0028, 0x1053, "DS", "1"),
    el(0x7fe0, 0x0010, "OW", px),
  ]);
  // Shuffle the file names so the order has to come from slice positions.
  const name = `IM${String((z * 37) % CZ).padStart(4, "0")}`;
  writeFileSync(path.join(cbctDir, name), Buffer.concat([dicom, groupLen, metaBody, slice]));
}
writeFileSync(path.join(cbctDir, "DICOMDIR"), "not a slice");

// --- Binary STL: a 10 x 8 x 6 mm box ---
const v = [[0,0,0],[10,0,0],[10,8,0],[0,8,0],[0,0,6],[10,0,6],[10,8,6],[0,8,6]];
const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const stl = Buffer.alloc(84 + faces.length * 50);
stl.writeUInt32LE(faces.length, 80);
faces.forEach((f, i) => {
  const o = 84 + i * 50;
  f.forEach((vi, j) => v[vi].forEach((c, k) => stl.writeFloatLE(c, o + 12 + j * 12 + k * 4)));
});
writeFileSync(path.join(out, "sample-scan.stl"), stl);

// --- PNG photo (solid colour with a band) ---
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const PW = 400, PH = 300; const raw = Buffer.alloc((PW * 3 + 1) * PH);
for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const o = y * (PW * 3 + 1) + 1 + x * 3; const band = y > 120 && y < 180; raw[o] = band ? 240 : 180; raw[o + 1] = band ? 235 : 90; raw[o + 2] = band ? 220 : 100; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(PW, 0); ihdr.writeUInt32BE(PH, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(path.join(out, "sample-photo.png"), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(`Fixtures written to ${out}`);
