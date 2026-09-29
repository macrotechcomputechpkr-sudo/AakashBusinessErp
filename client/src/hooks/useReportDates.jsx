// =============================================
// useReportDates.jsx - English / Nepali dates on every screen (Layout)
// 1. Picking: every plain date box (input type=date - report periods,
//    filters, masters …) gets a small "2083-06-13 BS" chip beside it. The
//    chip opens the Nepali (BS) calendar - type the BS date or click a day -
//    and fills the English box, so a date can be chosen either way. Boxes of
//    DualDateInput (entries) already do both and are left alone.
// 2. Showing: dates the screens write as "2026-09-29" follow System Control >
//    Date In Reports: English "2026-09-29", Nepali "2083-06-13", Dual
//    "2026-09-29 / 2083-06-13" (utils/dateSettings fmtDate). Only the text
//    on screen / in print changes; values, sorting keys and exports stay AD.
//    Text that already names its calendar (… BS, … AD) and [data-no-date]
//    areas are left as they are.
// =============================================
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BsCalendar } from '../components/entry/DualDateInput';
import { bsAvailable } from '../utils/bsCalendar';
import { loadDateSettings, onDateSettings, reportDateMode, bsOf, fmtDate } from '../utils/dateSettings';

// AD dates only (years 1990-2044), not a BS date (2045+), not the AD half of "AD / BS"
const DATE_RE = /\b(199\d|20[0-3]\d|204[0-4])-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b(?!\s*\/\s*\d{4}-)/g;
const TEXT_SKIP = 'input, textarea, select, option, script, style, svg, [contenteditable="true"], [data-no-date], .bsd-chip, .nav-titlebar';
const CHIP_SKIP = '[data-dual-date], [data-no-date], .sg-mount thead';

function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function useReportDates(ref, path, authFetch, tenantKey) {
    const [pick, setPick] = useState(null);
    const [mode, setMode] = useState(reportDateMode());
    useEffect(() => onDateSettings(s => setMode(s.reports)), []);
    useEffect(() => { if (authFetch) loadDateSettings(authFetch, tenantKey || 'x'); }, [authFetch, tenantKey]);

    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        const canBs = bsAvailable();
        const chips = new Map();
        const written = new WeakMap();
        let timer = null;
        const pendingNodes = new Set();

        // ---- 2. dates shown as text ----
        const convert = n => {
            if (mode === 'english' || !canBs) return;
            const t = n.nodeValue;
            if (!t || t.length > 500 || written.get(n) === t || /\b(BS|AD)\b/.test(t)) return;
            DATE_RE.lastIndex = 0;
            if (!DATE_RE.test(t)) return;
            const el = n.parentElement;
            if (!el || el.closest(TEXT_SKIP)) return;
            DATE_RE.lastIndex = 0;
            const out = t.replace(DATE_RE, m => fmtDate(m, mode));
            if (out !== t) { n.nodeValue = out; written.set(n, out); }
        };
        const walk = node => {
            if (node.nodeType === 3) { convert(node); return; }
            if (node.nodeType !== 1) return;
            const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            for (let n = w.nextNode(); n; n = w.nextNode()) convert(n);
        };

        // ---- 1. BS chip beside every date box ----
        const chipText = input => {
            const bs = input.value ? bsOf(input.value) : null;
            return bs ? `${bs} BS` : 'BS 📅';
        };
        const syncChip = (input, chip) => {
            const t = chipText(input);
            if (chip.textContent !== t) chip.textContent = t;
            chip.disabled = !!input.disabled || !!input.readOnly;
        };
        const addChips = () => {
            if (!canBs) return;
            chips.forEach((chip, input) => {
                if (!input.isConnected || chip.previousElementSibling !== input) { chip.remove(); chips.delete(input); }
            });
            root.querySelectorAll('input[type=date]').forEach(input => {
                if (chips.has(input) || input.closest(CHIP_SKIP)) return;
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.tabIndex = -1;
                chip.className = 'bsd-chip no-print';
                chip.setAttribute('data-enter-skip', '1');
                chip.title = 'Pick this date in Nepali (BS)';
                chip.addEventListener('click', e => {
                    e.preventDefault();
                    const r = chip.getBoundingClientRect();
                    setPick({ input, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
                });
                input.insertAdjacentElement('afterend', chip);
                chips.set(input, chip);
                syncChip(input, chip);
            });
        };

        const flush = () => {
            timer = null;
            addChips();
            pendingNodes.forEach(n => { if (n.isConnected) walk(n); });
            pendingNodes.clear();
            observer.takeRecords();
        };
        const observer = new MutationObserver(list => {
            list.forEach(m => {
                if (m.type === 'characterData') pendingNodes.add(m.target);
                else m.addedNodes.forEach(n => pendingNodes.add(n));
            });
            if (!timer) timer = setTimeout(flush, 120);
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        const onInput = e => { const chip = chips.get(e.target); if (chip) syncChip(e.target, chip); };
        root.addEventListener('input', onInput, true);
        root.addEventListener('change', onInput, true);
        // values set by the page itself (no event) - keep the chips right
        const tick = setInterval(() => chips.forEach((chip, input) => syncChip(input, chip)), 1000);
        addChips();
        walk(root);
        observer.takeRecords();
        return () => {
            observer.disconnect(); clearTimeout(timer); clearInterval(tick);
            root.removeEventListener('input', onInput, true);
            root.removeEventListener('change', onInput, true);
            chips.forEach(chip => chip.remove());
        };
    }, [ref, path, mode]);

    useEffect(() => { setPick(null); }, [path]);
    return [pick, setPick];
}

/** the BS calendar opened from a chip (rendered by Layout) */
export function ReportDatePopup({ pick, onClose }) {
    const box = useRef(null);
    useEffect(() => {
        if (!pick) return undefined;
        const close = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.bsd-chip')) onClose(); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [pick, onClose]);
    if (!pick) return null;
    const width = 252;
    const left = Math.max(8, Math.min(pick.rect.right - width, window.innerWidth - width - 8));
    const below = pick.rect.bottom + 330 < window.innerHeight;
    const style = { position: 'fixed', left, zIndex: 60, ...(below ? { top: pick.rect.bottom + 4 } : { bottom: window.innerHeight - pick.rect.top + 4 }) };
    return createPortal(
        <div ref={box} style={style} className="no-print">
            <BsCalendar value={pick.input.value} onPick={ad => { setNativeValue(pick.input, ad); onClose(); }} onClose={onClose} />
        </div>,
        document.body
    );
}
