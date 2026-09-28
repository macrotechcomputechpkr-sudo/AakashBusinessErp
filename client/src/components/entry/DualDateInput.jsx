// =============================================
// components/entry/DualDateInput.jsx
// A date field that works in English (AD) or Nepali (BS):
//   AD - the browser date field (type or pick), the BS date shown beside it
//   BS - type the Nepali date (2083-06-12, 2083.6.12 or 2083/06/12) or pick
//        it from the BS month calendar; the AD date is shown beside it
// The value is always the AD date (YYYY-MM-DD) - what the server stores.
// AD / BS is switched with the small button; the choice is remembered on
// this computer. The first time it follows System Control > Date In Entry.
// <DualDateInput value onChange disabled required defaultMode="english|nepali|dual" />
// =============================================
import React, { useEffect, useRef, useState } from 'react';
import { adToBs, bsToAd, bsAvailable } from '../../utils/bsCalendar';

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KEY = 'erp_date_mode';

export const bsText = ad => { const b = ad ? adToBs(String(ad).slice(0, 10)) : null; return b ? `${b.year}-${pad(b.month)}-${pad(b.day)}` : ''; };
/** "2083-06-12" / "2083.6.12" / "2083/06/12" -> AD "YYYY-MM-DD" (null when not a real BS date) */
export function parseBs(text) {
    const m = String(text || '').trim().match(/^(\d{4})[-./ ](\d{1,2})[-./ ](\d{1,2})$/);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 32) return null;
    const ad = bsToAd(y, mo, d);
    const back = ad && adToBs(ad);
    return back && back.year === y && back.month === mo && back.day === d ? ad : null;
}
const addDays = (ad, n) => { const [y, m, d] = ad.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) - Date.UTC(...a.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)))) / 86400000);
function monthDays(y, m) {
    const first = bsToAd(y, m, 1), next = m === 12 ? bsToAd(y + 1, 1, 1) : bsToAd(y, m + 1, 1);
    return first && next ? dayDiff(first, next) : 30;
}

function initialMode(defaultMode) {
    try { const v = localStorage.getItem(KEY); if (v === 'ad' || v === 'bs') return v; } catch { /* no storage */ }
    return defaultMode === 'nepali' ? 'bs' : 'ad';
}

export default function DualDateInput({ value, onChange, disabled, required, defaultMode, className = '', title }) {
    const canBs = bsAvailable();
    const [mode, setMode] = useState(() => (canBs ? initialMode(defaultMode) : 'ad'));
    const [text, setText] = useState(bsText(value));
    const [bad, setBad] = useState(false);
    const [open, setOpen] = useState(false);
    const wrap = useRef(null);
    useEffect(() => { setText(bsText(value)); setBad(false); }, [value]);
    useEffect(() => {
        if (!open) return undefined;
        const close = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    const cur = adToBs(value || new Date().toISOString().slice(0, 10)) || { year: 2083, month: 1, day: 1 };
    const [view, setView] = useState({ year: cur.year, month: cur.month });
    const switchMode = () => {
        const next = mode === 'ad' ? 'bs' : 'ad';
        setMode(next);
        try { localStorage.setItem(KEY, next); } catch { /* per-computer only */ }
    };
    const commit = () => {
        if (!text.trim()) { setBad(false); if (value) onChange(''); return; }
        const ad = parseBs(text);
        setBad(!ad);
        if (ad && ad !== value) onChange(ad);
    };
    const openCal = () => { setView({ year: cur.year, month: cur.month }); setOpen(o => !o); };
    const step = n => setView(v => { let m = v.month + n, y = v.year; if (m < 1) { m = 12; y -= 1; } if (m > 12) { m = 1; y += 1; } return { year: y, month: m }; });

    const toggle = canBs && (
        <button type="button" tabIndex={-1} className="nav-btn small" disabled={disabled} onClick={switchMode}
            title={mode === 'ad' ? 'Showing English (AD) - click for Nepali (BS)' : 'Showing Nepali (BS) - click for English (AD)'} style={{ minWidth: 34 }}>
            {mode === 'ad' ? 'AD' : 'BS'}
        </button>
    );

    if (mode === 'ad') {
        return (
            <div className={`flex items-center gap-1 min-w-0 ${className}`} title={title || (canBs && value ? `${bsText(value)} BS` : undefined)}>
                <input type="date" className="erp-input" style={{ minWidth: 130 }} value={value || ''} disabled={disabled} required={required} onChange={e => onChange(e.target.value)} />
                {toggle}
                {canBs && value && <span className="text-xs text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis min-w-0">{bsText(value)} BS</span>}
            </div>
        );
    }

    const first = bsToAd(view.year, view.month, 1);
    const lead = first ? new Date(`${first}T00:00:00`).getDay() : 0;
    const count = monthDays(view.year, view.month);
    return (
        <div ref={wrap} className={`relative flex items-center gap-1 min-w-0 ${className}`} title={title || (value ? `${value} AD` : undefined)}>
            <input className={`erp-input ${bad ? 'border-red-500' : ''}`} style={{ minWidth: 110 }} value={text} disabled={disabled} required={required} placeholder="YYYY-MM-DD (BS)"
                onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
            <button type="button" tabIndex={-1} className="nav-btn small" disabled={disabled} onClick={openCal} title="Pick the Nepali date">📅</button>
            {toggle}
            <span className={`text-xs whitespace-nowrap overflow-hidden text-ellipsis min-w-0 ${bad ? 'text-red-600' : 'text-gray-500'}`}>{bad ? 'Not a BS date' : value ? `${value} AD` : ''}</span>
            {open && (
                <div className="absolute z-50 top-full left-0 mt-1 bg-white border rounded shadow-lg p-2" style={{ width: 252 }}>
                    <div className="flex items-center justify-between mb-1 text-sm">
                        <button type="button" className="nav-btn small" onClick={() => step(-1)}>‹</button>
                        <span className="font-semibold">{MONTHS[view.month - 1]} {view.year}</span>
                        <button type="button" className="nav-btn small" onClick={() => step(1)}>›</button>
                    </div>
                    <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
                        {DAYS.map(d => <div key={d} className="text-gray-500 font-semibold">{d.slice(0, 2)}</div>)}
                        {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
                        {Array.from({ length: count }).map((_, i) => {
                            const ad = first ? addDays(first, i) : null;
                            const on = ad && ad === value;
                            return (
                                <button key={i} type="button" className={`py-1 rounded ${on ? 'bg-blue-600 text-white' : 'hover:bg-blue-100'}`}
                                    onClick={() => { if (ad) { onChange(ad); setOpen(false); } }}>{i + 1}</button>
                            );
                        })}
                    </div>
                    <div className="flex justify-between mt-1">
                        <button type="button" className="nav-btn small" onClick={() => { onChange(new Date().toISOString().slice(0, 10)); setOpen(false); }}>Today</button>
                        <button type="button" className="nav-btn small" onClick={() => setOpen(false)}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}
