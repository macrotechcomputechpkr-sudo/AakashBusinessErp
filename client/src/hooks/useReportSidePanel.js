// =============================================
// useReportSidePanel.js - every report's options and filters in a side panel
// On a report screen (one with a Show / Run button, not an entry screen),
// once the report is on the screen its option / filter boxes step aside:
//   * a thin "⚙ Options & Filters" tab stays on the left edge;
//   * the tab opens them as a side panel (the page's own boxes, with their
//     values - nothing is copied); the page's Show / Run button in it is the
//     OK: pressing it runs the report and the panel hides again;
//   * ◀ Hide, Esc or a click beside the panel hides it without running.
// The report itself then keeps the whole screen with only its own tools
// (grid filter / columns / chart, 📁 Views, Save As …).
// Before the first report the boxes stay where the page draws them.
// How: the siblings above the report that hold the boxes and the run
// button get data-rsp-part; their parent gets data-rsp="closed" (parts
// hidden) or "open" (the parent becomes the fixed side panel showing only
// the parts) - index.css. The DOM is not moved, so React is not disturbed.
// Tick-box options: on every report screen a row of tick boxes (Show: …,
// Columns: …, Include …) is tagged data-rsp-optg - index.css lays it out as
// a box of equal columns with each option as a small box (ticked = blue).
// In the open panel each block is a titled box (Filters / Options) and the
// run button's block sits at the bottom.
// Screens with their own side panel (components/ReportSidePanel) are left alone.
// Mark an element data-rsp-keep to keep it in the report (SavedViewsBar),
// data-rsp-off on a container to opt a screen out.
// =============================================
import { useEffect } from 'react';
import { runButton } from './useCompactFilters';

const RESULT_SEL = 'table, .sg-mount, canvas, .recharts-wrapper, [data-rsp-result]';
const FIELD_SEL = '.erp-field, select, input:not([type=hidden]), button.erp-select, textarea';
const hasResult = el => Array.from(el.querySelectorAll(RESULT_SEL)).some(r => !r.closest('[role="dialog"], .fixed'))
    || (el.matches && el.matches(RESULT_SEL));
// the report is on the screen: a table with data rows, a grid or a chart
const shown = el => !!el.querySelector('.sg-mount, canvas, .recharts-wrapper, [data-rsp-result]')
    || Array.from(el.querySelectorAll('table')).some(t => !t.closest('[role="dialog"], .fixed') && Array.from(t.tBodies).some(b => Array.from(b.rows).some(r => r.cells.length > 1)));
const hasField = el => el.matches(FIELD_SEL) || !!el.querySelector(FIELD_SEL);
const isKeep = el => el.hasAttribute('data-rsp-keep') || el.matches('.erp-header, [class*="nav-"], [role="alert"]');

/** the parent holding the boxes and the report, and the boxes' siblings */
// report screens whose run button says Search / Apply / Refresh
const REPORT_PATH = /report|register|ledger|book|analysis|statement|summary|sheet|ageing|aging|outstanding|balance|vat|annex|history|profit|valuation|stock-|trial|cash-flow|variance|reco/i;
const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
function searchButton(root) {
    if (!REPORT_PATH.test(window.location.pathname)) return null;
    return Array.from(root.querySelectorAll('button')).find(b => !b.disabled && !b.closest('table, .sg-mount, [data-no-view], form, .rsp-panel, [role="dialog"]')
        && /(^|\s|🔍|▶)(search|apply|refresh)\b/i.test(txt(b))) || null;
}

