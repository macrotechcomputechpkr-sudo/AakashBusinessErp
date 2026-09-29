// =============================================
// useExcelTableFilters.tsx
// Gives EVERY plain report table inside <Layout> the spreadsheet column
// filter (▾ in each header: sort, search, tick values, hide the column)
// without rewriting the report pages. ReportGrid tables ([data-excel-managed])
// have their own.
//
// How: a MutationObserver finds tables with a header and a data row and adds the ▾ button to each column's header cell. Grouped headers
// (a "Sales" cell spanning its columns, "Particular" spanning two header
// rows) are read as a grid, so the ▾ sits on each real column. Filters hide
// body rows (style.display); sorting re-orders the data rows; hidden columns
// hide their cells. Rows that do not have one cell per column (group
// headings, sub-total rows with colSpan) always stay visible, and tables with
// such rows cannot be sorted (that would break their grouping). After the
// page re-renders a table the filter / sort / hidden columns apply again.
//
// captureTables / restoreTables let 📁 Views (components/ReportViews.jsx)
// save and bring back every table's filters, sort and hidden columns: a
// restore waiting for its table (the report is still loading) is applied
// the moment a table with the same columns appears.
// Opt out with data-no-excel on the table or any parent; tables inside a
// <form> or with inputs in their rows (entry line grids) are left alone.
// =============================================
import React, { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import ExcelFilterMenu, { distinctValues, cellKey } from '../components/ExcelFilterMenu';

interface TableState { filters: Map<number, Set<string>>; sort: { col: number; dir: 'asc' | 'desc' } | null; hidden: Set<number> }
interface MenuState { table: HTMLTableElement; col: number; anchor: { left: number; top: number; bottom: number }; title: string }
export interface TableView { index: number; signature: string; headers: string[]; filters: Record<string, string[]>; sort: { col: number; dir: 'asc' | 'desc' } | null; hidden: number[] }

const states = new WeakMap<HTMLTableElement, TableState>();
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const cellText = (td: Element | undefined): string => ((td as HTMLElement | undefined)?.innerText ?? td?.textContent ?? '').replace(/\s+/g, ' ').trim();
const headText = (th: Element | undefined): string => cellText(th).replace(/[▾▴•]+/g, '').trim();
const asNumber = (s: string): number | null => {
    const x = s.replace(/,/g, '').replace(/\s*(Dr|Cr)$/i, '').replace(/[%₹]|Rs\.?/gi, '').trim();
    return x !== '' && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) * (/Cr$/i.test(s.trim()) ? -1 : 1) : null;
};
const emptyState = (): TableState => ({ filters: new Map(), sort: null, hidden: new Set() });

/** the header cell of every real column: the header rows read as a grid (colSpan / rowSpan) */
// a header row that is one caption across the whole table ("Columns: Month - Amount") has no column of its own
const captionRow = (r: HTMLTableRowElement) => r.cells.length === 1 && (r.cells[0].colSpan || 1) > 1;
function leafHeaders(table: HTMLTableElement): HTMLTableCellElement[] | null {
    const rows = table.tHead ? Array.from(table.tHead.rows).filter(r => !captionRow(r)) : [];
    if (!rows.length) return null;
    const grid: (HTMLTableCellElement | undefined)[][] = rows.map(() => []);
    rows.forEach((r, ri) => {
        let ci = 0;
        Array.from(r.cells).forEach(cell => {
            while (grid[ri][ci]) ci++;
            const rs = Math.max(1, cell.rowSpan || 1), cs = Math.max(1, cell.colSpan || 1);
            for (let dr = 0; dr < rs && ri + dr < rows.length; dr++) for (let dc = 0; dc < cs; dc++) grid[ri + dr][ci + dc] = cell;
            ci += cs;
        });
    });
    const last = grid[rows.length - 1];
    if (last.length < 2 || last.some(c => !c || c.colSpan !== 1)) return null;
    // a cell may cover several columns only in an upper row - every column needs its own leaf
    if (new Set(last).size !== last.length) return null;
    return last as HTMLTableCellElement[];
}
function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
    return Array.from(table.tBodies).flatMap(b => Array.from(b.rows));
}
const isDataRow = (r: HTMLTableRowElement, n: number) => r.cells.length === n && Array.from(r.cells).every(c => c.colSpan === 1);

