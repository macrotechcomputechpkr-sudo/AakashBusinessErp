// =============================================
// useExcelTableFilters.tsx
// Gives EVERY plain report table inside <Layout> the spreadsheet column
// filter (▾ in each header: sort, search, tick values) without rewriting
// the report pages. ReportGrid tables ([data-excel-managed]) have their own.
//
// How: a MutationObserver finds tables with a header row and at least two
// data rows and adds the ▾ button to each header cell. Filters hide body
// rows (style.display); sorting re-orders the data rows. Rows that do not
// have one cell per column (group headings, sub-total rows with colSpan)
// always stay visible, and tables with such rows cannot be sorted (that
// would break their grouping). After the page re-renders a table the
// filter / sort is applied again.
// Opt out with data-no-excel on the table or any parent; tables inside a
// <form> or with inputs in their rows (entry line grids) are left alone.
// =============================================
import React, { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import ExcelFilterMenu, { distinctValues, cellKey } from '../components/ExcelFilterMenu';

interface TableState { filters: Map<number, Set<string>>; sort: { col: number; dir: 'asc' | 'desc' } | null }
interface MenuState { table: HTMLTableElement; col: number; anchor: { left: number; top: number; bottom: number }; title: string }

const states = new WeakMap<HTMLTableElement, TableState>();
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const cellText = (td: Element | undefined): string => ((td as HTMLElement | undefined)?.innerText ?? td?.textContent ?? '').replace(/\s+/g, ' ').trim();
const asNumber = (s: string): number | null => {
    const x = s.replace(/,/g, '').replace(/\s*(Dr|Cr)$/i, '').replace(/[%₹]|Rs\.?/gi, '').trim();
    return x !== '' && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) * (/Cr$/i.test(s.trim()) ? -1 : 1) : null;
};

function headerRow(table: HTMLTableElement): HTMLTableRowElement | null {
    const rows = table.tHead ? Array.from(table.tHead.rows) : [];
    for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.cells.length > 1 && Array.from(r.cells).every(c => c.colSpan === 1)) return r;
    }
    return null;
}
function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
    return Array.from(table.tBodies).flatMap(b => Array.from(b.rows));
}
const isDataRow = (r: HTMLTableRowElement, n: number) => r.cells.length === n && Array.from(r.cells).every(c => c.colSpan === 1);

function apply(table: HTMLTableElement) {
    const st = states.get(table), head = headerRow(table);
    if (!st || !head) return;
    const n = head.cells.length;
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
    // header buttons show which columns are filtered / sorted
    Array.from(head.cells).forEach((th, i) => {
        const b = th.querySelector<HTMLButtonElement>('[data-xf]');
        if (!b) return;
        const on = st.filters.has(i);
        b.className = `ml-1 px-1 rounded text-[10px] border no-print ${on ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-400 border-gray-300'}`;
        b.textContent = st.sort && st.sort.col === i ? (st.sort.dir === 'asc' ? '▴' : '▾') + (on ? '•' : '') : on ? '▾•' : '▾';
    });
}

export default function useExcelTableFilters(ref: RefObject<HTMLElement>): React.ReactElement | null {
    const [menu, setMenu] = useState<MenuState | null>(null);
    const busy = useRef(false);

    const scan = useCallback((root: HTMLElement, observer?: MutationObserver) => {
        busy.current = true;
        root.querySelectorAll('table').forEach(el => {
            const table = el as HTMLTableElement;
            if (table.closest('[data-excel-managed], [data-no-excel], form')) return;
            // entry line grids (inputs in the rows) are not reports
            if (table.querySelector('tbody input:not([type="checkbox"]), tbody select, tbody textarea')) return;
            const head = headerRow(table);
            if (!head) return;
            const n = head.cells.length;
            if (bodyRows(table).filter(r => isDataRow(r, n)).length < 2) return;
            Array.from(head.cells).forEach((th, col) => {
                if (th.querySelector('[data-xf]')) return;
                const b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('data-xf', '1');
                b.setAttribute('data-enter-skip', '1');
                b.title = 'Filter / sort (like a spreadsheet)';
                b.className = 'ml-1 px-1 rounded text-[10px] border text-gray-400 border-gray-300 no-print';
                b.textContent = '▾';
                b.addEventListener('click', e => {
                    e.stopPropagation(); e.preventDefault();
                    const r = b.getBoundingClientRect();
                    setMenu({ table, col, anchor: { left: r.left, top: r.top, bottom: r.bottom }, title: cellText(th).replace(/[▾▴•]+$/, '') });
                });
                th.appendChild(b);
            });
            if (states.has(table)) apply(table);
        });
        if (observer) observer.takeRecords();                    // ignore our own changes
        busy.current = false;
    }, []);

    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const observer = new MutationObserver(() => {
            if (busy.current) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => scan(root, observer), 120);
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        scan(root, observer);
        return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
    }, [ref, scan]);

    if (!menu) return null;
    const head = headerRow(menu.table);
    const n = head ? head.cells.length : 0;
    const dataRows = bodyRows(menu.table).filter(r => isDataRow(r, n));
    const st = states.get(menu.table);
    const sortable = bodyRows(menu.table).every(r => isDataRow(r, n)) && menu.table.tBodies.length === 1;
    const update = (fn: (s: TableState) => void) => {
        const s = states.get(menu.table) || { filters: new Map<number, Set<string>>(), sort: null };
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
            onClose={() => setMenu(null)} />
    );
}
