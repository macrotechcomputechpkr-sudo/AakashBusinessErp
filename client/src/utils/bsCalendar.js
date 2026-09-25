// =============================================
// utils/bsCalendar.js  (frontend)
// Browser twin of server/utils/bsCalendar.js: accurate BS dates from the
// `nepali-date-converter` package, self-checked on load against a known
// anchor (BS 2000-01-01 = AD 1943-04-14), with 0-/1-based month detection.
// If the check fails, available() is false and callers use the old
// approximation instead of showing silently shifted dates.
// =============================================
import NepaliDateLib from 'nepali-date-converter';

let NepaliDate = null, monthBase = null, reason = 'not loaded';
const pad = n => String(n).padStart(2, '0');
const adStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const localDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const readBs = nd => { const bs = typeof nd.getBS === 'function' ? nd.getBS() : { year: nd.getYear(), month: nd.getMonth(), date: nd.getDate() }; return { year: Number(bs.year), month: Number(bs.month), day: Number(bs.date ?? bs.day) }; };
const readAd = nd => { const js = typeof nd.toJsDate === 'function' ? nd.toJsDate() : null; if (js) return adStr(js.getFullYear(), js.getMonth() + 1, js.getDate()); const ad = nd.getAD(); return adStr(ad.year, Number(ad.month) + 1, ad.date); };

try {
    const Cls = (NepaliDateLib && (NepaliDateLib.default || NepaliDateLib.NepaliDate)) || NepaliDateLib;
    const probe = readBs(new Cls(localDate('1943-04-14')));
    if (probe.year !== 2000 || probe.day !== 1 || ![0, 1].includes(probe.month)) reason = 'self-check failed';
    else {
        monthBase = probe.month;
        if (readAd(new Cls(2000, monthBase, 1)) !== '1943-04-14') reason = 'self-check failed (reverse)';
        else { NepaliDate = Cls; reason = 'ok'; }
    }
} catch (e) { reason = `unavailable: ${e.message}`; }

if (!NepaliDate && typeof console !== 'undefined') console.warn(`[bsCalendar] Using approximate BS dates - ${reason}`);

export const bsAvailable = () => !!NepaliDate;
export const bsStatus = () => ({ accurate: !!NepaliDate, reason });
export function adToBs(ad) {
    if (!NepaliDate || !ad) return null;
    try { const bs = readBs(new NepaliDate(localDate(ad))); return { year: bs.year, month: bs.month - monthBase + 1, day: bs.day }; } catch { return null; }
}
export function bsToAd(year, month, day) {
    if (!NepaliDate) return null;
    try { return readAd(new NepaliDate(Number(year), Number(month) - 1 + monthBase, Number(day))); } catch { return null; }
}