/** the tables this hook manages (same rules as the scan) */
export function reportTables(root: HTMLElement | null): HTMLTableElement[] {
    if (!root) return [];
    return Array.from(root.querySelectorAll('table')).filter(el => {
        const table = el as HTMLTableElement;
        if (table.closest('[data-excel-managed], [data-no-excel], form')) return false;
        if (table.querySelector('tbody input:not([type="checkbox"]), tbody select, tbody textarea')) return false;
        const head = leafHeaders(table);
        if (!head) return false;
        return bodyRows(table).some(r => isDataRow(r, head.length));
    }) as HTMLTableElement[];
}
const signatureOf = (table: HTMLTableElement) => (leafHeaders(table) || []).map(headText).join('|');
export const tableHeaders = (table: HTMLTableElement) => (leafHeaders(table) || []).map(headText);

function apply(table: HTMLTableElement) {
    const st = states.get(table), head = leafHeaders(table);
    if (!st || !head) return;
    const n = head.length;
    const rows = bodyRows(table);
    rows.forEach(r => {
        if (!isDataRow(r, n)) { r.style.display = ''; return; }
        let ok = true;
        st.filters.forEach((allowed, col) => { if (ok && !allowed.has(cellKey(cellText(r.cells[col])))) ok = false; });
        r.style.display = ok ? '' : 'none';
    });
    if (st.sort && rows.every(r => isDataRow(r, n)) && table.tBodies.length === 1) {
        const { col, dir } = st.sort;
        const body = table.tBodies[0];
        const sorted = [...rows].sort((a, b) => {
            const x = cellText(a.cells[col]), y = cellText(b.cells[col]);
            const nx = asNumber(x), ny = asNumber(y);
            const c = nx !== null && ny !== null ? nx - ny : coll.compare(x, y);
            return dir === 'asc' ? c : -c;
        });
        if (sorted.some((r, i) => r !== rows[i])) sorted.forEach(r => body.appendChild(r));
    }
    // hidden columns: the column's header and its cell in every row with one cell per column
    const hideRows = [...rows, ...(table.tFoot ? Array.from(table.tFoot.rows) : [])].filter(r => isDataRow(r, n));
    head.forEach((th, i) => {
        const off = st.hidden.has(i);
        th.style.display = off ? 'none' : '';
        hideRows.forEach(r => { const c = r.cells[i] as HTMLElement | undefined; if (c) c.style.display = off ? 'none' : ''; });
    });
    // header buttons show which columns are filtered / sorted
    head.forEach((th, i) => {
        const b = th.querySelector<HTMLButtonElement>('[data-xf]');
        if (!b) return;
        const on = st.filters.has(i);
        b.className = `ml-1 px-1 rounded text-[10px] border no-print ${on ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-400 border-gray-300'}`;
        b.textContent = st.sort && st.sort.col === i ? (st.sort.dir === 'asc' ? '▴' : '▾') + (on ? '•' : '') : on ? '▾•' : '▾';
    });
}

// ---- save / restore (📁 Views) ----
let pending: TableView[] | null = null;
let rerun: (() => void) | null = null;
function setState(table: HTMLTableElement, v: TableView) {
    const st = emptyState();
    Object.entries(v.filters || {}).forEach(([c, vals]) => st.filters.set(Number(c), new Set(vals)));
    st.sort = v.sort || null;
    (v.hidden || []).forEach(c => st.hidden.add(c));
    states.set(table, st);
    apply(table);
}
/** every managed table's filters, sort and hidden columns */
export function captureTables(root: HTMLElement | null): TableView[] {
    return reportTables(root).map((table, index) => {
        const st = states.get(table) || emptyState();
        return { index, signature: signatureOf(table), headers: tableHeaders(table),
            filters: Object.fromEntries(Array.from(st.filters.entries()).map(([c, s]) => [String(c), Array.from(s)])), sort: st.sort, hidden: Array.from(st.hidden) };
    });
}
/** put saved table views back now, or as soon as their tables appear (report still loading) */
export function restoreTables(root: HTMLElement | null, views: TableView[]) {
    const tables = reportTables(root);
    const left: TableView[] = [];
    (views || []).forEach(v => {
        const t = tables[v.index] && signatureOf(tables[v.index]) === v.signature ? tables[v.index] : tables.find(x => signatureOf(x) === v.signature);
        if (t) setState(t, v); else left.push(v);
    });
    pending = left.length ? left : null;
    if (rerun) rerun();
}
/** clear every filter / sort / hidden column of the page */
export function resetTables(root: HTMLElement | null) {
    pending = null;
    reportTables(root).forEach(t => { states.set(t, emptyState()); apply(t); });
}
/** show / hide one column of one table (📁 Views > Columns) */
export function setColumnHidden(table: HTMLTableElement, col: number, hidden: boolean) {
    const st = states.get(table) || emptyState();
    if (hidden) st.hidden.add(col); else st.hidden.delete(col);
    states.set(table, st);
    apply(table);
}
export const hiddenColumns = (table: HTMLTableElement) => Array.from((states.get(table) || emptyState()).hidden);

