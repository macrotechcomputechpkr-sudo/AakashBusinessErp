// =============================================
// utils/bankStatement.js
// Reads a bank statement file in the browser and turns it into
// transaction lines { txn_date, value_date, description, ref_no,
// withdrawal, deposit, balance } - free, nothing leaves the browser until
// the user imports it.
//   .xlsx                     read-excel-file (MIT)
//   .csv / .txt / .tsv        built-in parser (comma, semicolon, tab, pipe)
//   .xls saved as HTML / text many banks' "Excel" download is really an HTML
//                             table or tab-separated text - both handled; a
//                             true old binary .xls must be re-saved as .xlsx
// The header row and the meaning of each column are detected from the
// column titles (Date, Particulars, Cheque No, Withdrawal / Debit,
// Deposit / Credit, Amount + Dr/Cr, Balance ...) and can be changed on
// screen. Dates: Excel serials, YYYY-MM-DD, DD/MM/YYYY (or MM/DD - decided
// from the data), DD-MMM-YYYY, and Bikram Sambat (year 2060+) converted to AD.
// =============================================

export const FIELDS = [
    { key: 'date', label: 'Txn Date', required: true }, { key: 'value_date', label: 'Value Date' }, { key: 'description', label: 'Description' },
    { key: 'ref_no', label: 'Cheque / Ref No' }, { key: 'withdrawal', label: 'Withdrawal (Dr)' }, { key: 'deposit', label: 'Deposit (Cr)' },
    { key: 'amount', label: 'Amount (single column)' }, { key: 'drcr', label: 'Dr / Cr indicator' }, { key: 'balance', label: 'Balance' }
];
const MATCHERS = {
    value_date: /value\s*date/i,
    date: /(^|\b)(txn|tran|trans|transaction|posting|post|book(ing)?)?\s*\.?\s*date\b|^date$|^miti$|मिति/i,
    description: /desc|particular|narration|remark|detail|information|विवरण/i,
    ref_no: /ch(e)?q(ue)?|instrument|ref(erence)?\b|ref\s*no|voucher|txn\s*id|transaction\s*id/i,
    withdrawal: /withdraw|debit|\bdr\b|paid\s*out|payments?$|money\s*out|निकासी|खर्च/i,
    deposit: /deposit|credit|\bcr\b|paid\s*in|receipts?$|money\s*in|जम्मा/i,
    amount: /^\s*(txn\s*|transaction\s*)?(amount|amt)\s*$/i,
    drcr: /dr\s*[/-]?\s*cr|cr\s*[/-]?\s*dr|^type$|txn\s*type|debit\s*\/\s*credit/i,
    balance: /balance|\bbal\b|मौज्दात/i
};

// ---------- text formats
export function parseDelimited(text) {
    const t = String(text || '').replace(/^﻿/, '');
    const sample = t.split(/\r?\n/).slice(0, 20).join('\n');
    const delim = [',', ';', '\t', '|'].map(d => [d, (sample.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (q) {
            if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === delim) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
}
export function parseHtmlTables(html, DOMParserImpl = typeof DOMParser !== 'undefined' ? DOMParser : null) {
    if (!DOMParserImpl) return [];
    const doc = new DOMParserImpl().parseFromString(html, 'text/html');
    const rows = [];
    doc.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('th,td')].flatMap(td => { const v = td.textContent.replace(/\s+/g, ' ').trim(); const span = Number(td.getAttribute('colspan')) || 1; return [v, ...Array(Math.min(span, 20) - 1).fill('')]; });
        if (cells.some(x => x !== '')) rows.push(cells);
    });
    return rows;
}

export async function readStatementFile(file, { readSheet } = {}) {
    const name = (file.name || '').toLowerCase();
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b;                    // xlsx
    const isOle = head[0] === 0xd0 && head[1] === 0xcf;                    // old binary xls
    if (isZip || name.endsWith('.xlsx')) {
        const rs = readSheet || (await import('read-excel-file/browser')).readSheet;
        return (await rs(file)).map(r => r.map(v => (v === null || v === undefined ? '' : v)));
    }
    if (isOle) throw new Error('This is an old binary .xls file. Open it in Excel / LibreOffice and save it as .xlsx or .csv, then upload again.');
    const text = await file.text();
    if (/^\s*</.test(text) && /<t[dr][\s>]/i.test(text)) return parseHtmlTables(text);
    return parseDelimited(text);
}

// ---------- header + columns
export function detectColumns(rows) {
    let best = { index: -1, score: 0, map: {} };
    rows.slice(0, 40).forEach((r, i) => {
        const map = {};
        let score = 0;
        r.forEach((cell, ci) => {
            const v = String(cell || '').trim();
            if (!v || v.length > 40) return;
            for (const key of ['value_date', 'date', 'drcr', 'balance', 'withdrawal', 'deposit', 'amount', 'ref_no', 'description']) {
                if (map[key] === undefined && MATCHERS[key].test(v)) {
                    if (key === 'date' && MATCHERS.value_date.test(v)) continue;
                    if ((key === 'withdrawal' || key === 'deposit') && MATCHERS.drcr.test(v)) continue;
                    if (key === 'ref_no' && /date/i.test(v)) continue;
                    map[key] = ci; score += key === 'date' || key === 'balance' ? 2 : 1;
                    break;
                }
            }
        });
        if (map.date !== undefined && (map.withdrawal !== undefined || map.deposit !== undefined || map.amount !== undefined) && score > best.score) best = { index: i, score, map };
    });
    return { headerIndex: best.index, mapping: best.map };
}

