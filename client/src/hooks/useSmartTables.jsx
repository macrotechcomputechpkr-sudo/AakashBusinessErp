// =============================================
// useSmartTables.jsx - ▦ Grid view on EVERY plain report table
// Every report inside <Layout> gets, above each of its tables, a switch:
//   ▦ Grid    the report's rows in ReportGrid (components/ReportGrid.jsx):
//             search, AutoFilter row, filter builder, ▾ value filters,
//             drag-to-group with sub-totals, Group & Sort manager, footer
//             aggregates, data bars, added columns, 📊 chart + pivot, CSV,
//             print, keyboard navigation, right-click column menu
//   📄 Report the report exactly as the page draws it (and prints it)
// without rewriting the ~120 report pages.
//
// How: the same tables as the ▾ header filter (hooks/useExcelTableFilters
// reportTables: a header, one cell per column, no entry inputs) with at
// least 2 data rows. extractTable() reads the table:
//   * column captions (grouped headers become "Sales › Taxable")
//   * data rows - number columns are read as numbers ("1,234.50 Cr" = -1234.5)
//     for sort / filter / totals and still show as the report wrote them
//   * heading rows (one caption spanning the row, e.g. "Sundry Debtors")
//     become a "Section" column - the grid groups by it, so sub-totals come back
//   * total / opening / closing rows stay pinned above / under the rows
//   * sub-total rows between the rows are left out (the grid makes its own)
// Clicking a link / button in a grid cell clicks the same one in the report
// (drill-down, open voucher, print …); clicking a row of a clickable report
// row clicks that row. Tables with such structure rows or tick boxes open in
// 📄 Report first, and so do tables of 1-2 rows; simple lists open in ▦ Grid. The choice is kept per report
// (localStorage "sg_mode:<path>:<columns>") and in 📁 Views.
// When the page redraws the table (new dates, Show again) the grid reads it
// again and keeps its own layout (storageKey per report + columns).
// Print (Ctrl+P / 🖨 of the page) prints the report, not the grid.
// Opt out: data-no-excel or data-no-smart on the table or a parent.
// =============================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReportGrid from '../components/ReportGrid';
import { reportTables } from './useExcelTableFilters';
import { toNum } from '../components/grid/gridAnalysis';