// a row of tick boxes: only <label><input type=checkbox|radio> …</label> and caption text
const OPT_SKIP = 'table, .sg-mount, .rg-root, form, .ent-fillbar, [role="dialog"]:not(.rsp-panel), [data-rsp-ui]';
function tagOptions(root, on) {
    const groups = new Set();
    if (on) {
        root.querySelectorAll('input[type=checkbox], input[type=radio]').forEach(inp => {
            const lab = inp.closest('label');
            const box = lab && lab.parentElement;
            if (!box || groups.has(box) || lab.closest(OPT_SKIP) || box.hasAttribute('data-rsp-opts')) return;
            const kids = Array.from(box.children);
            const ticks = kids.filter(k => k.tagName === 'LABEL' && k.querySelector('input[type=checkbox], input[type=radio]'));
            const ok = ticks.length >= 2 && kids.every(k => k.tagName === 'LABEL' || (/^(SPAN|B|STRONG|SMALL|EM|P)$/.test(k.tagName) && !k.querySelector('input, select, button')));
            if (ok) groups.add(box);
        });
    }
    root.querySelectorAll('[data-rsp-optg]').forEach(b => { if (!groups.has(b)) b.removeAttribute('data-rsp-optg'); });
    groups.forEach(b => { if (!b.hasAttribute('data-rsp-optg')) b.setAttribute('data-rsp-optg', ''); });
}
const FIELD_ONLY = 'select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), button.erp-select, textarea, .erp-field';
const setAttr = (el, k, v) => { if (v === null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

function locate(root) {
    if (root.querySelector('.rsp-tab, .rsp-panel, .ent-fillbar, [data-rsp-off]')) return null;
    const btn = runButton(root) || searchButton(root);
    if (!btn) return null;
    let node = btn;
    while (node.parentElement && node.parentElement !== root && !hasResult(node.parentElement)) node = node.parentElement;
    const P = node.parentElement;
    if (!P || P === root || !hasResult(P) || hasResult(node) || !shown(P)) return null;
    const kids = Array.from(P.children);
    const bi = kids.indexOf(node);
    const part = k => !isKeep(k) && !hasResult(k) && hasField(k);
    const filler = k => !isKeep(k) && !hasResult(k) && !hasField(k) && !k.hasAttribute('data-rsp-ui');
    const grow = (i, step) => {
        let edge = i;
        for (let j = i + step; j >= 0 && j < kids.length; j += step) {
            if (part(kids[j])) edge = j;
            else if (!filler(kids[j])) break;
        }
        return edge;
    };
    const a = grow(bi, -1), b = grow(bi, 1);
    return { P, btn, parts: kids.slice(a, b + 1).filter(k => !k.hasAttribute('data-rsp-ui')) };
}

export default function useReportSidePanel(ref, path) {
    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        let timer = null, open = false, cur = null, closeTimer = null;
        const ui = {};
        const make = (cls, html, onClick) => {
            const el = document.createElement(cls === 'rsp-backdrop' ? 'div' : 'div');
            el.className = `${cls} no-print`;
            el.setAttribute('data-rsp-ui', '1');
            if (html) el.innerHTML = html;
            if (onClick) el.addEventListener('click', onClick);
            return el;
        };
        const setOpen = v => { open = v; apply(); };
        const ensureUi = () => {
            if (ui.tab) return;
            ui.tab = make('rsp-tab rsp-gtab', '<span>⚙ Options &amp; Filters</span>', () => setOpen(true));
            ui.tab.title = 'Change the report options / filters, then press Show';
            ui.backdrop = make('rsp-backdrop', '', () => setOpen(false));
            ui.bar = make('rsp-gbar', '<b>⚙ Options &amp; Filters</b><span class="rsp-hint">change, then press the Show button</span><button type="button" class="rsp-x">◀ Hide</button>');
            ui.bar.querySelector('button').addEventListener('click', () => setOpen(false));
            document.body.append(ui.tab, ui.backdrop, ui.bar);
        };
        const removeUi = () => { Object.values(ui).forEach(el => el.remove()); Object.keys(ui).forEach(k => delete ui[k]); };
        const clear = () => {
            root.querySelectorAll('[data-rsp-part], [data-rsp-run]').forEach(el => ['data-rsp-part', 'data-rsp-title', 'data-rsp-actions', 'data-rsp-run'].forEach(k => el.removeAttribute(k)));
            root.querySelectorAll('[data-rsp]').forEach(el => el.removeAttribute('data-rsp'));
        };
        function apply() {
            if (!cur) { clear(); removeUi(); return; }
            ensureUi();
            root.querySelectorAll('[data-rsp-part]').forEach(el => { if (!cur.parts.includes(el)) ['data-rsp-part', 'data-rsp-title', 'data-rsp-actions'].forEach(k => el.removeAttribute(k)); });
            root.querySelectorAll('[data-rsp]').forEach(el => { if (el !== cur.P) el.removeAttribute('data-rsp'); });
            cur.parts.forEach(el => {
                setAttr(el, 'data-rsp-part', '1');
                // box title in the panel; the run button's own block goes to the bottom
                const fields = el.matches(FIELD_ONLY) || !!el.querySelector(FIELD_ONLY);
                const ticks = !!el.querySelector('input[type=checkbox], input[type=radio]');
                setAttr(el, 'data-rsp-title', fields ? (ticks ? 'Filters & Options' : 'Filters') : ticks ? 'Options' : null);
                setAttr(el, 'data-rsp-actions', !fields && !ticks && el.contains(cur.btn) ? '1' : null);
            });
            root.querySelectorAll('[data-rsp-run]').forEach(b => { if (b !== cur.btn) b.removeAttribute('data-rsp-run'); });
            setAttr(cur.btn, 'data-rsp-run', '1');
            const state = open ? 'open' : 'closed';
            if (cur.P.getAttribute('data-rsp') !== state) cur.P.setAttribute('data-rsp', state);
            ui.tab.style.display = open ? 'none' : '';
            ui.backdrop.style.display = open ? '' : 'none';
            ui.bar.style.display = open ? '' : 'none';
        }
        const scan = () => {
            const report = !root.querySelector('.ent-fillbar, [data-rsp-off]')
                && !!(root.querySelector('.rsp-tab, .rsp-panel') || runButton(root) || searchButton(root));
            tagOptions(root, report);
            const next = locate(root);
            if (!next) { cur = null; open = false; apply(); return; }
            // a new report area (another screen / a redraw) starts folded
            if (!cur || cur.P !== next.P) open = false;
            cur = next;
            apply();
        };
        // the page's Show / Run in the open panel is the OK
        const onClick = e => {
            if (!open || !cur) return;
            const b = e.target.closest && e.target.closest('button');
            if (b && b === cur.btn) { clearTimeout(closeTimer); closeTimer = setTimeout(() => setOpen(false), 300); }
        };
        const onKey = e => { if (open && e.key === 'Escape') setOpen(false); };
        const observer = new MutationObserver(list => {
            if (list.every(m => m.type === 'attributes')) return;
            clearTimeout(timer);
            timer = setTimeout(scan, 200);
        });
        observer.observe(root, { childList: true, subtree: true });
        root.addEventListener('click', onClick, true);
        window.addEventListener('keydown', onKey);
        scan();
        return () => {
            observer.disconnect(); clearTimeout(timer); clearTimeout(closeTimer);
            root.removeEventListener('click', onClick, true);
            window.removeEventListener('keydown', onKey);
            clear(); removeUi(); tagOptions(root, false);
        };
    }, [ref, path]);
}