export default function useExcelTableFilters(ref: RefObject<HTMLElement>): React.ReactElement | null {
    const [menu, setMenu] = useState<MenuState | null>(null);
    const busy = useRef(false);

    const scan = useCallback((root: HTMLElement, observer?: MutationObserver) => {
        busy.current = true;
        reportTables(root).forEach(table => {
            const head = leafHeaders(table);
            if (!head) return;
            head.forEach((th, col) => {
                if (th.querySelector('[data-xf]')) return;
                const b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('data-xf', '1');
                b.setAttribute('data-enter-skip', '1');
                b.title = 'Filter / sort / hide (like a spreadsheet)';
                b.className = 'ml-1 px-1 rounded text-[10px] border text-gray-400 border-gray-300 no-print';
                b.textContent = '▾';
                b.addEventListener('click', e => {
                    e.stopPropagation(); e.preventDefault();
                    const r = b.getBoundingClientRect();
                    setMenu({ table, col, anchor: { left: r.left, top: r.top, bottom: r.bottom }, title: headText(th) });
                });
                th.appendChild(b);
            });
            // a saved view waiting for this table (same columns)
            if (pending) {
                const sig = signatureOf(table);
                const i = pending.findIndex(v => v.signature === sig);
                if (i >= 0) { setState(table, pending[i]); pending.splice(i, 1); if (!pending.length) pending = null; }
            }
            if (states.has(table)) apply(table);
        });
        if (observer) observer.takeRecords();                    // ignore our own changes
        busy.current = false;
    }, []);

    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const observer = new MutationObserver(list => {
            if (busy.current) return;
            // typing / clicking in a ▦ Grid view (hooks/useSmartTables) changes no report table
            if (list.every(m => { const el = (m.target.nodeType === 1 ? m.target : m.target.parentElement) as Element | null; return !!el?.closest('.sg-mount'); })) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => scan(root, observer), 120);
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        scan(root, observer);
        rerun = () => scan(root, observer);
        return () => { observer.disconnect(); if (timer) clearTimeout(timer); rerun = null; };
    }, [ref, scan]);

    if (!menu) return null;
    const head = leafHeaders(menu.table);
    const n = head ? head.length : 0;
    const dataRows = bodyRows(menu.table).filter(r => isDataRow(r, n));
    const st = states.get(menu.table);
    const sortable = bodyRows(menu.table).every(r => isDataRow(r, n)) && menu.table.tBodies.length === 1;
    const update = (fn: (s: TableState) => void) => {
        const s = states.get(menu.table) || emptyState();
        fn(s);
        states.set(menu.table, s);
        busy.current = true; apply(menu.table); busy.current = false;
    };
    return (
        <ExcelFilterMenu anchor={menu.anchor} title={menu.title}
            values={distinctValues(dataRows.map(r => cellText(r.cells[menu.col])))}
            selected={st?.filters.get(menu.col) || null}
            onApply={allowed => update(s => { if (allowed) s.filters.set(menu.col, allowed); else s.filters.delete(menu.col); })}
            onSort={sortable ? dir => update(s => { s.sort = { col: menu.col, dir }; }) : undefined}
            onHide={() => update(s => { s.hidden.add(menu.col); })}
            onClose={() => setMenu(null)} />
    );
}