const TOTAL_RE = /^(grand\s+|sub[\s-]?|net\s+)?total\b|^totals?\s*:|\btotals?$|^(opening|closing)(\s+balance)?\b|^balance\s*(b\/?f|c\/?f|brought|carried)|^net\s+(profit|loss|balance)\b/i;
const AMOUNT_RE = /amount|amt|total|value|net|gross|debit|credit|\bdr\b|\bcr\b|balance|sales|purchase|vat|tax|qty|quantity|paid|due|payable|receivable|profit|loss|cost|income|expense|discount|excise|tds|receipt|payment/i;
// numbers that are names, not amounts: PAN, phone, bill / voucher numbers, codes, years
const ID_RE = /\bpan\b|vat\s*(no|number|reg)|\bcode\b|phone|mobile|contact|\b(bill|doc|document|voucher|invoice|ref|reference|cheque|order|challan|grn|lc|pp|serial|batch|account|a\/c)\s*(no|number|#)|^no\.?$|^s\.?\s*n\.?$|^sn$|^#$|\bid$|\byear\b|\bfy\b/i;
// adding these up means nothing (a running balance, a rate, a %)
const NO_SUM_RE = /balance|rate|price|%|percent|margin|\bavg\b|^average$|\bdays?\b|\bage\b|turnover|ratio|times|cover/i;
const lastPart = label => String(label || '').split(' › ').pop();
const ACT_SEL = 'a[href], button:not([data-xf]), [role="button"], input[type="checkbox"]';
const INLINE = /^(B|STRONG|EM|I|U|MARK|SUP|SUB|ABBR)$/;
/** the text of a cell as it reads on screen: "Lux Soap" + <span>SOAP</span> = "Lux Soap SOAP" (tree arrows and ▾ left out) */
function text(el) {
    if (!el) return '';
    const walk = node => {
        let s = '';
        node.childNodes.forEach(c => {
            if (c.nodeType === 3) s += c.nodeValue;
            else if (c.nodeType === 1 && !c.hasAttribute('data-xf')) s += INLINE.test(c.tagName) ? walk(c) : ` ${walk(c)} `;
        });
        return s;
    };
    return walk(el).replace(/[▾▴•▸►▼▶]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const indentOf = tr => {
    const c = Array.from(tr.cells).find(x => text(x) !== '') || tr.cells[0];
    return c ? parseFloat(c.style.paddingLeft) || 0 : 0;
};
const isBold = tr => /font-(bold|semibold|extrabold)/.test(tr.className || '') || (tr.cells.length > 0 && Array.from(tr.cells).every(c => c.tagName === 'TH' || /font-(bold|semibold)/.test(c.className || '')));

/** captions of every real column; grouped header cells are joined: "Sales › Taxable" */
function headerLabels(table) {
    // a row that is one caption across the whole table has no column of its own
    const rows = table.tHead ? Array.from(table.tHead.rows).filter(r => !(r.cells.length === 1 && (r.cells[0].colSpan || 1) > 1)) : [];
    if (!rows.length) return null;
    const grid = rows.map(() => []);
    rows.forEach((r, ri) => {
        let ci = 0;
        Array.from(r.cells).forEach(cell => {
            while (grid[ri][ci]) ci++;
            const rs = Math.max(1, cell.rowSpan || 1), cs = Math.max(1, cell.colSpan || 1);
            for (let dr = 0; dr < rs && ri + dr < rows.length; dr++) for (let dc = 0; dc < cs; dc++) grid[ri + dr][ci + dc] = cell;
            ci += cs;
        });
    });
    const width = grid[rows.length - 1].length;
    const out = [];
    for (let c = 0; c < width; c++) {
        const chain = [];
        grid.forEach(r => { const cell = r[c]; if (cell && !chain.includes(cell)) chain.push(cell); });
        out.push(chain.map(text).filter(Boolean).join(' › ') || `Column ${c + 1}`);
    }
    return out;
}
/** the cells of a row spread over the columns (a cell spanning 3 columns fills the first) */
function spread(tr, n) {
    const out = new Array(n).fill('');
    let ci = 0;
    Array.from(tr.cells).forEach(c => { if (ci < n) out[ci] = text(c); ci += Math.max(1, c.colSpan || 1); });
    return out;
}
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/**
 * Reads a report table. Returns { columns, rows, trs, pinnedTop, pinnedBottom, levels, sections, dropped, ticks, simple, signature }.
 * Heading rows (one caption across the row, or the report's bold group lines
 * in a tree report) become Level columns: their indent (padding-left) tells
 * the level, so Customer › Product Group › Product gives two Level columns
 * named after the parts of the first caption. Exported for the scratch tests.
 */
export function extractTable(table) {
    const labels = headerLabels(table) || [];
    const n = labels.length;
    const bodyRows = Array.from(table.tBodies).flatMap(b => Array.from(b.rows));
    const full = tr => tr.cells.length === n && Array.from(tr.cells).every(c => (c.colSpan || 1) === 1);
    const info = bodyRows.map(tr => {
        const vals = spread(tr, n);
        const filled = vals.filter(v => v !== '');
        const totalLike = TOTAL_RE.test(filled[0] || '') || TOTAL_RE.test(filled[1] || '') || /^(grand\s+)?total\b/i.test(filled.slice(0, 2).join(' '));
        return { tr, vals, filled, totalLike, full: full(tr), bold: isBold(tr) };
    });
    // bold rows among plain rows are the report's own group lines (a tree); all rows bold is just styling
    const plain = info.filter(x => x.full && !x.totalLike);
    const boldIsStructure = plain.some(x => x.bold) && plain.some(x => !x.bold);
    const data = [], pinnedTop = [], trailing = [];
    let stack = [], sections = 0, dropped = 0, seenData = false, ticks = false, depth = 0;
    info.forEach(({ tr, vals, filled, totalLike, full: isFull, bold }) => {
        if (isFull && !totalLike && !(boldIsStructure && bold)) {
            if (trailing.length) { dropped += trailing.length; trailing.length = 0; }
            if (tr.querySelector('input[type="checkbox"]')) ticks = true;
            data.push({ vals, path: stack.map(h => h.text), tr });
            depth = Math.max(depth, stack.length);
            seenData = true;
            return;
        }
        if (filled.length === 0) return;
        const heading = !totalLike && ((filled.length === 1 && toNum(filled[0]) === null) || (boldIsStructure && bold));
        if (heading) {
            const indent = indentOf(tr);
            while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
            stack.push({ indent, text: filled[0] });
            sections += 1;
            if (trailing.length) { dropped += trailing.length; trailing.length = 0; }
            return;
        }
        const obj = Object.fromEntries(vals.map((v, i) => [`c${i}`, v]));
        if (!seenData) pinnedTop.push(obj); else trailing.push(obj);
    });
    const tfootRows = table.tFoot ? Array.from(table.tFoot.rows).map(tr => Object.fromEntries(spread(tr, n).map((v, i) => [`c${i}`, v]))).filter(o => Object.values(o).some(Boolean)) : [];
    // after the last row: the last group's sub-total, then the grand total - keep the grand total only
    const grand = trailing.findIndex(o => /^grand\s+total/i.test(Object.values(o).find(Boolean) || ''));
    if (grand > 0) { dropped += grand; trailing.splice(0, grand); }
    const pinnedBottom = [...trailing, ...tfootRows];

    // number columns: most filled values read as numbers, and the caption is not an identifier (PAN, bill no …)
    const types = labels.map((label, i) => {
        if (ID_RE.test(label.split(' › ').pop())) return 'text';
        let filledN = 0, nums = 0;
        data.forEach(d => { const v = d.vals[i]; if (v !== '' && v !== '-') { filledN += 1; if (toNum(v) !== null) nums += 1; } });
        return filledN > 0 && nums / filledN >= 0.8 ? 'number' : 'text';
    });
    const acts = data.map(d => Array.from(d.tr.cells).map(c => Array.from(c.querySelectorAll(ACT_SEL)).filter(a => text(a) !== '' || a.tagName === 'INPUT' || a.getAttribute('title')).map(a => ({ label: text(a) || a.getAttribute('title') || a.getAttribute('aria-label') || '•', title: a.getAttribute('title') || '', tick: a.tagName === 'INPUT', checked: a.tagName === 'INPUT' ? a.checked : undefined }))));
    const clickableRow = data.map(d => /cursor-pointer/.test(d.tr.className || '') || Array.from(d.tr.cells).some(c => /cursor-pointer/.test(c.className || '')));
    // level columns: named after "Customer › Product Group › Product" when the first caption has one part per level
    const parts = (labels[0] || '').split(' › ');
    const named = depth > 0 && parts.length === depth + 1;
    const levelKeys = Array.from({ length: depth }, (_, k) => `__sec${k + 1}`);
    const rows = data.map((d, r) => {
        const row = { __i: r };
        d.vals.forEach((v, i) => {
            row[`c${i}`] = types[i] === 'number' ? toNum(v) : v;
            row[`c${i}__t`] = v;
            row[`c${i}__a`] = acts[r][i];
        });
        row.__click = clickableRow[r];
        levelKeys.forEach((k, j) => { row[k] = d.path[j] || '(none)'; });
        return row;
    });
    // a column without a caption that holds the row's buttons is "Actions"
    const caption = (label, i) => (/^Column \d+$/.test(label) && data.length && data.filter(d => d.tr.cells[i] && d.tr.cells[i].querySelector(ACT_SEL)).length >= data.length / 2 ? 'Actions' : label);
    const columns = labels.map((label, i) => ({ key: `c${i}`, label: i === 0 && named ? parts[depth] : caption(label, i), type: types[i] === 'number' ? 'number' : undefined, index: i }));
    columns.unshift(...levelKeys.map((key, j) => ({ key, label: named ? parts[j] : depth === 1 ? 'Section' : `Level ${j + 1}`, index: -1 })));
    const signature = labels.join('|');
    return { columns, rows, trs: data.map(d => d.tr), pinnedTop, pinnedBottom, levels: levelKeys, sections, dropped, ticks, simple: !sections && !dropped && !ticks && !boldIsStructure, signature };
}

function SmartTable({ table, target, path }) {
    const [ver, setVer] = useState(0);
    const data = useMemo(() => extractTable(table), [table, ver]); // eslint-disable-line react-hooks/exhaustive-deps
    const key = `sg:${path}:${hash(data.signature)}`.slice(0, 120);
    const modeKey = `sg_mode:${path}:${hash(data.signature)}`;
    const readMode = () => { try { return localStorage.getItem(modeKey); } catch { return null; } };
    // simple lists of 3+ rows open as ▦ Grid; reports with headings / sub-totals / ticks and tiny tables as 📄 Report
    const [mode, setModeState] = useState(() => readMode() || (data.simple && data.rows.length >= 3 ? 'grid' : 'report'));
    const [chartSignal, setChartSignal] = useState(0);
    const setMode = m => { setModeState(m); try { localStorage.setItem(modeKey, m); } catch { /* blocked */ } };
    const refresh = useRef(null);
    refresh.current = () => setVer(v => v + 1);

    // the page redrew the table (new rows, sort, ▾ buttons) -> read it again
    useEffect(() => {
        let t = null;
        const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => refresh.current(), 150); });
        mo.observe(table, { childList: true, subtree: true, characterData: true });
        return () => { mo.disconnect(); clearTimeout(t); };
    }, [table]);
    // 📁 Views put a mode back
    useEffect(() => {
        const on = () => { const m = readMode(); if (m && m !== mode) setModeState(m); };
        window.addEventListener('sg-modes', on);
        return () => window.removeEventListener('sg-modes', on);
    });
    // grid view hides the report (print still shows it - index.css)
    useEffect(() => {
        if (mode === 'grid') { target.style.display = 'none'; target.setAttribute('data-sg-hidden', '1'); }
        else { target.style.display = ''; target.removeAttribute('data-sg-hidden'); }
    }, [mode, target]);
    useEffect(() => () => { target.style.display = ''; target.removeAttribute('data-sg-hidden'); }, [target]);

    const cellOf = (row, colKey) => {
        const tr = data.trs[row.__i];
        const col = data.columns.find(c => c.key === colKey);
        if (!tr || !tr.isConnected || !col || col.index < 0) return null;
        return tr.cells[col.index] || null;
    };
    const clickOriginal = (el, dbl) => {
        if (!el) return;
        if (dbl) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        else el.click();
        setTimeout(() => refresh.current(), 60);
    };
    const act = (row, colKey, i) => { const cell = cellOf(row, colKey); clickOriginal(cell ? cell.querySelectorAll(ACT_SEL)[i] : null); };

    const columns = useMemo(() => data.columns.map(c => (c.index < 0 ? c : {
        ...c,
        noSum: c.type === 'number' && NO_SUM_RE.test(lastPart(c.label)) && !data.pinnedBottom.some(p => toNum(p[c.key]) !== null),
        text: row => row[`${c.key}__t`],
        render: row => {
            const acts = row[`${c.key}__a`] || [];
            const t = row[`${c.key}__t`];
            if (acts.length === 1 && !acts[0].tick) {
                return <button type="button" data-enter-skip className="text-blue-700 hover:underline text-left" title={acts[0].title || 'Open'} onClick={e => { e.stopPropagation(); act(row, c.key, 0); }}>{t || acts[0].label}</button>;
            }
            if (acts.length) {
                return (
                    <span className="inline-flex gap-1 items-center">
                        {acts.map((a, i) => (a.tick
                            ? <input key={i} type="checkbox" checked={!!a.checked} onChange={() => act(row, c.key, i)} onClick={e => e.stopPropagation()} />
                            : <button key={i} type="button" data-enter-skip className="px-1.5 py-0.5 border rounded text-[11px] hover:bg-gray-100" title={a.title} onClick={e => { e.stopPropagation(); act(row, c.key, i); }}>{a.label}</button>))}
                    </span>
                );
            }
            return t === '' ? '' : t;
        }
    })), [data]); // eslint-disable-line react-hooks/exhaustive-deps

    const defaults = useMemo(() => {
        const aggs = {};
        data.columns.forEach(c => {
            if (c.type !== 'number') return;
            const inTotals = data.pinnedBottom.some(p => toNum(p[c.key]) !== null);
            if (inTotals || (AMOUNT_RE.test(c.label) && !NO_SUM_RE.test(lastPart(c.label)))) aggs[c.key] = 'sum';
        });
        return aggs;
    }, [data]);
    const title = (document.querySelector('.nav-page-titlebar .nav-titlebar-left span')?.textContent || document.title || 'Report').trim();

    const switcher = (
        <span className="inline-flex border rounded overflow-hidden text-xs mr-1" data-no-view>
            <button type="button" className={`px-2 py-1 ${mode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'}`} onClick={() => setMode('grid')} title="Grid: filter, group, totals, chart">▦ Grid</button>
            <button type="button" className={`px-2 py-1 border-l ${mode === 'report' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'}`} onClick={() => setMode('report')} title="The report as it is printed">📄 Report</button>
        </span>
    );
    if (mode !== 'grid') {
        return (
            <div className="flex flex-wrap items-center gap-2 mb-1 text-xs no-print">
                {switcher}
                <button type="button" className="px-2 py-1 border rounded bg-white hover:bg-gray-50" onClick={() => { setMode('grid'); setChartSignal(s => s + 1); }}>📊 Chart</button>
                <span className="text-gray-500">{data.rows.length} rows · ▦ Grid to filter, group with sub-totals, add totals, chart or pivot this report</span>
            </div>
        );
    }
    const notes = [];
    if (data.levels.length) notes.push(`report headings are in the ${data.columns.slice(0, data.levels.length).map(c => c.label).join(' / ')} column(s), grouped`);
    if (data.dropped) notes.push(`${data.dropped} sub-total line(s) of the report are not rows here - the groups show their own`);
    if (data.pinnedTop.length || data.pinnedBottom.length) notes.push('yellow rows are the report\'s own (opening / totals), not filtered');
    return (
        <div className="mb-2 no-print sg-grid">
            <ReportGrid
                key={key}
                columns={columns}
                rows={data.rows}
                getId={r => r.__i}
                storageKey={key}
                title={title}
                toolbarExtra={switcher}
                pinnedTop={data.pinnedTop}
                pinnedBottom={data.pinnedBottom}
                defaultFooterAggs={defaults}
                defaultGroupBy={data.levels.length ? data.levels : undefined}
                openChartSignal={chartSignal}
                onCellClick={(row, colKey, e) => { if (row.__click && !e.target.closest('button, input, a')) clickOriginal(cellOf(row, colKey)); }}
                onCellDoubleClick={(row, colKey) => clickOriginal(cellOf(row, colKey), true)}
                rowClassName={row => (row.__click ? 'cursor-pointer' : '')}
                note={notes.join(' · ')}
            />
        </div>
    );
}

