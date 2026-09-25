// =============================================
// utils/billTextParser.js
// Turns the text of a supplier's bill (OCR of an image, or the text layer of
// a PDF - read in the browser with Tesseract.js / PDF.js, both free and
// bundled with the app) into the bill's parts. Plain rules, no outside
// service:
//   vendor name  - the first real line at the top (not "Tax Invoice" etc.)
//   PAN          - "PAN / VAT No: 601234567" (first = seller, the one on a
//                  buyer / customer line = buyer)
//   bill no      - "Invoice / Bill No: ..."
//   date         - YYYY-MM-DD / DD-MM-YYYY (/ . - separators); a year from
//                  2060 is Bikram Sambat
//   items        - lines ending in  qty [unit] rate [discount] amount  where
//                  qty x rate (- discount) = amount (checked, else marked)
//   totals       - Sub Total, Discount, Taxable, Non-taxable, VAT, Grand /
//                  Net Total; freight, round off ... as other charges
// Every value is shown on the review screen to be corrected, and the text
// itself can be edited and parsed again.
// =============================================

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const toNum = s => {
    if (s === undefined || s === null || s === '') return 0;
    const n = Number(String(s).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const NOT_NAME = /(tax\s*invoice|invoice|bill\b|abbreviated|estimate|quotation|challan|pan\b|vat\b|phone|tel\b|mobile|email|e-mail|www\.|address|date|miti|copy|original|duplicate|page\s*\d)/i;
const TOTAL_LINE = /(sub\s*-?\s*total|grand\s*total|net\s*(total|amount|payable)|total\s*(amount|payable)?\b|taxable|non[\s-]*taxable|exempt|vat\b|tax\s*amount|discount|round\s*off|rounding|freight|transport|cartage|insurance|in\s*words|amount\s*in\s*words|rupees)/i;
const HEADER_LINE = /(p\.?\s*a\.?\s*n\b|vat\s*(reg|no|number)|tpin|phone|tel\b|mobile|fax|invoice\s*no|bill\s*no|\bdate\b|miti|a\/c\s*no|account\s*no)/i;
const UNIT_WORD = /^(pcs?|pieces?|nos?\.?|no\.?|units?|ea|each|box(es)?|bx|ctns?|cartons?|cs|cases?|kgs?|kilo(gram)?s?|g|gms?|grams?|ltrs?|lt|l|litres?|liters?|ml|dz|doz(en)?|pkts?|packets?|packs?|pk|btls?|bottles?|bags?|sets?|m|mtrs?|meters?|metres?|rolls?|pair|prs?|jar|tin|can|sachet|strip|tab|cap|vial)$/i;

function lastNumber(line) {
    const all = line.match(new RegExp(NUM, 'g'));
    return all ? toNum(all[all.length - 1]) : 0;
}

function findPans(lines) {
    const out = [];
    lines.forEach((l, i) => {
        const re = /(?:P\.?\s*A\.?\s*N|VAT|TPIN|PAN\/VAT|VAT\/PAN)\s*(?:reg(?:istration)?\.?)?\s*(?:No\.?|Number|#)?\s*[:.\-]?\s*([0-9][0-9 \-]{6,14}[0-9])/ig;
        let m;
        while ((m = re.exec(l))) {
            const d = m[1].replace(/\D/g, '');
            if (d.length >= 9 && d.length <= 10) out.push({ pan: d.slice(0, 9), line: i, buyer: /(buyer|customer|purchaser|bill\s*to|sold\s*to|party|client)/i.test(l) || /(buyer|customer|purchaser)/i.test(lines[i - 1] || '') });
        }
    });
    return out;
}

function findDate(lines) {
    const pats = [
        { re: /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/, ymd: true },
        { re: /(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/, ymd: false }
    ];
    const ordered = [...lines.filter(l => /(date|miti|dated)/i.test(l)), ...lines];
    for (const l of ordered) {
        for (const p of pats) {
            const m = p.re.exec(l);
            if (!m) continue;
            const [y, mo, d] = p.ymd ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
            if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 32) continue;
            const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            return Number(y) >= 2060 || /(miti|b\.?s\.?)\b/i.test(l) ? { bs: iso, ad: '' } : { ad: iso, bs: '' };
        }
    }
    return { ad: '', bs: '' };
}

// One item line: [sn] description qty [unit] rate [discount] amount
function parseItemLine(raw) {
    const line = raw.replace(/\s+/g, ' ').replace(/\s*\|\s*/g, ' ').trim();
    if (!/[A-Za-zऀ-ॿ]{2,}/.test(line) || TOTAL_LINE.test(line) || HEADER_LINE.test(line)) return null;
    const tokens = line.split(' ');
    // numbers (and an optional unit word) from the end
    const tail = [];
    let i = tokens.length - 1;
    for (; i >= 0 && tail.length < 6; i--) {
        const t = tokens[i].replace(/^rs\.?/i, '');
        if (new RegExp(`^${NUM}$`).test(t)) tail.unshift({ n: toNum(t) });
        else if (/^\d+(\.\d+)?%$/.test(t)) tail.unshift({ n: toNum(t.slice(0, -1)) });        // discount %
        else if (UNIT_WORD.test(t.replace(/[.,]$/, '')) && tail.length >= 2) tail.unshift({ unit: t.replace(/[.,]$/, '') });
        else break;
    }
    const nums = tail.filter(x => 'n' in x).map(x => x.n);
    if (nums.length < 3) return null;
    let desc = tokens.slice(0, i + 1).join(' ');
    let sn = null;
    const snm = /^(\d{1,3})[.)]?\s+(.*)$/.exec(desc);
    if (snm && /[A-Za-z]/.test(snm[2])) { sn = Number(snm[1]); desc = snm[2]; }
    if (!/[A-Za-zऀ-ॿ]{2,}/.test(desc)) return null;
    const unit = (tail.find(x => x.unit) || {}).unit || '';
    // qty rate amount | qty rate disc amount | hs qty rate amount ...: pick the triple that multiplies out.
    const amount = nums[nums.length - 1];
    let best = null;
    for (let q = 0; q < nums.length - 1; q++) {
        for (let r = q + 1; r < nums.length - 1; r++) {
            const qty = nums[q], rate = nums[r];
            if (!(qty > 0) || !(rate > 0)) continue;
            const between = nums.slice(r + 1, nums.length - 1);
            const disc = between.length === 1 ? between[0] : 0;
            const gross = qty * rate;
            const ok = Math.abs(gross - amount) <= Math.max(1, amount * 0.01) ? 'exact'
                : disc && Math.abs(gross - disc - amount) <= Math.max(1, amount * 0.01) ? 'discount'
                    : disc && Math.abs(gross * (1 - disc / 100) - amount) <= Math.max(1, amount * 0.01) ? 'discount_pct' : null;
            if (ok) { best = { qty, rate, discount_amount: ok === 'discount' ? disc : ok === 'discount_pct' ? round2(gross - amount) : 0, checked: true, extra: nums.slice(0, q) }; break; }
        }
        if (best) break;
    }
    if (!best) {
        const qty = nums[nums.length - 3], rate = nums[nums.length - 2];
        best = { qty, rate, discount_amount: 0, checked: false, extra: nums.slice(0, nums.length - 3) };
    }
    const hs = best.extra.find(n => String(n).replace('.', '').length >= 4);
    return { sn, description: desc.replace(/[\s:;,.-]+$/, ''), product_code: '', hs_code: hs ? String(hs) : '', batch_no: '', qty: best.qty, free_qty: 0, unit,
        rate: best.rate, discount_amount: round2(best.discount_amount), amount: round2(amount), checked: best.checked };
}

function parseBillText(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\t/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
    const pans = findPans(lines);
    const seller = pans.find(p => !p.buyer) || pans[0];
    const buyer = pans.find(p => p !== seller && p.buyer) || pans.find(p => p !== seller);
    const nameLine = lines.slice(0, 8).find(l => /[A-Za-zऀ-ॿ]{3,}/.test(l) && !NOT_NAME.test(l) && l.length >= 3 && !/^\d/.test(l));
    const billNo = (() => {
        for (const l of lines) {
            const m = /(?:invoice|bill|inv|voucher)\.?\s*(?:no|number|#)\.?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-_.]*)/i.exec(l);
            if (m && /\d/.test(m[1])) return m[1].replace(/[.,]$/, '');
        }
        return '';
    })();
    const date = findDate(lines);

    const items = [], skipped = [];
    let inTotals = false;
    lines.forEach(l => {
        if (/(sub\s*-?\s*total|grand\s*total|net\s*amount|total\s*amount|taxable\s*amount)/i.test(l)) inTotals = true;
        if (inTotals) return;
        const it = parseItemLine(l);
        if (it) items.push(it);
        else if (/[A-Za-z]{3,}/.test(l) && (l.match(new RegExp(NUM, 'g')) || []).length >= 2 && !TOTAL_LINE.test(l)) skipped.push(l);
    });

    const pick = re => { const l = lines.find(x => re.test(x)); return l ? lastNumber(l) : 0; };
    const other = [];
    lines.forEach(l => {
        const m = /(freight|transport(ation)?|cartage|insurance|loading|packing|round\s*off|rounding)/i.exec(l);
        if (m) { const n = lastNumber(l); if (n) other.push({ name: m[1].replace(/\b\w/g, c => c.toUpperCase()), amount: /(less|deduct|\(-\)|-\s*\d)/i.test(l) ? -n : n }); }
    });
    const subtotal = pick(/sub\s*-?\s*total/i) || round2(items.reduce((s, x) => s + x.amount, 0));
    return {
        vendor_name: nameLine || '', vendor_pan: seller ? seller.pan : '', vendor_address: '', vendor_phone: '',
        buyer_name: '', buyer_pan: buyer ? buyer.pan : '',
        bill_no: billNo, bill_date_ad: date.ad, bill_date_bs: date.bs, currency: 'NPR',
        items, subtotal,
        discount_total: pick(/discount/i), taxable_amount: pick(/(?<!non[\s-]*)taxable/i), non_taxable_amount: pick(/non[\s-]*taxable|exempt/i),
        vat_amount: pick(/(vat|tax\s*amount)/i), other_charges: other,
        grand_total: pick(/(grand\s*total|net\s*(total|amount|payable)|total\s*payable|invoice\s*total)/i) || pick(/\btotal\b/i),
        notes: '', unread_lines: skipped.slice(0, 30)
    };
}

module.exports = { parseBillText, parseItemLine };
