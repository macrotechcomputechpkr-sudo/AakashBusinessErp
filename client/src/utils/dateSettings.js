// =============================================
// utils/dateSettings.js - the company's date settings (System Control)
//   Date In Entry   english | nepali | dual  (how dates are picked)
//   Date In Reports english | nepali | dual  (how dates are shown in reports)
// Loaded once per company by Layout (hooks/useReportDates) and read by
// formatDateForDisplay, the report date display and the date pickers.
// fmtDate() is the one formatter: English "2026-09-29", Nepali
// "2083-06-13", Dual "2026-09-29 / 2083-06-13".
// =============================================
import { adToBs } from './bsCalendar';

const MODES = ['english', 'nepali', 'dual'];
const state = { key: '', entry: 'dual', reports: 'dual', loaded: false };
const listeners = new Set();
const pad = n => String(n).padStart(2, '0');

export const dateSettings = () => state;
export const reportDateMode = () => state.reports;
export const entryDateMode = () => state.entry;
export const onDateSettings = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function setDateSettings(sc, key = state.key) {
    state.key = key;
    state.entry = MODES.includes(sc?.date_format_entry) ? sc.date_format_entry : 'dual';
    state.reports = MODES.includes(sc?.date_format_reports) ? sc.date_format_reports : 'dual';
    state.loaded = true;
    listeners.forEach(fn => fn(state));
}

let pending = null;
export function loadDateSettings(authFetch, key) {
    if (state.loaded && state.key === key) return Promise.resolve(state);
    if (!pending) {
        pending = authFetch('/api/system-control')
            .then(r => setDateSettings(r.data || {}, key))
            .catch(() => setDateSettings({}, key))
            .finally(() => { pending = null; });
    }
    return pending.then(() => state);
}
/** after System Control is saved */
export const clearDateSettings = () => { state.loaded = false; };

/** BS "2083-06-13" of an AD date (null when out of range) */
export function bsOf(ad) {
    const b = ad ? adToBs(String(ad).slice(0, 10)) : null;
    return b ? `${b.year}-${pad(b.month)}-${pad(b.day)}` : null;
}
/** an AD "YYYY-MM-DD" as the report setting (or the mode given) wants it */
export function fmtDate(ad, mode = state.reports) {
    if (!ad) return '';
    const iso = String(ad).slice(0, 10);
    if (mode === 'english') return iso;
    const bs = bsOf(iso);
    if (!bs) return iso;
    return mode === 'nepali' ? bs : `${iso} / ${bs}`;
}