/** eligible report tables: the ▾-filter tables with 2+ data rows, not in a pop-up, not on an entry screen */
function smartTables(root) {
    if (root.querySelector('.ent-fillbar')) return [];            // a voucher / bill being entered
    return reportTables(root).filter(t => {
        if (t.closest('[data-no-smart], .sg-mount, .fixed, [role="dialog"]')) return false;
        const n = (headerLabels(t) || []).length;
        const full = Array.from(t.tBodies).flatMap(b => Array.from(b.rows)).filter(tr => tr.cells.length === n && Array.from(tr.cells).every(c => (c.colSpan || 1) === 1));
        return full.length >= 2;
    });
}
/**
 * Where the switch goes and what grid view hides: the table, or its scroll
 * wrapper when the table is its only child. When that wrapper sits side by
 * side with others (a grid / flex row, e.g. Liabilities | Assets) the switch
 * goes inside the wrapper so the row keeps its layout; null = leave alone.
 */
function placeOf(table, root) {
    let t = table;
    for (let i = 0; i < 3; i++) {
        const p = t.parentElement;
        if (!p || p === root || p.tagName !== 'DIV' || p.children.length !== 1 || p.classList.contains('nav-page-body') || p.classList.contains('nav-page')) break;
        t = p;
    }
    const parent = t.parentElement;
    if (!parent) return null;
    const cs = window.getComputedStyle(parent);
    const sideBySide = cs.display.includes('grid') || (cs.display.includes('flex') && !cs.flexDirection.startsWith('column'));
    if (!sideBySide) return { parent, hide: t };
    if (t === table) return null;
    return { parent: t, hide: t.firstElementChild };
}

