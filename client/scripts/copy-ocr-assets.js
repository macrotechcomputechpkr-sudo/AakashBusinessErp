// =============================================
// scripts/copy-ocr-assets.js
// Purchase Bill Import reads bills in the browser with Tesseract.js (OCR)
// and PDF.js - both free / open source (Apache-2.0). Their worker, WASM
// core and English language data are copied from node_modules into
// public/ocr/ so the app serves them itself: no CDN, no internet, no key.
// Runs on npm install / start / build; public/ocr/ is git-ignored.
// =============================================
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'public', 'ocr');
const from = (pkg, file, base = __dirname) => {
    try { return path.join(path.dirname(require.resolve(`${pkg}/package.json`, { paths: [base] })), file); } catch { return null; }
};
const copy = (src, dest) => {
    if (!src || !fs.existsSync(src)) { console.warn(`[ocr assets] missing ${src || dest} - run npm install in client/`); return false; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
};

const tesseractDir = from('tesseract.js', '.');
let ok = true;
ok = copy(from('tesseract.js', 'dist/worker.min.js'), path.join(out, 'worker.min.js')) && ok;
// every core variant - Tesseract.js picks the one the browser supports (SIMD, relaxed SIMD, plain)
const coreDir = tesseractDir && from('tesseract.js-core', '.', tesseractDir);
if (coreDir && fs.existsSync(coreDir)) {
    fs.readdirSync(coreDir).filter(f => /^tesseract-core.*\.wasm\.js$/.test(f)).forEach(f => { ok = copy(path.join(coreDir, f), path.join(out, 'core', f)) && ok; });
} else { console.warn('[ocr assets] tesseract.js-core not found'); ok = false; }
// English, "best_int" model: accurate and small (about 3 MB)
ok = copy(from('@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz'), path.join(out, 'lang', 'eng.traineddata.gz')) && ok;
ok = copy(from('pdfjs-dist', 'legacy/build/pdf.worker.min.js'), path.join(out, 'pdf.worker.min.js')) && ok;
console.log(ok ? `[ocr assets] ready in ${path.relative(process.cwd(), out) || out}` : '[ocr assets] some files are missing - Purchase Bill Import will not read bills until they are there');
