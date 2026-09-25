// =============================================
// utils/bsCalendar.js  (server)
// Accurate Bikram Sambat <-> AD conversion via the `nepali-date-converter`
// npm package (official BS month tables), wrapped so that:
//   * the rest of the code never touches the package API directly;
//   * on load it SELF-CHECKS against a known anchor (BS 2000-01-01 =
//     AD 1943-04-14) and detects whether the package counts months from
//     0 or 1 - so a different package version cannot silently shift dates;
//   * if the package is missing or fails the check, callers fall back to
//     the old approximate converter and `status()` says so.
// All AD values are plain 'YYYY-MM-DD' strings (no timezone shifts).
// =============================================

let NepaliDate = null, monthBase = null, reason = 'not loaded';

const pad = n => String(n).padStart(2, '0');
const adStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const localDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };

function readBs(nd) {
    // Support both API shapes seen across versions.
    const bs = typeof nd.getBS === 'function' ? nd.getBS() : { year: nd.getYear(), month: nd.getMonth(), date: nd.getDate() };
    return { year: Number(bs.year), month: Number(bs.month), day: Number(bs.date ?? bs.day) };
}
function readAd(nd) {
    const js = typeof nd.toJsDate === 'function' ? nd.toJsDate() : null;
    if (js) return adStr(js.getFullYear(), js.getMonth() + 1, js.getDate());
    const ad = nd.getAD();
    return adStr(ad.year, Number(ad.month) + 1, ad.date);
}

try {
    const mod = require('nepali-date-converter');
    const Cls = mod && (mod.default || mod.NepaliDate || mod);
    // Anchor: AD 1943-04-14 is BS 2000 Baishakh 1.
    const probe = readBs(new Cls(localDate('1943-04-14')));
    if (probe.year !== 2000 || probe.day !== 1 || ![0, 1].includes(probe.month)) {
        reason = `self-check failed: 1943-04-14 gave ${JSON.stringify(probe)}`;
    } else {
        monthBase = probe.month; // 0 => package months are 0-11
        const back = readAd(new Cls(2000, monthBase, 1));
        if (back !== '1943-04-14') reason = `self-check failed: BS 2000-01-01 gave AD ${back}`;
        else { NepaliDate = Cls; reason = 'ok'; }
    }
} catch (e) {
    reason = `package not installed (${e.code || e.message})`;
}

const available = () => !!NepaliDate;

// 'YYYY-MM-DD' (AD) -> { year, month (1-12), day } in BS, or null.
function adToBs(ad) {
    if (!NepaliDate || !ad) return null;
    try {
        const bs = readBs(new NepaliDate(localDate(ad)));
        return { year: bs.year, month: bs.month - monthBase + 1, day: bs.day };
    } catch { return null; }
}

// BS year, month (1-12), day -> 'YYYY-MM-DD' (AD), or null.
function bsToAd(year, month, day) {
    if (!NepaliDate) return null;
    try { return readAd(new NepaliDate(Number(year), Number(month) - 1 + monthBase, Number(day))); } catch { return null; }
}

function status() { return { accurate: available(), source: available() ? 'nepali-date-converter' : 'approximate built-in', reason }; }

module.exports = { available, adToBs, bsToAd, status };