let seq = 0;
export default function useSmartTables(ref, path) {
    const [items, setItems] = useState([]);
    const itemsRef = useRef([]);
    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        let timer = null;
        const scan = () => {
            const tables = smartTables(root);
            let changed = false;
            const keep = itemsRef.current.filter(it => {
                if (it.table.isConnected && tables.includes(it.table) && it.target.isConnected) return true;
                it.mount.remove();
                changed = true;
                return false;
            });
            tables.forEach(table => {
                if (keep.some(it => it.table === table)) return;
                const place = placeOf(table, root);
                if (!place || !place.hide) return;
                const mount = document.createElement('div');
                mount.className = 'sg-mount';
                mount.setAttribute('data-no-view', '1');
                mount.setAttribute('data-enter-nav', 'off');
                place.parent.insertBefore(mount, place.hide);
                keep.push({ id: ++seq, table, target: place.hide, mount });
                changed = true;
            });
            // keep each switch right above its report (the page may have moved things)
            keep.forEach(it => { if (it.mount.nextSibling !== it.target && it.target.parentNode) it.target.parentNode.insertBefore(it.mount, it.target); });
            itemsRef.current = keep;
            if (changed) setItems([...keep]);
        };
        const observer = new MutationObserver(list => {
            if (list.every(m => (m.target.closest && m.target.closest('.sg-mount')) || (m.target.parentElement && m.target.parentElement.closest('.sg-mount')))) return;
            clearTimeout(timer);
            timer = setTimeout(scan, 160);
        });
        observer.observe(root, { childList: true, subtree: true });
        scan();
        return () => {
            observer.disconnect();
            clearTimeout(timer);
            itemsRef.current.forEach(it => it.mount.remove());
            itemsRef.current = [];
            setItems([]);
        };
    }, [ref, path]);
    return <>{items.map(it => createPortal(<SmartTable key={it.id} table={it.table} target={it.target} path={path} />, it.mount))}</>;
}

/** 📁 Views: the Grid / Report choice of every report table on the screen */
export function captureSmartModes() {
    const out = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(`sg_mode:${window.location.pathname}:`)) out[k] = localStorage.getItem(k);
        }
    } catch { /* blocked */ }
    return out;
}
export function restoreSmartModes(modes) {
    try { Object.entries(modes || {}).forEach(([k, v]) => localStorage.setItem(k, v)); } catch { /* blocked */ }
    window.dispatchEvent(new Event('sg-modes'));
}