// ---------- values
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const validYmd = (y, m, d) => y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 32;
export function parseAmount(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim();
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
    s = s.replace(/[^\d.]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
// raw date parts: [a, b, c, kind] kind = 'ymd' | 'ambiguous' | 'dmy-text'
function dateParts(v) {
    if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate(), kind: 'exact' };
    if (typeof v === 'number' && v > 20000 && v < 80000) {                    // Excel serial
        const dt = new Date(Math.round((v - 25569) * 86400000));
        return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), kind: 'exact' };
    }
    const s = String(v || '').trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (m) return { y: +m[1], m: +m[2], d: +m[3], kind: 'ymd' };
    m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})/.exec(s);
    const mon = m ? MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)] : null;
    if (mon) return { y: fixYear(+m[3]), m: mon, d: +m[1], kind: 'exact' };
    m = /^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{2,4})/.exec(s);
    if (m && MONTHS[m[1].toLowerCase().slice(0, 3)]) return { y: fixYear(+m[3]), m: MONTHS[m[1].toLowerCase().slice(0, 3)], d: +m[2], kind: 'exact' };
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
    if (m) return { a: +m[1], b: +m[2], y: fixYear(+m[3]), kind: 'ambiguous' };
    return null;
}
const fixYear = y => (y < 100 ? (y >= 60 ? 1900 + y : 2000 + y) : y);
// Decide DD/MM vs MM/DD from the whole column.
export function guessDayFirst(values) {
    let dayFirst = 0, monthFirst = 0;
    values.forEach(v => { const p = dateParts(v); if (p && p.kind === 'ambiguous') { if (p.a > 12) dayFirst++; if (p.b > 12) monthFirst++; } });
    return monthFirst > dayFirst ? false : true;
}
export function parseDate(v, { dayFirst = true, bsToAd = null } = {}) {
    const p = dateParts(v);
    if (!p) return null;
    let y, m, d;
    if (p.kind === 'ambiguous') { y = p.y; [d, m] = dayFirst ? [p.a, p.b] : [p.b, p.a]; } else ({ y, m, d } = p);
    if (y >= 2060 && y <= 2200) {                                        // Bikram Sambat
        if (!bsToAd) return null;
        const ad = bsToAd(y, m, d);
        if (!ad) return null;
        return typeof ad === 'string' ? ad.slice(0, 10) : `${ad.getFullYear()}-${pad(ad.getMonth() + 1)}-${pad(ad.getDate())}`;
    }
    return validYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// rows + header + mapping -> lines (and the rows that could not be read)
export function toLines(rows, headerIndex, mapping, { dayFirst = null, bsToAd = null, drcrDebitWord = /^(dr|d|debit|withdraw)/i } = {}) {
    const body = rows.slice(headerIndex + 1);
    const col = k => (mapping[k] === undefined || mapping[k] === '' || mapping[k] === null ? null : Number(mapping[k]));
    const dateCol = col('date');
    const df = dayFirst === null ? guessDayFirst(body.map(r => r[dateCol])) : dayFirst;
    const lines = [], skipped = [];
    body.forEach((r, i) => {
        const get = k => (col(k) === null ? '' : r[col(k)]);
        const txn = parseDate(get('date'), { dayFirst: df, bsToAd });
        if (!txn) {
            const text = r.filter(x => x !== '' && x !== null).join(' ');
            if (text && !/opening|closing|total|balance\s*b\/?f|brought|carried/i.test(text)) skipped.push({ row: headerIndex + 2 + i, text: text.slice(0, 120) });
            return;
        }
        let w = 0, dep = 0;
        if (col('withdrawal') !== null || col('deposit') !== null) {
            w = Math.abs(parseAmount(get('withdrawal'))); dep = Math.abs(parseAmount(get('deposit')));
            // one column used for both with a sign
            if (col('withdrawal') === col('deposit')) { const a = parseAmount(get('withdrawal')); w = a < 0 ? -a : 0; dep = a > 0 ? a : 0; }
        } else if (col('amount') !== null) {
            const a = parseAmount(get('amount'));
            const ind = String(get('drcr') || '').trim();
            if (ind) { if (drcrDebitWord.test(ind)) w = Math.abs(a); else dep = Math.abs(a); } else if (a < 0) w = -a; else dep = a;
        }
        if (!w && !dep) return;
        const bal = col('balance') === null ? null : String(get('balance')).trim() === '' ? null : (() => {
            const raw = get('balance');
            const n = parseAmount(raw);
            return /dr\b|od/i.test(String(raw)) && n > 0 ? -n : n;
        })();
        lines.push({ txn_date: txn, value_date: parseDate(get('value_date'), { dayFirst: df, bsToAd }) || null, description: String(get('description') || '').trim(),
            ref_no: String(get('ref_no') || '').trim(), withdrawal: Math.round(w * 100) / 100, deposit: Math.round(dep * 100) / 100, balance: bal });
    });
    return { lines, skipped, dayFirst: df };
}
