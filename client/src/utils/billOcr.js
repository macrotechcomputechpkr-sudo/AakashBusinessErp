// =============================================
// utils/billOcr.js
// Reads the text of a supplier's bill in the browser - free and offline:
//   image (JPG / PNG / WEBP)  -> Tesseract.js OCR
//   PDF with a text layer     -> PDF.js text, rebuilt line by line
//   scanned PDF (no text)     -> each page drawn by PDF.js, then OCR
// Tesseract's worker, WASM core and English data and the PDF.js worker are
// served by the app itself from /ocr/ (client/scripts/copy-ocr-assets.js).
// The text goes to the server, which picks out the bill's parts
// (server/utils/billTextParser.js).
// =============================================

const MAX_PAGES = 5;
const base = () => `${window.location.origin}${process.env.PUBLIC_URL || ''}/ocr`;

// PDF.js text items -> lines (same baseline = same line, left to right).
export function pdfItemsToLines(items) {
    const rows = [];
    items.filter(it => it.str && it.str.trim()).forEach(it => {
        const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 8;
        let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, h * 0.4));
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x, w: it.width || 0, s: it.str });
    });
    return rows.sort((a, b) => b.y - a.y).map(r => {
        const parts = r.parts.sort((a, b) => a.x - b.x);
        let line = '', end = null;
        parts.forEach(p => { line += (end !== null && p.x - end > 1 ? '  ' : '') + p.s; end = p.x + p.w; });
        return line.replace(/\s+$/, '');
    }).join('\n');
}

// Clean a page before OCR: at least ~2000 px wide, black on white (Otsu
// threshold), and the long straight lines of table borders erased - grid
// lines otherwise break the rows apart.
export function cleanForOcr(source) {
    const w0 = source.naturalWidth || source.videoWidth || source.width, h0 = source.naturalHeight || source.videoHeight || source.height;
    const scale = Math.min(3, Math.max(1, 2000 / w0));
    const W = Math.round(w0 * scale), H = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(source, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const gray = new Uint8Array(W * H), hist = new Array(256).fill(0);
    for (let i = 0; i < W * H; i++) { const g = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; gray[i] = g; hist[g]++; }
    // Otsu
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 160;
    for (let i = 0; i < 256; i++) {
        wB += hist[i]; if (!wB) continue; const wF = W * H - wB; if (!wF) break;
        sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; thr = i; }
    }
    const dark = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) dark[i] = gray[i] <= thr ? 1 : 0;
    // erase runs of dark pixels much longer than any character stroke
    const minRun = Math.round(Math.max(W, H) * 0.06), erase = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0, run = 0; x <= W; x++) {
        if (x < W && dark[y * W + x]) { run++; continue; }
        if (run >= minRun) for (let k = x - run; k < x; k++) erase[y * W + k] = 1;
        run = 0;
    }
    for (let x = 0; x < W; x++) for (let y = 0, run = 0; y <= H; y++) {
        if (y < H && dark[y * W + x]) { run++; continue; }
        if (run >= minRun * 0.6) for (let k = y - run; k < y; k++) erase[k * W + x] = 1;
        run = 0;
    }
    for (let i = 0; i < W * H; i++) {
        const v = dark[i] && !erase[i] ? 0 : 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}
const loadImage = file => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
});

// The core, with the two libraries passed in (the app loads them lazily).
export async function readBillTextWith(file, { Tesseract, pdfjs }, onProgress = () => {}, opts = {}) {
    const psm = opts.layout === 'auto' ? '3' : '6';          // 6 = uniform block: keeps table rows together
    let worker = null;
    const ocr = async (image, label) => {
        if (!worker) {
            onProgress({ status: 'Loading OCR', progress: 0 });
            worker = await Tesseract.createWorker('eng', 1, {
                workerPath: `${base()}/worker.min.js`, corePath: `${base()}/core`, langPath: `${base()}/lang`,
                logger: m => onProgress({ status: `${label}: ${m.status}`, progress: m.progress || 0 })
            });
            await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
        }
        const { data } = await worker.recognize(opts.clean === false ? image : cleanForOcr(image));
        return data.text || '';
    };
    try {
        if (file.type === 'application/pdf') {
            pdfjs.GlobalWorkerOptions.workerSrc = `${base()}/pdf.worker.min.js`;
            const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
            const pages = Math.min(doc.numPages, MAX_PAGES);
            const texts = [];
            let scanned = 0;
            for (let n = 1; n <= pages; n++) {
                onProgress({ status: `Reading page ${n} of ${pages}`, progress: (n - 1) / pages });
                const page = await doc.getPage(n);
                const tc = await page.getTextContent();
                const text = pdfItemsToLines(tc.items);
                if (text.replace(/\s/g, '').length >= 30) { texts.push(text); continue; }
                // no text layer - draw the page and OCR it
                const viewport = page.getViewport({ scale: 2.5 });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                texts.push(await ocr(canvas, `Page ${n}`));
                scanned++;
            }
            return { text: texts.join('\n'), source: scanned ? (scanned === pages ? 'pdf_ocr' : 'pdf_mixed') : 'pdf_text', pages, total_pages: doc.numPages };
        }
        return { text: await ocr(await loadImage(file), 'Image'), source: 'image_ocr', pages: 1, total_pages: 1 };
    } finally {
        if (worker) await worker.terminate();
    }
}

export async function readBillText(file, onProgress, opts) {
    const [Tesseract, pdfjs] = await Promise.all([import('tesseract.js'), import('pdfjs-dist/legacy/build/pdf')]);
    return readBillTextWith(file, { Tesseract: Tesseract.default || Tesseract, pdfjs }, onProgress, opts);
}
