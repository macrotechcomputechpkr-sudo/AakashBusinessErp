// =============================================
// ReportGrid.jsx
// A from-scratch, original reusable data-grid component used across every
// master listing in this app (Users, Ledger Accounts, Product Groups, etc)
// and - through hooks/useSmartTables.jsx - on every plain report table too
// (▦ Grid view of the report).
//
// Deliberately original: naming, visual design (Tailwind, matches the
// rest of this app), and code are all written independently here - no
// third-party software's source, branding, or exact UI was copied.
// Functional ideas common to spreadsheet-style grids (sorting, multi-level
// grouping via drag-and-drop, a right-click column menu, a column chooser,
// a filter builder, an AutoFilter row, conditional highlighting, a
// per-column footer aggregate row, keyboard cell navigation, opt-in
// inline cell editing, CSV export, charts and pivot tables) are standard,
// non-proprietary patterns found in many independent grid libraries.
//
// Analysis tools (R21):
//   ⇅ Group & Sort   several sort levels (Shift+click a header adds one),
//                    group levels in order, each group level ordered by its
//                    name, its row count or the Sum of a number column
//                    (e.g. parties biggest first), collapse / expand
//   📊 Chart         column / stacked / bar / line / area / pie / donut of
//                    the rows shown, split by a column, Top N + Other,
//                    pivot table, PNG / SVG / CSV (grid/GridChartPanel.jsx)
//   🎨 Highlight     row colour rules + data bars in number columns
//   ➕ Add Column    running balance, % of total, formula (A + - × ÷ B or a
//                    number), blank text
//   🖨 Print         the grid as it is shown (groups, sub-totals, footer)
// The number crunching is in grid/gridAnalysis.js (tested on its own).
//
// Inline editing is OFF by default per column: pass `editable: true` on a
// column definition AND an `onCellEdit(row, key, newValue)` prop to enable
// it - deliberately opt-in, because it's only appropriate for simple flat
// fields (a name, a code). Columns with a foreign-key relationship or a
// custom `render` are exactly the kind of thing that should stay on a
// proper form (with its picker/validation), not become a free-text grid
// cell - so don't mark those `editable`.
//
// State: the layout (columns, sort, groups, footers, widths, added columns,
// data bars, highlight rules, chart) is kept per storageKey in localStorage;
// 📁 Views keep the whole state incl. filters (grid/gridRegistry.js).
//
// Everything runs client-side over the `rows` array you pass in - fine
// for master-data lists and reports up to a few thousand rows.
// =============================================

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ExcelFilterMenu, { distinctValues, cellKey } from './ExcelFilterMenu';
import RecordHistory from './RecordHistory';
import GridChartPanel, { defaultChartConfig } from './grid/GridChartPanel';
import FieldSelector, { AreaDrop } from './grid/FieldSelector';
import PivotView from './grid/PivotView';
import { AGG_LABELS, aggregate, buildPivot, calcColumns, compareRows, compareValues, fmtAgg, pivotLines, toNum } from './grid/gridAnalysis';
import { registerGrid, takePending } from './grid/gridRegistry';
import { loadDimensions, withDimensions } from './grid/dimensions';
import { useAuth } from '../contexts/AuthContext';

const NUMERIC_AGGS = ['sum', 'avg', 'min', 'max', 'count', 'distinct'];
const TEXT_AGGS = ['count', 'distinct', 'first', 'last'];
const OPERATORS = [
    { value: 'contains', label: 'Contains' },
    { value: 'equals', label: 'Equals' },
    { value: 'starts_with', label: 'Starts With' },
    { value: 'ends_with', label: 'Ends With' },
    { value: 'not_contains', label: 'Does Not Contain' },
    { value: 'greater_than', label: 'Greater Than' },
    { value: 'less_than', label: 'Less Than' },
    { value: 'between', label: 'Between (a..b)' },
    { value: 'blank', label: 'Is Blank' },
    { value: 'not_blank', label: 'Is Not Blank' }
];

function applyOperator(cellValue, operator, target) {
    const a = String(cellValue ?? '').toLowerCase();
    const b = String(target ?? '').toLowerCase();
    switch (operator) {
        case 'contains': return a.includes(b);
        case 'not_contains': return !a.includes(b);
        case 'equals': return a === b;
        case 'starts_with': return a.startsWith(b);
        case 'ends_with': return a.endsWith(b);
        case 'greater_than': { const n1 = toNum(cellValue), n2 = toNum(target); return n1 !== null && n2 !== null && n1 > n2; }
        case 'less_than': { const n1 = toNum(cellValue), n2 = toNum(target); return n1 !== null && n2 !== null && n1 < n2; }
        case 'between': {
            const [lo, hi] = String(target ?? '').split(/\.\.|,/).map(s => s.trim());
            const n = toNum(cellValue);
            if (n !== null && toNum(lo) !== null && toNum(hi) !== null) return n >= toNum(lo) && n <= toNum(hi);
            return a >= String(lo || '').toLowerCase() && a <= String(hi || '').toLowerCase();       // dates / text
        }
        case 'blank': return a.trim() === '';
        case 'not_blank': return a.trim() !== '';
        default: return true;
    }
}
const needsValue = op => op !== 'blank' && op !== 'not_blank';

// FEATURE: multi-level grouping tree, built fresh from the (already
// row-sorted) list every time the group keys or sort change. Each level
// partitions its parent's rows by one group key, in the order the user
// dragged the chips into the drop zone - so grouping by [Group, Type]
// nests Type inside Group, not the other way round. Each level's groups
// are ordered by name, by row count or by the Sum of a number column
// (groupSort[key] = { by: 'label' | '__count' | columnKey, dir }).
function buildGroupTree(rowsList, keys, level, parentPath, groupSort = {}) {
    if (level >= keys.length) return rowsList.map(row => ({ type: 'row', row }));
    const key = keys[level];
    const map = new Map();
    rowsList.forEach(row => {
        const raw = row[key];
        const val = raw === null || raw === undefined || String(raw).trim() === '' ? '(Blank)' : raw;
        if (!map.has(val)) map.set(val, []);
        map.get(val).push(row);
    });
    const gs = groupSort[key] || { by: 'label', dir: 'asc' };
    const measure = val => {
        const list = map.get(val);
        if (gs.by === '__count') return list.length;
        return list.reduce((s, r) => s + (toNum(r[gs.by]) || 0), 0);
    };
    const vals = Array.from(map.keys());
    vals.sort((a, b) => {
        const c = gs.by === 'label' ? compareValues(a, b) : measure(a) - measure(b);
        return gs.dir === 'desc' ? -c : c;
    });
    return vals.map(val => {
        const path = `${parentPath}/${key}:${val}`;
        return {
            type: 'group', level, key, val, path,
            count: map.get(val).length,
            children: buildGroupTree(map.get(val), keys, level + 1, path, groupSort)
        };
    });
}

function collectGroupPaths(nodes, maxLevel = Infinity) {
    let paths = [];
    nodes.forEach(n => {
        if (n.type === 'group') {
            if (n.level >= maxLevel) paths.push(n.path);
            else if (maxLevel === Infinity) paths.push(n.path);
            paths = paths.concat(collectGroupPaths(n.children, maxLevel));
        }
    });
    return paths;
}

function collectVisibleRowIds(nodes, collapsedGroups) {
    let ids = [];
    nodes.forEach(n => {
        if (n.type === 'row') ids.push(n.row.__id);
        else if (!collapsedGroups.has(n.path)) ids = ids.concat(collectVisibleRowIds(n.children, collapsedGroups));
    });
    return ids;
}

function EditableCell({ row, col, ctx }) {
    return (
        <td data-cell-id={`${row.__id}:${col.key}`} className="px-1 py-0.5 bg-white outline outline-2 outline-amber-400 -outline-offset-2">
            <input
                autoFocus
                value={ctx.editValue}
                onChange={e => ctx.setEditValue(e.target.value)}
                onBlur={() => ctx.commitEdit(row, col)}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); ctx.commitEdit(row, col); ctx.moveFocus(row.__id, col.key, e.shiftKey ? -1 : 1, 0); }
                    else if (e.key === 'Tab') { e.preventDefault(); ctx.commitEdit(row, col); ctx.moveFocus(row.__id, col.key, 0, e.shiftKey ? -1 : 1); }
                    else if (e.key === 'Escape') { e.preventDefault(); ctx.cancelEdit(); }
                }}
                className="w-full border-none outline-none text-sm px-1 py-1"
            />
        </td>
    );
}

function collectLeafValues(node, key) {
    if (node.type === 'row') return [node.row[key]];
    return node.children.flatMap(child => collectLeafValues(child, key));
}
const plainText = (col, row) => (col.text ? col.text(row) : row[col.key]);
const isNum = col => col.type === 'number';
/** what a number cell shows: the caller's render, else the value with thousands grouping */
function cellContent(col, row) {
    if (col.render) return col.render(row);
    const v = row[col.key];
    if (v === null || v === undefined || v === '') return '-';
    if (col.calc && typeof v === 'number') return col.calc === 'percent_of_total' ? `${v.toFixed(2)}%` : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v;
}

function renderGroupNode(node, ctx) {
    const { visibleColumns, rowActions, collapsedGroups, toggleCollapse, rowHighlightColor, allColumns, footerAggs, dataBars, barMax, onCellClick, rowClassName } = ctx;
    if (node.type === 'row') {
        const row = node.row;
        const bg = rowHighlightColor(row);
        const extra = rowClassName ? rowClassName(row) || '' : '';
        return [(
            <tr key={row.__id} style={bg ? { backgroundColor: bg } : undefined} className={`${!bg ? 'hover:bg-gray-50 ' : ''}border-b border-gray-100 last:border-0 ${extra}`}>
                {visibleColumns.map(col => {
                    const isEditingThis = ctx.editingCell && ctx.editingCell.rowId === row.__id && ctx.editingCell.colKey === col.key;
                    const editable = !!col.editable && !!ctx.onCellEdit;
                    if (isEditingThis) return <EditableCell key={col.key} row={row} col={col} ctx={ctx} />;
                    let barStyle;
                    if (dataBars[col.key] && barMax[col.key]) {
                        const v = toNum(row[col.key]) || 0;
                        const pct = Math.min(100, (Math.abs(v) / barMax[col.key]) * 100);
                        const c = v < 0 ? 'rgba(227,73,72,.22)' : 'rgba(42,120,214,.22)';
                        barStyle = { backgroundImage: `linear-gradient(90deg, ${c} ${pct}%, transparent ${pct}%)` };
                    }
                    return (
                        <td
                            key={col.key}
                            data-cell-id={`${row.__id}:${col.key}`}
                            tabIndex={0}
                            style={barStyle}
                            onClick={onCellClick ? e => onCellClick(row, col.key, e) : undefined}
                            onDoubleClick={e => { if (editable) ctx.startEdit(row, col); else if (ctx.onCellDoubleClick) ctx.onCellDoubleClick(row, col.key, e); }}
                            onKeyDown={e => {
                                if (editable && e.key === 'F2') { e.preventDefault(); ctx.startEdit(row, col); }
                                else ctx.handleCellKeyDown(e, row.__id, col.key);
                            }}
                            className={`px-3 py-1.5 whitespace-nowrap focus:outline focus:outline-2 focus:outline-blue-400 focus:-outline-offset-2 ${isNum(col) ? 'text-right tabular-nums' : ''} ${editable ? 'cursor-text' : ''}`}
                            title={editable ? 'Double-click or press F2 to edit' : undefined}
                        >
                            {cellContent(col, row)}
                        </td>
                    );
                })}
                {rowActions && <td className="px-3 py-1.5 text-center whitespace-nowrap">{rowActions(row)}</td>}
            </tr>
        )];
    }
    const isCollapsed = collapsedGroups.has(node.path);
    const colLabel = allColumns.find(c => c.key === node.key)?.label || node.key;

    // FEATURE: the group header row shows a per-column subtotal for every
    // numeric column (using that column's Footer Options aggregate if one
    // is set, otherwise Sum by default, none for a column marked noSum -
    // rates, balances, ratios) - computed from ALL rows under
    // this group regardless of collapse state, so collapsing a group still
    // shows its totals, not just its row count.
    const shade = ['bg-gray-200', 'bg-gray-100', 'bg-slate-50'][Math.min(node.level, 2)];
    const header = (
        <tr key={node.path} className={shade} data-group-level={node.level}>
            {visibleColumns.map((col, idx) => {
                if (idx === 0) {
                    return (
                        <td
                            key={col.key}
                            className="px-3 py-1.5 font-semibold text-gray-700 text-xs cursor-pointer whitespace-nowrap"
                            style={{ paddingLeft: 12 + node.level * 20 }}
                            onClick={() => toggleCollapse(node.path)}
                        >
                            {isCollapsed ? '▸ 📁' : '▾ 📂'} {colLabel}: {String(node.val)} <span className="text-gray-500 font-normal">({node.count})</span>
                        </td>
                    );
                }
                if (isNum(col)) {
                    const agg = groupAgg(col, footerAggs);
                    const result = agg ? aggregate(collectLeafValues(node, col.key), agg) : null;
                    return (
                        <td key={col.key} className="px-3 py-1.5 text-xs text-gray-700 font-semibold whitespace-nowrap cursor-pointer text-right tabular-nums" onClick={() => toggleCollapse(node.path)}>
                            {result !== null ? `${agg !== 'sum' ? `${AGG_LABELS[agg]}: ` : ''}${fmtAgg(result, agg, true)}` : ''}
                        </td>
                    );
                }
                return <td key={col.key} className="cursor-pointer" onClick={() => toggleCollapse(node.path)}></td>;
            })}
            {rowActions && <td className="cursor-pointer" onClick={() => toggleCollapse(node.path)}></td>}
        </tr>
    );
    if (isCollapsed) return [header];
    return [header, ...node.children.flatMap(child => renderGroupNode(child, ctx))];
}

/** a group row's sub-total of a number column: its footer aggregate, else Sum - none for rates / balances (col.noSum) */
const groupAgg = (col, footerAggs) => (footerAggs[col.key] && footerAggs[col.key] !== 'none' ? footerAggs[col.key] : col.noSum ? null : 'sum');
/**
 * A toolbar pop-up, drawn on top of the page (fixed, under the toolbar) so a
 * report card with its own scrolling never cuts it off.
 */
function Pop({ anchor, width = 460, right, pad = true, children }) {
    const [pos, setPos] = useState(null);
    useLayoutEffect(() => {
        const place = () => { const r = anchor.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, left: r.left, right: window.innerWidth - r.right }); };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [anchor]);
    if (!pos) return null;
    const w = Math.min(width, window.innerWidth - 16);
    const style = { top: pos.top, width: w, maxHeight: Math.max(200, window.innerHeight - pos.top - 8), ...(right ? { right: Math.max(8, pos.right) } : { left: Math.max(8, Math.min(pos.left, window.innerWidth - w - 8)) }) };
    return createPortal(
        <div data-rg-keep data-rg-pop data-enter-nav="off" className={`fixed z-[900] bg-white border border-gray-300 rounded-lg shadow-xl text-sm overflow-y-auto ${pad ? 'p-3' : ''}`} style={style}>{children}</div>,
        document.body
    );
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const setToArr = obj => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v).map(([k, v]) => [k, Array.from(v)]));
const arrToSet = obj => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, new Set(v)]));

export default function ReportGrid({
    columns: ownColumns,
    rows: ownRows,
    getId,
    storageKey = 'report_grid',
    rowActions: ownActions,
    auditTable,     // optional tenant table name - adds a 🕘 History button (audit log, field-level changes)
    auditTitle,     // optional row => title for that history
    onCellEdit,     // optional (row, columnKey, newValue) => void - enables inline editing for columns marked `editable: true`
    onCellClick,    // optional (row, columnKey, event) => void - a cell was clicked
    onCellDoubleClick, // optional (row, columnKey, event) => void
    rowClassName,   // optional row => extra class names for the row
    title,          // optional - print heading / file names
    toolbarExtra,   // optional node shown first in the toolbar
    pinnedTop = [],     // optional rows from the report shown above the data, not filtered ({ [key]: text })
    pinnedBottom = [],  // optional rows from the report shown under the data (report totals)
    defaultFooterAggs,  // optional { [key]: agg } when nothing is saved yet
    defaultGroupBy,     // optional [keys] when nothing is saved yet
    initialChart = false, // open the 📊 Chart panel at first
    openChartSignal,      // a changing number: open the 📊 Chart panel now
    note,           // optional small text under the grid
    noDimensions    // true: do not add the product / party attribute fields
}) {
    // FEATURE: a product or party column brings its attributes (Product Group,
    // Company, Category, Unit / Account Group, Area, Route, Agent, PAN) as hidden
    // fields - shown, filtered, grouped or pivoted from 📋 Columns (grid/dimensions.js).
    const { authFetch, tenant } = useAuth();
    const [dims, setDims] = useState(null);
    useEffect(() => {
        if (noDimensions || !authFetch) return undefined;
        let alive = true;
        loadDimensions(authFetch, tenant?.id || '').then(d => { if (alive) setDims(d); });
        return () => { alive = false; };
    }, [authFetch, tenant, noDimensions]);
    const dimmed = useMemo(() => withDimensions(ownColumns, ownRows, dims), [ownColumns, ownRows, dims]);
    const columns = dimmed.columns;
    const rows = dimmed.rows;
    const [historyOf, setHistoryOf] = useState(null); // { id, title } | null
    const rowActions = auditTable
        ? (row) => (
            <div className="flex gap-2 justify-center items-center">
                {ownActions && ownActions(row)}
                <button type="button" data-enter-skip title="History - who changed what (audit log)" className="px-1.5 py-1 border rounded text-xs text-gray-600 hover:bg-gray-100"
                    onClick={e => { e.stopPropagation(); setHistoryOf({ id: getId(row), title: auditTitle ? auditTitle(row) : String(row[columns[0]?.key] ?? '') || undefined }); }}>🕘</button>
            </div>
        )
        : ownActions;
    const [search, setSearch] = useState('');
    // FEATURE: several sort levels - click a header to sort by it alone,
    // Shift+click to add it as the next level (or flip it).
    const [sorts, setSorts] = useState([]); // [{ key, dir }]
    // FEATURE: multiple, ordered group-by keys (drag column headers into the
    // drop zone, or right-click -> Group By) - replaces the earlier
    // single-column dropdown with real multi-level nested grouping.
    const [groupByKeys, setGroupByKeys] = useState(defaultGroupBy || []);
    const [groupSort, setGroupSort] = useState({}); // { [key]: { by, dir } }
    const [collapsedGroups, setCollapsedGroups] = useState(new Set());
    const [columnWidths, setColumnWidths] = useState({});
    const [contextMenu, setContextMenu] = useState(null); // { x, y, colKey } | null
    const [filters, setFilters] = useState([]);
    const [highlightRules, setHighlightRules] = useState([]);
    const [dataBars, setDataBars] = useState({}); // { [colKey]: true }
    const [customColumns, setCustomColumns] = useState([]);
    const [footerAggs, setFooterAggs] = useState(defaultFooterAggs || {}); // { [colKey]: aggType }
    const [autoWidth, setAutoWidth] = useState(true);
    const [chartOn, setChartOn] = useState(!!initialChart);
    const [chartCfg, setChartCfg] = useState(null);
    // FEATURE: pivot areas (⚙ Field Selector / the zone line): Rows = groupByKeys,
    // Columns = fields whose values become columns, Values = what is added up,
    // Filters = fields picked value by value. Columns or Values -> pivot view.
    const [pivotCols, setPivotCols] = useState([]);
    const [pivotValues, setPivotValues] = useState([]); // [{ key, agg }]
    const [filterFields, setFilterFields] = useState([]);
    const [showGrouped, setShowGrouped] = useState(true);
    const [heat, setHeat] = useState(false);

    const [panel, setPanel] = useState(null);

    // FEATURE: AutoFilter row - a small text box directly under EVERY
    // visible column header, all combined with AND, so multiple columns
    // can be filtered simultaneously without opening the Filter panel and
    // picking column/operator one at a time.
    const [autoFilterOn, setAutoFilterOn] = useState(false);
    const [autoFilterValues, setAutoFilterValues] = useState({});
    // Spreadsheet-style value filter per column (▼ in the header): { [colKey]: Set of allowed values }
    const [valueFilters, setValueFilters] = useState({});
    const [filterMenu, setFilterMenu] = useState(null); // { key, anchor }

    // FEATURE: keyboard cell navigation + opt-in inline editing state.
    const [editingCell, setEditingCell] = useState(null); // { rowId, colKey } | null
    const [editValue, setEditValue] = useState('');

    const allColumns = useMemo(() => [...columns, ...customColumns], [columns, customColumns]);

    const [columnsConfig, setColumnsConfig] = useState(() =>
        allColumns.map((c, i) => ({ key: c.key, visible: !c.hidden, order: i }))
    );
    useEffect(() => {
        setColumnsConfig(prev => {
            const known = new Set(prev.map(c => c.key));
            const additions = allColumns.filter(c => !known.has(c.key)).map((c, i) => ({ key: c.key, visible: !c.hidden, order: prev.length + i }));
            const kept = prev.filter(c => allColumns.some(ac => ac.key === c.key));
            return additions.length || kept.length !== prev.length ? [...kept, ...additions] : prev;
        });
    }, [allColumns]);

    // ---------- state: layout in localStorage, everything for 📁 Views ----------
    const layoutState = () => ({ columnsConfig, groupByKeys, groupSort, footerAggs, columnWidths, sorts, dataBars, highlightRules, customColumns, chartOn, chartCfg, autoWidth, pivotCols, pivotValues, filterFields, showGrouped, heat });
    const applyState = useCallback((s, full) => {
        if (!s) {           // reset
            setSearch(''); setSorts([]); setGroupByKeys(defaultGroupBy || []); setGroupSort({}); setCollapsedGroups(new Set()); setColumnWidths({});
            setFilters([]); setHighlightRules([]); setDataBars({}); setAutoFilterOn(false); setAutoFilterValues({}); setValueFilters({});
            setFooterAggs(defaultFooterAggs || {}); setCustomColumns([]); setChartOn(false); setChartCfg(null); setAutoWidth(true);
            setPivotCols([]); setPivotValues([]); setFilterFields([]); setShowGrouped(true); setHeat(false);
            setColumnsConfig(columns.map((c, i) => ({ key: c.key, visible: !c.hidden, order: i })));
            return;
        }
        if (Array.isArray(s.customColumns)) setCustomColumns(s.customColumns);
        if (s.columnsConfig) setColumnsConfig(s.columnsConfig);
        if (Array.isArray(s.groupByKeys)) setGroupByKeys(s.groupByKeys);
        if (s.groupSort) setGroupSort(s.groupSort);
        if (s.footerAggs) setFooterAggs(s.footerAggs);
        if (s.columnWidths) setColumnWidths(s.columnWidths);
        if (Array.isArray(s.sorts)) setSorts(s.sorts);
        else if (s.sort && s.sort.key) setSorts([s.sort]);
        if (s.dataBars) setDataBars(s.dataBars);
        if (Array.isArray(s.highlightRules)) setHighlightRules(s.highlightRules);
        if (s.chartOn !== undefined) setChartOn(!!s.chartOn);
        if (s.chartCfg !== undefined) setChartCfg(s.chartCfg);
        if (s.autoWidth !== undefined) setAutoWidth(!!s.autoWidth);
        if (Array.isArray(s.pivotCols)) setPivotCols(s.pivotCols);
        if (Array.isArray(s.pivotValues)) setPivotValues(s.pivotValues);
        if (Array.isArray(s.filterFields)) setFilterFields(s.filterFields);
        if (s.showGrouped !== undefined) setShowGrouped(!!s.showGrouped);
        if (s.heat !== undefined) setHeat(!!s.heat);
        if (full) {
            setSearch(s.search || '');
            setFilters(Array.isArray(s.filters) ? s.filters : []);
            setAutoFilterOn(!!s.autoFilterOn);
            setAutoFilterValues(s.autoFilterValues || {});
            setValueFilters(arrToSet(s.valueFilters));
            setCollapsedGroups(new Set(s.collapsed || []));
        }
    }, [columns, defaultFooterAggs, defaultGroupBy]);
    const loaded = useRef(false);
    useEffect(() => {
        try {
            const saved = localStorage.getItem(`${storageKey}_state`);
            if (saved) applyState(JSON.parse(saved), false);
        } catch { /* ignore malformed saved state */ }
        const waiting = takePending(storageKey);
        if (waiting) applyState(waiting, true);
        loaded.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey]);
    useEffect(() => {
        if (!loaded.current) return;
        try { localStorage.setItem(`${storageKey}_state`, JSON.stringify(layoutState())); } catch { /* storage full / blocked */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columnsConfig, groupByKeys, groupSort, footerAggs, columnWidths, sorts, dataBars, highlightRules, customColumns, chartOn, chartCfg, autoWidth, pivotCols, pivotValues, filterFields, showGrouped, heat, storageKey]);
    const fullStateRef = useRef(null);
    fullStateRef.current = () => ({ ...layoutState(), search, filters, autoFilterOn, autoFilterValues, valueFilters: setToArr(valueFilters), collapsed: Array.from(collapsedGroups) });
    useEffect(() => registerGrid(storageKey, { get: () => fullStateRef.current(), set: s => applyState(s, true) }), [storageKey, applyState]);

    useEffect(() => { if (openChartSignal) setChartOn(true); }, [openChartSignal]);

    // Panels are pop-ups under the toolbar: a click outside closes them
    // (not a click in the ▾ value list they opened).
    const toolRef = useRef(null);
    const rootRef = useRef(null);
    useEffect(() => {
        if (!panel) return undefined;
        const close = e => {
            if (!toolRef.current || toolRef.current.contains(e.target) || e.target.closest('[data-rg-keep]')) return;
            if (panel === 'fields' && rootRef.current && rootRef.current.contains(e.target)) return;   // a docked pane: drag headers into it
            setPanel(null);
        };
        const esc = e => { if (e.key === 'Escape') setPanel(null); };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, [panel]);

    // Close the right-click menu on any outside click.
    useEffect(() => {
        if (!contextMenu) return;
        const handler = () => setContextMenu(null);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [contextMenu]);

    const addCustomColumn = (def) => {
        const key = `custom_${Date.now()}`;
        const col = { key, isCustom: true, ...def, type: def.calc === 'text' ? 'text' : 'number' };
        setCustomColumns(cols => [...cols, col]);
        setPanel(null);
    };
    const removeCustomColumn = (key) => setCustomColumns(cols => cols.filter(c => c.key !== key));

    const enrichedRows = useMemo(
        () => calcColumns(rows, customColumns).map(row => ({ ...row, __id: getId(row) })),
        [rows, customColumns, getId]
    );

    const filtered = useMemo(() => {
        let out = enrichedRows;
        if (search.trim()) {
            const s = search.toLowerCase();
            out = out.filter(row => allColumns.some(c => String(plainText(c, row) ?? '').toLowerCase().includes(s)));
        }
        filters.forEach(f => {
            if (needsValue(f.operator) && f.value === '') return;
            out = out.filter(row => applyOperator(row[f.key], f.operator, f.value));
        });
        if (autoFilterOn) {
            Object.entries(autoFilterValues).forEach(([key, value]) => {
                if (!value) return;
                // "> 1000", "< 50", "=abc" or plain text (contains)
                const m = String(value).match(/^\s*(>=|<=|>|<|=)\s*(.+)$/);
                if (m) {
                    const n = toNum(m[2]);
                    out = out.filter(row => {
                        const v = toNum(row[key]);
                        if (m[1] === '=') return String(row[key] ?? '').toLowerCase() === m[2].toLowerCase() || (v !== null && v === n);
                        if (v === null || n === null) return false;
                        return m[1] === '>' ? v > n : m[1] === '<' ? v < n : m[1] === '>=' ? v >= n : v <= n;
                    });
                } else out = out.filter(row => applyOperator(plainText(allColumns.find(c => c.key === key) || { key }, row), 'contains', value));
            });
        }
        Object.entries(valueFilters).forEach(([key, allowed]) => {
            if (allowed) out = out.filter(row => allowed.has(cellKey(row[key])));
        });
        return out;
    }, [enrichedRows, search, filters, allColumns, autoFilterOn, autoFilterValues, valueFilters]);

    // Sorting is independent of grouping now - grouping re-partitions rows
    // into its own group-value order at each level; the leaf row order
    // within the innermost group still follows these sort levels.
    const sorted = useMemo(() => {
        const valid = sorts.filter(s => allColumns.some(c => c.key === s.key));
        if (!valid.length) return filtered;
        return [...filtered].sort(compareRows(valid));
    }, [filtered, sorts, allColumns]);

    const visibleColumns = columnsConfig
        .filter(c => c.visible)
        .sort((a, b) => a.order - b.order)
        .map(c => allColumns.find(col => col.key === c.key))
        .filter(Boolean);

    const activeGroupKeys = useMemo(() => groupByKeys.filter(k => allColumns.some(c => c.key === k)), [groupByKeys, allColumns]);
    const shownGroupKeys = showGrouped ? activeGroupKeys : [];
    const displayTree = useMemo(() => {
        if (shownGroupKeys.length === 0) return sorted.map(row => ({ type: 'row', row }));
        return buildGroupTree(sorted, shownGroupKeys, 0, '', groupSort);
    }, [sorted, shownGroupKeys, groupSort]); // eslint-disable-line react-hooks/exhaustive-deps
    const activePivotCols = useMemo(() => pivotCols.filter(k => allColumns.some(c => c.key === k)), [pivotCols, allColumns]);
    const activeValues = useMemo(() => pivotValues.filter(v => allColumns.some(c => c.key === v.key)), [pivotValues, allColumns]);
    const pivotMode = activePivotCols.length > 0 || activeValues.length > 0;
    const pivot = useMemo(() => (pivotMode ? buildPivot(sorted, activeGroupKeys, activePivotCols, activeValues, k => groupSort[k]) : null),
        [pivotMode, sorted, activeGroupKeys, activePivotCols, activeValues, groupSort]);

    const visibleRowIds = useMemo(() => collectVisibleRowIds(displayTree, collapsedGroups), [displayTree, collapsedGroups]);
    const barMax = useMemo(() => {
        const m = {};
        Object.keys(dataBars).forEach(k => { if (dataBars[k]) m[k] = sorted.reduce((mx, r) => Math.max(mx, Math.abs(toNum(r[k]) || 0)), 0); });
        return m;
    }, [dataBars, sorted]);

    const sortOf = key => sorts.findIndex(s => s.key === key);
    const toggleSort = (key, add) => {
        setSorts(list => {
            const i = list.findIndex(s => s.key === key);
            if (add) {
                if (i < 0) return [...list, { key, dir: 'asc' }];
                return list.map((s, j) => (j === i ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s));
            }
            if (i === 0 && list.length === 1) return [{ key, dir: list[0].dir === 'asc' ? 'desc' : 'asc' }];
            return [{ key, dir: 'asc' }];
        });
    };
    const toggleColumnVisible = (key) => setColumnsConfig(cfg => cfg.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
    const moveColumn = (key, dir) => {
        setColumnsConfig(cfg => {
            const s = [...cfg].sort((a, b) => a.order - b.order);
            const idx = s.findIndex(c => c.key === key);
            const swap = idx + dir;
            if (swap < 0 || swap >= s.length) return cfg;
            const tmp = s[idx].order; s[idx].order = s[swap].order; s[swap].order = tmp;
            return s.map(c => ({ ...c }));
        });
    };

    const addFilter = () => setFilters(f => [...f, { key: allColumns[0]?.key, operator: 'contains', value: '' }]);
    const updateFilter = (i, patch) => setFilters(f => f.map((x, idx) => idx === i ? { ...x, ...patch } : x));
    const removeFilter = (i) => setFilters(f => f.filter((_, idx) => idx !== i));

    const addHighlight = () => setHighlightRules(h => [...h, { key: allColumns[0]?.key, operator: 'greater_than', value: '', color: '#fff2a8' }]);
    const updateHighlight = (i, patch) => setHighlightRules(h => h.map((x, idx) => idx === i ? { ...x, ...patch } : x));
    const removeHighlight = (i) => setHighlightRules(h => h.filter((_, idx) => idx !== i));

    const rowHighlightColor = (row) => {
        for (const rule of highlightRules) {
            if ((rule.value !== '' || !needsValue(rule.operator)) && applyOperator(row[rule.key], rule.operator, rule.value)) return rule.color;
        }
        return null;
    };

    const fileBase = (title || storageKey).replace(/[^\w-]+/g, '_').slice(0, 60);
    /** the pivot as a matrix: header + one line per group (indented) + grand total */
    const pivotMatrix = () => {
        const { lines: pl, grand } = pivotLines(pivot, collapsedGroups);
        const mName = m => (m.key === '__row' ? 'Count' : `${AGG_LABELS[m.agg]} of ${labelOf(m.key)}`);
        const head = [activeGroupKeys.map(labelOf).join(' › ') || 'Rows',
            ...pivot.tuples.flatMap(t => pivot.measures.map(m => [...t.labels, pivot.measures.length > 1 || !t.labels.length ? mName(m) : null].filter(Boolean).join(' › '))),
            ...(activePivotCols.length ? pivot.measures.map(m => `Total${pivot.measures.length > 1 ? ` › ${mName(m)}` : ''}`) : [])];
        const width = head.length - 1;
        const body = pl.map(l => [`${'  '.repeat(l.level)}${l.label}`, ...l.values.slice(0, width)]);
        return { head, body, total: ['Grand Total', ...grand.slice(0, width)], groupRows: pl.map(l => l.group) };
    };
    const exportCSV = () => {
        const header = visibleColumns.map(c => c.label);
        let lines = [header, ...sorted.map(row => visibleColumns.map(c => row[c.key] ?? ''))];
        if (pivot) { const m = pivotMatrix(); lines = [m.head, ...m.body, m.total]; }
        const csv = lines.map(line => line.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${fileBase}.csv`;
        a.click();
    };

    // FEATURE: print the grid as it is shown - groups with their sub-totals,
    // collapsed groups as one line, the footer aggregates.
    const printGrid = () => {
        if (pivot) return printPivot();
        const cols = visibleColumns;
        const cell = (c, v) => `<td${isNum(c) ? ' class="n"' : ''}>${esc(v)}</td>`;
        const out = [];
        const walk = nodes => nodes.forEach(n => {
            if (n.type === 'row') { out.push(`<tr>${cols.map(c => cell(c, plainText(c, n.row) ?? '')).join('')}</tr>`); return; }
            const lbl = allColumns.find(c => c.key === n.key)?.label || n.key;
            out.push(`<tr class="g g${Math.min(n.level, 2)}">${cols.map((c, i) => {
                if (i === 0) return `<td style="padding-left:${6 + n.level * 14}px">${esc(`${lbl}: ${n.val} (${n.count})`)}</td>`;
                const agg = isNum(c) ? groupAgg(c, footerAggs) : null;
                if (!agg) return '<td></td>';
                return cell(c, fmtAgg(aggregate(collectLeafValues(n, c.key), agg), agg, true));
            }).join('')}</tr>`);
            if (!collapsedGroups.has(n.path)) walk(n.children);
        });
        walk(displayTree);
        const pin = list => list.map(p => `<tr class="p">${cols.map(c => cell(c, p[c.key] ?? '')).join('')}</tr>`).join('');
        const foot = cols.some(c => footerAggs[c.key] && footerAggs[c.key] !== 'none')
            ? `<tr class="f">${cols.map(c => { const agg = footerAggs[c.key] || 'none'; const r = aggregate(sorted.map(x => x[c.key]), agg); return cell(c, r === null ? '' : `${fmtAgg(r, agg, isNum(c))}`); }).join('')}</tr>` : '';
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Report')}</title><style>
            body{font:12px Segoe UI,Arial,sans-serif;margin:16px}h3{margin:0 0 4px}p{margin:0 0 8px;color:#555}
            table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 6px;vertical-align:top}th{background:#eee;text-align:left}
            td.n{text-align:right;font-variant-numeric:tabular-nums}.g td{font-weight:600}.g0 td{background:#e3e3e3}.g1 td{background:#efefef}.g2 td{background:#f7f7f7}
            .f td,.p td{font-weight:700;background:#f3f1e7}@media print{button{display:none}}</style></head><body>
            <h3>${esc(title || document.title)}</h3><p>${sorted.length} of ${rows.length} rows${activeGroupKeys.length ? ` · grouped by ${activeGroupKeys.map(k => esc(allColumns.find(c => c.key === k)?.label || k)).join(' › ')}` : ''} · printed ${new Date().toLocaleString()}</p>
            <table><thead><tr>${cols.map(c => `<th${isNum(c) ? ' style="text-align:right"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody>${pin(pinnedTop)}${out.join('')}</tbody><tfoot>${pin(pinnedBottom)}${foot}</tfoot></table>
            <script>setTimeout(function(){window.print()},300)</script></body></html>`);
        w.document.close();
    };

    const printPivot = () => {
        const m = pivotMatrix();
        const num = v => (typeof v === 'number' ? fmtAgg(v, 'sum', true) : v ?? '');
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Pivot')}</title><style>
            body{font:12px Segoe UI,Arial,sans-serif;margin:16px}h3{margin:0 0 4px}p{margin:0 0 8px;color:#555}table{border-collapse:collapse;width:100%}
            th,td{border:1px solid #bbb;padding:3px 6px}th{background:#eee}td.n{text-align:right;font-variant-numeric:tabular-nums}tr.g td{font-weight:600;background:#f1f1f1}tr.t td{font-weight:700;background:#f3f1e7}</style></head><body>
            <h3>${esc(title || document.title)} - pivot</h3><p>Rows: ${esc(activeGroupKeys.map(labelOf).join(' › ') || '-')} · Columns: ${esc(activePivotCols.map(labelOf).join(' › ') || '-')} · ${sorted.length} rows · printed ${new Date().toLocaleString()}</p>
            <table><thead><tr>${m.head.map((h, i) => `<th${i ? ' style="text-align:right"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${m.body.map((r, j) => `<tr${m.groupRows[j] ? ' class="g"' : ''}>${r.map((v, i) => (i ? `<td class="n">${esc(num(v))}</td>` : `<td style="white-space:pre">${esc(v)}</td>`)).join('')}</tr>`).join('')}</tbody>
            <tfoot><tr class="t">${m.total.map((v, i) => (i ? `<td class="n">${esc(num(v))}</td>` : `<td>${esc(v)}</td>`)).join('')}</tr></tfoot></table>
            <script>setTimeout(function(){window.print()},300)</script></body></html>`);
        w.document.close();
    };

    // ---------- pivot areas: move a field between Filters / Columns / Rows / Values ----------
    const areas = { filt: [...new Set([...filterFields, ...Object.keys(valueFilters).filter(k => valueFilters[k])])].filter(k => allColumns.some(c => c.key === k)), cols: activePivotCols, rows: activeGroupKeys, vals: activeValues.map(v => v.key) };
    const setArea = (area, fn) => {
        if (area === 'rows') { setGroupByKeys(fn); setCollapsedGroups(new Set()); }
        else if (area === 'cols') setPivotCols(fn);
        else if (area === 'filt') setFilterFields(fn);
        else if (area === 'vals') setPivotValues(list => { const keys = fn(list.map(v => v.key)); return keys.map(k => list.find(v => v.key === k) || { key: k, agg: allColumns.find(c => c.key === k && isNum(c)) ? 'sum' : 'count' }); });
    };
    const removeFromArea = (area, key) => {
        setArea(area, list => list.filter(k => k !== key));
        if (area === 'filt') setValueFilters(v => ({ ...v, [key]: null }));
    };
    /** drop payload "col:<key>" (header / field list) or "area:<from>:<key>" (a chip) into `area`, before `beforeKey` */
    const dropInto = (area, payload, beforeKey) => {
        let key, from = null;
        if (payload.startsWith('col:')) key = payload.slice(4);
        else if (payload.startsWith('area:')) { const [, a, ...k] = payload.split(':'); from = a; key = k.join(':'); }
        else if (payload.startsWith('chip:')) { from = 'rows'; key = activeGroupKeys[parseInt(payload.slice(5), 10)]; }
        if (!key || !allColumns.some(c => c.key === key)) return;
        if (from && from !== area && from !== 'filt') setArea(from, list => list.filter(k => k !== key));
        // a field is a row or a column, not both
        if (area === 'rows' && from !== 'cols') setPivotCols(l => l.filter(k => k !== key));
        if (area === 'cols' && from !== 'rows') { setGroupByKeys(l => l.filter(k => k !== key)); setCollapsedGroups(new Set()); }
        setArea(area, list => {
            const rest = list.filter(k => k !== key);
            const at = beforeKey ? rest.indexOf(beforeKey) : -1;
            if (at < 0) return [...rest, key];
            return [...rest.slice(0, at), key, ...rest.slice(at)];
        });
    };
    const openValueFilter = (key, el) => {
        const r = el.getBoundingClientRect();
        setFilterMenu({ key, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
    };
    const reorderField = (key, beforeKey) => setColumnsConfig(cfg => {
        const list = [...cfg].sort((a, b) => a.order - b.order).filter(c => c.key !== key);
        const at = list.findIndex(c => c.key === beforeKey);
        const moved = cfg.find(c => c.key === key);
        if (!moved) return cfg;
        list.splice(at < 0 ? list.length : at, 0, moved);
        return list.map((c, i) => ({ ...c, order: i }));
    });

    // ---------- multi-level grouping: add/remove/reorder ----------
    const addGroupKey = (key) => {
        setGroupByKeys(keys => keys.includes(key) ? keys : [...keys, key]);
        setCollapsedGroups(new Set());
    };
    const removeGroupKey = (key) => {
        setGroupByKeys(keys => keys.filter(k => k !== key));
        setCollapsedGroups(new Set());
    };
    const reorderGroupKey = (fromIndex, toIndex) => {
        setGroupByKeys(keys => {
            if (fromIndex < 0 || fromIndex >= keys.length || toIndex < 0 || toIndex >= keys.length) return keys;
            const arr = [...keys];
            const [moved] = arr.splice(fromIndex, 1);
            arr.splice(toIndex, 0, moved);
            return arr;
        });
        setCollapsedGroups(new Set());
    };
    const toggleCollapse = (path) => setCollapsedGroups(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
    });
    /** show groups down to `level` (0 = only the outer groups) */
    const expandToLevel = level => setCollapsedGroups(new Set(collectGroupPaths(displayTree, level)));

    // ---------- right-click column context menu ----------
    const openContextMenu = (e, colKey) => {
        e.preventDefault();
        setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 380), colKey });
    };

    // ---------- keyboard cell navigation + opt-in inline editing ----------
    const moveFocus = (rowId, colKey, dRow, dCol) => {
        const rIdx = visibleRowIds.indexOf(rowId);
        const cIdx = visibleColumns.findIndex(c => c.key === colKey);
        let newR = rIdx + dRow, newC = cIdx + dCol;
        if (newC >= visibleColumns.length) { newC = 0; newR++; }
        if (newC < 0) { newC = visibleColumns.length - 1; newR--; }
        if (newR < 0 || newR >= visibleRowIds.length) return;
        const targetId = visibleRowIds[newR];
        const targetCol = visibleColumns[newC].key;
        const el = document.querySelector(`[data-cell-id="${window.CSS && CSS.escape ? CSS.escape(targetId + ':' + targetCol) : targetId + ':' + targetCol}"]`);
        el?.focus();
    };
    const handleCellKeyDown = (e, rowId, colKey) => {
        switch (e.key) {
            case 'Enter': e.preventDefault(); moveFocus(rowId, colKey, e.shiftKey ? -1 : 1, 0); break;
            case 'Tab': e.preventDefault(); moveFocus(rowId, colKey, 0, e.shiftKey ? -1 : 1); break;
            case 'ArrowDown': e.preventDefault(); moveFocus(rowId, colKey, 1, 0); break;
            case 'ArrowUp': e.preventDefault(); moveFocus(rowId, colKey, -1, 0); break;
            case 'ArrowRight': e.preventDefault(); moveFocus(rowId, colKey, 0, 1); break;
            case 'ArrowLeft': e.preventDefault(); moveFocus(rowId, colKey, 0, -1); break;
            case 'Home': e.preventDefault(); moveFocus(rowId, visibleColumns[0]?.key, 0, 0); break;
            default: break;
        }
    };
    const startEdit = (row, col) => {
        if (!col.editable || !onCellEdit) return;
        setEditingCell({ rowId: row.__id, colKey: col.key });
        setEditValue(row[col.key] ?? '');
    };
    const commitEdit = (row, col) => {
        if (editValue !== (row[col.key] ?? '') && onCellEdit) onCellEdit(row, col.key, editValue);
        setEditingCell(null);
    };
    const cancelEdit = () => setEditingCell(null);

    const numericColumns = allColumns.filter(isNum);
    const hasWidths = Object.keys(columnWidths).length > 0;
    const effectiveChart = useMemo(() => {
        if (chartCfg || !chartOn) return chartCfg;
        const d = defaultChartConfig(allColumns, enrichedRows, activeGroupKeys);
        // in the pivot view the chart follows it: X = first row field, series = first column field, Y = first value
        if (pivotMode) return { ...d, x: activeGroupKeys[0] || activePivotCols[0] || d.x, split: activeGroupKeys[0] ? activePivotCols[0] || '' : '', values: activeValues.length ? [activeValues[0].key] : [], agg: activeValues[0]?.agg || 'count', bucket: 'none', order: 'value', top: 12 };
        return d;
    }, [chartCfg, chartOn, allColumns, enrichedRows, activeGroupKeys, pivotMode, activePivotCols, activeValues]);
    const drill = (key, value) => setValueFilters(v => ({ ...v, [key]: new Set([cellKey(value)]) }));
    const tbtn = on => `rg-tb px-2 py-1 border rounded text-xs whitespace-nowrap ${on ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white hover:bg-gray-50'}`;
    const fitColumns = () => {
        // widths from the longest text of each column (header / 200 rows), 60-360px
        const w = {};
        visibleColumns.forEach(c => {
            const longest = sorted.slice(0, 200).reduce((m, r) => Math.max(m, String(plainText(c, r) ?? '').length), String(c.label).length + 3);
            w[c.key] = Math.max(60, Math.min(360, Math.round(longest * 7.2 + 26)));
        });
        setColumnWidths(w); setAutoWidth(false);
    };
    const labelOf = k => allColumns.find(c => c.key === k)?.label || k;

    const activeFilterCount = filters.length + Object.values(valueFilters).filter(Boolean).length + (search ? 1 : 0);
    const barsOn = Object.values(dataBars).filter(Boolean).length;
    const orderToggle = key => (
        <span title="Order of the groups (A→Z / Z→A)" className="cursor-pointer" onClick={() => setGroupSort(g => ({ ...g, [key]: { ...(g[key] || { by: 'label' }), dir: (g[key]?.dir || 'asc') === 'asc' ? 'desc' : 'asc' } }))}>{(groupSort[key]?.dir || 'asc') === 'asc' ? '▲' : '▼'}</span>
    );
    const valueAgg = key => (
        <select className="text-[10px] border rounded px-0.5 bg-white" value={activeValues.find(v => v.key === key)?.agg || 'sum'} onClick={e => e.stopPropagation()}
            onChange={e => setPivotValues(l => l.map(v => (v.key === key ? { ...v, agg: e.target.value } : v)))}>
            {NUMERIC_AGGS.map(g => <option key={g} value={g}>{AGG_LABELS[g]}</option>)}
        </select>
    );

    return (
        <div ref={rootRef} className="w-full text-sm rg-root" data-rg-key={storageKey}>
            {/* FEATURE: one thin line of drop areas - ☰ Rows (group by) and ⫼ Columns
                (pivot). Drag a column header in, drag a chip from Rows to Columns
                and back; Σ Values shows once the pivot is on. */}
            <div className="flex flex-wrap items-stretch gap-1.5 mb-1" data-no-view>
                <div className="flex-[2] min-w-[240px]">
                    <AreaDrop compact area="rows" label="☰ Rows:" hint="drag a column header here to group" items={areas.rows} labelOf={labelOf}
                        onDrop={(d, b) => dropInto('rows', d, b)} onRemove={k => removeFromArea('rows', k)} renderExtra={orderToggle} />
                </div>
                <div className="flex-1 min-w-[200px]">
                    <AreaDrop compact area="cols" label="⫼ Columns:" hint="drag here - values become columns" items={areas.cols} labelOf={labelOf}
                        onDrop={(d, b) => dropInto('cols', d, b)} onRemove={k => removeFromArea('cols', k)} />
                </div>
                {(pivotMode || panel === 'fields') && (
                    <div className="flex-1 min-w-[180px]">
                        <AreaDrop compact area="vals" label="Σ Values:" hint="number field (else Count)" items={areas.vals} labelOf={labelOf}
                            onDrop={(d, b) => dropInto('vals', d, b)} onRemove={k => removeFromArea('vals', k)} renderExtra={valueAgg} />
                    </div>
                )}
                {activeGroupKeys.length > 0 && (
                    <div className="flex items-center gap-1 text-[11px]">
                        <button onClick={() => expandToLevel(0)} className="px-1.5 py-0.5 border rounded bg-white hover:bg-gray-50" title="Collapse all groups">⊟</button>
                        <button onClick={() => setCollapsedGroups(new Set())} className="px-1.5 py-0.5 border rounded bg-white hover:bg-gray-50" title="Expand all groups">⊞</button>
                    </div>
                )}
            </div>

            {/* toolbar: one line; every panel opens as a pop-up under it */}
            <div ref={toolRef} className="relative flex flex-wrap items-center gap-1 mb-1.5 bg-[#f4f2ea] border border-gray-300 rounded px-1.5 py-1" data-no-view data-enter-nav="off">
                {toolbarExtra}
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Search…" className="w-40 border rounded px-2 py-1 text-xs" />
                <button onClick={() => setPanel(p => (p === 'filter' ? null : 'filter'))} className={tbtn(panel === 'filter' || activeFilterCount > 0)} title="Conditions, and the values picked in ▾ / Filters">🔽 Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
                <button onClick={() => setAutoFilterOn(o => !o)} className={tbtn(autoFilterOn)} title="A filter box under every header: text, > 1000, < 50, = value; ▾ picks values">📋 AutoFilter</button>
                <button onClick={() => setPanel(p => (p === 'groupsort' ? null : 'groupsort'))} className={tbtn(panel === 'groupsort' || sorts.length > 1)} title="Sort levels and group levels">⇅ Manager</button>
                <button onClick={() => setPanel(p => (p === 'footer' ? null : 'footer'))} className={tbtn(panel === 'footer')}>Σ Footer</button>
                <button onClick={() => { if (hasWidths) { setColumnWidths({}); setAutoWidth(true); } else fitColumns(); }} className={tbtn(hasWidths)} title={hasWidths ? 'Back to automatic widths' : 'Fit every column to its content'}>↔ Fit</button>
                <button onClick={() => setPanel(p => (p === 'fields' ? null : 'fields'))} className={tbtn(panel === 'fields' || pivotMode)} title="Field Selector: show / hide columns, Filters / Columns / Rows / Values (pivot)">📋 Columns</button>
                <button onClick={() => setChartOn(o => !o)} className={tbtn(chartOn)} title="Chart / pivot chart of the rows shown">📊 Chart</button>
                {!pivotMode && <button onClick={() => setPanel(p => (p === 'highlight' ? null : 'highlight'))} className={tbtn(panel === 'highlight' || highlightRules.length + barsOn > 0)}>🎨 Highlight{highlightRules.length + barsOn ? ` (${highlightRules.length + barsOn})` : ''}</button>}
                {pivotMode && <button onClick={() => setHeat(h => !h)} className={tbtn(heat)} title="Shade each pivot cell by its size">🌡 Heat map</button>}
                <button onClick={() => setPanel(p => (p === 'addColumn' ? null : 'addColumn'))} className={tbtn(panel === 'addColumn')} title="Running balance, % of total, formula">➕ Column</button>
                <button onClick={exportCSV} className={tbtn(false)}>⬇ CSV</button>
                <button onClick={printGrid} className={tbtn(false)} title="Print as shown (groups, sub-totals, footer / the pivot)">🖨 Print</button>
                <button onClick={() => applyState(null)} className={tbtn(false)}>↺ Reset</button>

                {panel === 'fields' && (
                    <Pop anchor={toolRef} width={370} right pad={false}><FieldSelector columns={allColumns} columnsConfig={columnsConfig} onToggle={toggleColumnVisible} onReorder={reorderField}
                        onShowAll={() => setColumnsConfig(cfg => cfg.map(c => ({ ...c, visible: true })))}
                        areas={areas} onDrop={dropInto} onRemove={removeFromArea} onFilterChip={openValueFilter}
                        filterCount={Object.values(valueFilters).filter(Boolean).length} values={activeValues}
                        onValueAgg={(key, agg) => setPivotValues(l => l.map(v => (v.key === key ? { ...v, agg } : v)))}
                        showGrouped={showGrouped} setShowGrouped={setShowGrouped} onClose={() => setPanel(null)} /></Pop>
                )}

                {panel === 'filter' && (
                    <Pop anchor={toolRef}>
                        <div className="flex items-center justify-between mb-1"><b className="text-xs text-gray-600">Filters (all must match)</b><button className="text-gray-500" onClick={() => setPanel(null)}>✕</button></div>
                        {(search || Object.values(valueFilters).some(Boolean)) && (
                            <div className="mb-2 space-y-0.5">
                                {search && <div className="flex justify-between text-xs"><span>Search "{search}"</span><button className="text-red-600" onClick={() => setSearch('')}>✕</button></div>}
                                {Object.entries(valueFilters).filter(([, v]) => v).map(([k, v]) => (
                                    <div key={k} className="flex justify-between items-center text-xs gap-2">
                                        <button className="text-left underline truncate" onClick={e => openValueFilter(k, e.currentTarget)}>{labelOf(k)}: {v.size === 1 ? Array.from(v)[0] : `${v.size} values`}</button>
                                        <button className="text-red-600" onClick={() => setValueFilters(x => ({ ...x, [k]: null }))}>✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {filters.map((f, i) => (
                            <div key={i} className="flex flex-wrap gap-1 items-center text-xs mb-1">
                                <select value={f.key} onChange={e => updateFilter(i, { key: e.target.value })} className="border rounded px-1 py-1 max-w-[140px]">
                                    {allColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                                </select>
                                <select value={f.operator} onChange={e => updateFilter(i, { operator: e.target.value })} className="border rounded px-1 py-1">
                                    {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                {needsValue(f.operator) && <input value={f.value} onChange={e => updateFilter(i, { value: e.target.value })} placeholder={f.operator === 'between' ? 'from..to' : 'Value'} className="border rounded px-1 py-1 flex-1 min-w-[80px]" />}
                                <button onClick={() => removeFilter(i)} className="text-red-500">✕</button>
                            </div>
                        ))}
                        <div className="flex flex-wrap gap-1 pt-1">
                            <button onClick={addFilter} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">➕ Condition</button>
                            <select className="border rounded px-1 py-1 text-xs" value="" onChange={e => { const k = e.target.value; if (!k) return; setFilterFields(l => (l.includes(k) ? l : [...l, k])); openValueFilter(k, e.target); }}>
                                <option value="">☑ Pick values of…</option>
                                {allColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                            {activeFilterCount > 0 && <button onClick={() => { setValueFilters({}); setFilters([]); setSearch(''); }} className="px-2 py-1 border rounded text-xs">Clear all</button>}
                        </div>
                    </Pop>
                )}

                {/* FEATURE: Group & Sort manager - every sort level and group
                    level in one place, with the order of each level's groups. */}
                {panel === 'groupsort' && (
                    <Pop anchor={toolRef} width={780}><div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1">Sort levels (Shift+click a header adds a level)</p>
                            {sorts.map((s, i) => (
                                <div key={s.key} className="flex items-center gap-2 py-0.5 text-xs">
                                    <span className="w-4 text-gray-400">{i + 1}.</span>
                                    <span className="flex-1 truncate">{labelOf(s.key)}</span>
                                    <select className="border rounded px-1 py-0.5" value={s.dir} onChange={e => setSorts(l => l.map((x, j) => (j === i ? { ...x, dir: e.target.value } : x)))}><option value="asc">A → Z / small → big</option><option value="desc">Z → A / big → small</option></select>
                                    <button className="text-gray-400 hover:text-gray-700" onClick={() => setSorts(l => { if (!i) return l; const a = [...l]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })}>↑</button>
                                    <button className="text-gray-400 hover:text-gray-700" onClick={() => setSorts(l => { if (i >= l.length - 1) return l; const a = [...l]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })}>↓</button>
                                    <button className="text-red-500" onClick={() => setSorts(l => l.filter((_, j) => j !== i))}>✕</button>
                                </div>
                            ))}
                            <select className="border rounded px-2 py-1 text-xs mt-1" value="" onChange={e => e.target.value && setSorts(l => [...l.filter(x => x.key !== e.target.value), { key: e.target.value, dir: 'asc' }])}>
                                <option value="">➕ Add sort level…</option>
                                {allColumns.filter(c => !sorts.some(s => s.key === c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                            {sorts.length > 0 && <button className="ml-2 text-xs underline" onClick={() => setSorts([])}>Clear sort</button>}
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1">Group levels (Rows, outer first) and the order of their groups</p>
                            {activeGroupKeys.map((k, i) => {
                                const gs = groupSort[k] || { by: 'label', dir: 'asc' };
                                return (
                                    <div key={k} className="flex flex-wrap items-center gap-1 py-0.5 text-xs">
                                        <span className="w-4 text-gray-400">{i + 1}.</span>
                                        <span className="flex-1 truncate min-w-[70px]">{labelOf(k)}</span>
                                        <select className="border rounded px-1 py-0.5" value={gs.by} onChange={e => setGroupSort(g => ({ ...g, [k]: { ...gs, by: e.target.value } }))}>
                                            <option value="label">by name</option><option value="__count">by row count</option>
                                            {numericColumns.map(c => <option key={c.key} value={c.key}>by Sum of {c.label}</option>)}
                                        </select>
                                        <select className="border rounded px-1 py-0.5" value={gs.dir} onChange={e => setGroupSort(g => ({ ...g, [k]: { ...gs, dir: e.target.value } }))}><option value="asc">ascending</option><option value="desc">descending</option></select>
                                        <button className="text-gray-400 hover:text-gray-700" onClick={() => reorderGroupKey(i, i - 1)}>↑</button>
                                        <button className="text-gray-400 hover:text-gray-700" onClick={() => reorderGroupKey(i, i + 1)}>↓</button>
                                        <button className="text-red-500" onClick={() => removeGroupKey(k)}>✕</button>
                                    </div>
                                );
                            })}
                            <select className="border rounded px-2 py-1 text-xs mt-1" value="" onChange={e => e.target.value && dropInto('rows', `col:${e.target.value}`, null)}>
                                <option value="">➕ Add group level…</option>
                                {allColumns.filter(c => !activeGroupKeys.includes(c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                            <label className="ml-2 text-xs"><input type="checkbox" checked={showGrouped} onChange={e => setShowGrouped(e.target.checked)} /> Show Grouped</label>
                            {activeGroupKeys.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                                    <span className="text-gray-500">Show:</span>
                                    {activeGroupKeys.map((k, i) => <button key={k} className="underline" onClick={() => expandToLevel(i + 1)}>to level {i + 1}</button>)}
                                    <button className="underline" onClick={() => setCollapsedGroups(new Set())}>all rows</button>
                                </div>
                            )}
                        </div>
                    </div></Pop>
                )}

                {panel === 'highlight' && (
                    <Pop anchor={toolRef}>
                        <p className="text-xs font-semibold text-gray-500 mb-1">Highlight rows where…</p>
                        {highlightRules.map((h, i) => (
                            <div key={i} className="flex flex-wrap gap-1 items-center text-xs mb-1">
                                <select value={h.key} onChange={e => updateHighlight(i, { key: e.target.value })} className="border rounded px-1 py-1 max-w-[130px]">
                                    {allColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                                </select>
                                <select value={h.operator} onChange={e => updateHighlight(i, { operator: e.target.value })} className="border rounded px-1 py-1">
                                    {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                {needsValue(h.operator) && <input value={h.value} onChange={e => updateHighlight(i, { value: e.target.value })} placeholder="Value" className="border rounded px-1 py-1 flex-1 min-w-[70px]" />}
                                <input type="color" value={h.color} onChange={e => updateHighlight(i, { color: e.target.value })} className="w-7 h-7 border rounded" />
                                <button onClick={() => removeHighlight(i)} className="text-red-500">✕</button>
                            </div>
                        ))}
                        <button onClick={addHighlight} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">➕ Rule</button>
                        {numericColumns.length > 0 && (
                            <div className="pt-2 mt-2 border-t border-gray-100">
                                <p className="text-xs font-semibold text-gray-500 mb-1">Data bars (a bar in the cell, size = value; red = minus)</p>
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {numericColumns.map(c => <label key={c.key} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!dataBars[c.key]} onChange={e => setDataBars(d => ({ ...d, [c.key]: e.target.checked }))} /> {c.label}</label>)}
                                </div>
                            </div>
                        )}
                    </Pop>
                )}

                {/* FEATURE: Footer Options - an aggregate per column (numbers:
                    Sum/Average/Min/Max too; text: Count/Distinct/First/Last). */}
                {panel === 'footer' && (
                    <Pop anchor={toolRef} width={760}>
                        <p className="text-xs font-semibold text-gray-500 mb-1">Footer aggregate per column (group rows use the same, Sum when none)</p>
                        <div className="max-h-64 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                            {visibleColumns.map(c => (
                                <div key={c.key} className="flex items-center gap-2 text-xs">
                                    <span className="w-32 truncate">{c.label}</span>
                                    <select value={footerAggs[c.key] || 'none'} onChange={e => setFooterAggs(x => ({ ...x, [c.key]: e.target.value }))} className="border rounded px-1 py-0.5 flex-1">
                                        <option value="none">— None —</option>
                                        {(isNum(c) ? NUMERIC_AGGS : TEXT_AGGS).map(k => <option key={k} value={k}>{AGG_LABELS[k]}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1 pt-2 mt-2 border-t border-gray-100">
                            <button onClick={() => setFooterAggs(Object.fromEntries(numericColumns.map(c => [c.key, 'sum'])))} className="px-2 py-1 border rounded text-xs hover:bg-gray-50">Σ All Sum</button>
                            <button onClick={() => setFooterAggs(Object.fromEntries(numericColumns.map(c => [c.key, 'avg'])))} className="px-2 py-1 border rounded text-xs hover:bg-gray-50">x̄ All Average</button>
                            <button onClick={() => setFooterAggs(Object.fromEntries(visibleColumns.map(c => [c.key, 'count'])))} className="px-2 py-1 border rounded text-xs hover:bg-gray-50"># All Count</button>
                            <button onClick={() => setFooterAggs({})} className="px-2 py-1 border border-red-300 text-red-600 rounded text-xs hover:bg-red-50">✕ Clear All</button>
                        </div>
                    </Pop>
                )}

                {panel === 'addColumn' && (
                    <Pop anchor={toolRef} width={560} right><AddColumnPanel numericColumns={numericColumns} onAdd={addCustomColumn} onClose={() => setPanel(null)} /></Pop>
                )}
            </div>

            {chartOn && effectiveChart && (
                <GridChartPanel columns={allColumns} rows={sorted} config={effectiveChart} onChange={setChartCfg} onDrill={drill} onClose={() => setChartOn(false)} title={title || storageKey} />
            )}

            {historyOf && <RecordHistory table={auditTable} id={historyOf.id} title={historyOf.title} onClose={() => setHistoryOf(null)} />}
            {filterMenu && (
                <ExcelFilterMenu anchor={filterMenu.anchor} title={labelOf(filterMenu.key)}
                    values={distinctValues(enrichedRows.map(r => r[filterMenu.key]))} selected={valueFilters[filterMenu.key] || null}
                    onApply={allowed => setValueFilters(v => ({ ...v, [filterMenu.key]: allowed }))}
                    onSort={dir => setSorts([{ key: filterMenu.key, dir }])}
                    onHide={() => setColumnsConfig(cfg => cfg.map(c => (c.key === filterMenu.key ? { ...c, visible: false } : c)))}
                    onClose={() => setFilterMenu(null)} />
            )}
            <div className="overflow-x-auto border border-gray-300 rounded bg-white max-h-[75vh] overflow-y-auto" data-enter-nav="off" data-excel-managed="true">
                {pivot ? (
                    <PivotView pv={pivot} rowKeys={activeGroupKeys} colKeys={activePivotCols} labelOf={labelOf} collapsed={collapsedGroups} toggle={toggleCollapse} heat={heat} />
                ) : (
                <table className={autoWidth ? 'w-full' : 'min-w-[900px]'} style={hasWidths ? { tableLayout: 'fixed' } : undefined}>
                    {hasWidths && (
                        <colgroup>
                            {visibleColumns.map(col => <col key={col.key} style={columnWidths[col.key] ? { width: columnWidths[col.key] } : undefined} />)}
                            {rowActions && <col />}
                        </colgroup>
                    )}
                    <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                            {visibleColumns.map(col => {
                                const si = sortOf(col.key);
                                return (
                                    <th
                                        key={col.key}
                                        draggable
                                        onDragStart={e => e.dataTransfer.setData('text/plain', 'col:' + col.key)}
                                        onClick={e => toggleSort(col.key, e.shiftKey)}
                                        onContextMenu={e => openContextMenu(e, col.key)}
                                        title="Click: sort · Shift+click: add sort level · drag to ☰ Rows / ⫼ Columns · right-click: menu"
                                        className={`px-2 py-1 text-xs font-semibold text-gray-700 border-b border-gray-300 cursor-pointer select-none whitespace-nowrap ${isNum(col) ? 'text-right' : 'text-left'}`}
                                    >
                                        {col.label}{si >= 0 && (sorts[si].dir === 'asc' ? ' ▲' : ' ▼')}{si >= 0 && sorts.length > 1 && <sup>{si + 1}</sup>}{activeGroupKeys.includes(col.key) && showGrouped && ` 📌${activeGroupKeys.indexOf(col.key) + 1}`}
                                        <button type="button" data-enter-skip title="Filter (pick values) / sort / hide"
                                            className={`rg-xf ml-1 px-0.5 rounded text-[10px] border ${valueFilters[col.key] ? 'on bg-blue-600 text-white border-blue-600' : 'text-gray-500 border-gray-300'}`}
                                            onClick={e => { e.stopPropagation(); openValueFilter(col.key, e.currentTarget); }}>▾</button>
                                    </th>
                                );
                            })}
                            {rowActions && <th className="px-2 py-1 border-b border-gray-300"></th>}
                        </tr>
                        {autoFilterOn && (
                            <tr className="bg-white">
                                {visibleColumns.map(col => (
                                    <th key={col.key} className="px-1 py-0.5 border-b border-gray-200 font-normal">
                                        <div className="flex items-center gap-0.5">
                                            <input
                                                value={autoFilterValues[col.key] || ''}
                                                onChange={e => setAutoFilterValues(v => ({ ...v, [col.key]: e.target.value }))}
                                                placeholder={isNum(col) ? '> 1000' : 'filter…'}
                                                className="w-full min-w-[50px] border rounded px-1 py-0.5 text-[11px] font-normal"
                                            />
                                            <button type="button" data-enter-skip title="Pick one or more values" onClick={e => openValueFilter(col.key, e.currentTarget)}
                                                className={`px-1 rounded text-[10px] border ${valueFilters[col.key] ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-500 border-gray-300'}`}>{valueFilters[col.key] ? valueFilters[col.key].size : '▾'}</button>
                                        </div>
                                    </th>
                                ))}
                                {rowActions && <th className="px-1 py-0.5 border-b border-gray-200"></th>}
                            </tr>
                        )}
                    </thead>
                    <tbody>
                        {pinnedTop.map((p, i) => (
                            <tr key={`pt${i}`} className="bg-amber-50 font-semibold border-b border-amber-200" title="From the report - not filtered">
                                {visibleColumns.map(col => <td key={col.key} className={`px-2 py-1 whitespace-nowrap ${isNum(col) ? 'text-right tabular-nums' : ''}`}>{p[col.key] ?? ''}</td>)}
                                {rowActions && <td />}
                            </tr>
                        ))}
                        {sorted.length === 0 && (
                            <tr><td colSpan={visibleColumns.length + (rowActions ? 1 : 0)} className="text-center py-8 text-gray-400">No records found.</td></tr>
                        )}
                        {sorted.length > 0 && displayTree.flatMap(node => renderGroupNode(node, {
                            visibleColumns, rowActions, collapsedGroups, toggleCollapse, rowHighlightColor, allColumns, footerAggs, dataBars, barMax, onCellClick, onCellDoubleClick, rowClassName,
                            editingCell, editValue, setEditValue, startEdit, commitEdit, cancelEdit, onCellEdit, moveFocus, handleCellKeyDown
                        }))}
                    </tbody>
                    <tfoot>
                        {pinnedBottom.map((p, i) => (
                            <tr key={`pb${i}`} className="bg-amber-50 font-semibold border-t border-amber-300" title="Report total - from the report, not filtered">
                                {visibleColumns.map(col => <td key={col.key} className={`px-2 py-1 whitespace-nowrap ${isNum(col) ? 'text-right tabular-nums' : ''}`}>{p[col.key] ?? ''}</td>)}
                                {rowActions && <td />}
                            </tr>
                        ))}
                        <tr className="rg-footer font-semibold sticky bottom-0">
                            {visibleColumns.map((col, i) => {
                                const agg = footerAggs[col.key] || 'none';
                                const result = aggregate(sorted.map(r => r[col.key]), agg);
                                const options = isNum(col) ? NUMERIC_AGGS : TEXT_AGGS;
                                return (
                                    <td key={col.key} className="px-1.5 py-0.5 text-xs align-top">
                                        <div className={`flex flex-col gap-0.5 ${isNum(col) ? 'items-end' : ''}`}>
                                            {result !== null
                                                ? <span className="text-xs font-bold truncate tabular-nums" title={AGG_LABELS[agg]}><span className="text-[9px] font-normal text-gray-500 mr-1">{AGG_LABELS[agg].toUpperCase()}</span>{fmtAgg(result, agg, isNum(col))}</span>
                                                : i === 0 && <span className="text-gray-600 text-[10px] uppercase">Footer ({sorted.length})</span>}
                                            <select
                                                value={agg}
                                                onChange={e => setFooterAggs(x => ({ ...x, [col.key]: e.target.value }))}
                                                className="bg-white text-gray-700 border border-gray-400 rounded text-[10px] px-0.5 py-0"
                                            >
                                                <option value="none">— None —</option>
                                                {options.map(k => <option key={k} value={k}>{AGG_LABELS[k]}</option>)}
                                            </select>
                                        </div>
                                    </td>
                                );
                            })}
                            {rowActions && <td className="rg-footer"></td>}
                        </tr>
                    </tfoot>
                </table>
                )}
            </div>

            {/* FEATURE: right-click column context menu - the same sort/
                group/width/collapse actions the toolbar offers, reachable
                without leaving the header row. */}
            {contextMenu && (
                <div
                    className="fixed bg-white border border-gray-300 rounded-lg shadow-lg z-50 py-1 text-sm min-w-[210px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-3 py-1 text-[11px] text-gray-500 border-b">{labelOf(contextMenu.colKey)}</div>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setSorts([{ key: contextMenu.colKey, dir: 'asc' }]); setContextMenu(null); }}>⬆ Sort Up</button>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setSorts([{ key: contextMenu.colKey, dir: 'desc' }]); setContextMenu(null); }}>⬇ Sort Down</button>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { toggleSort(contextMenu.colKey, true); setContextMenu(null); }}>➕ Add as next sort level</button>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setSorts([]); setContextMenu(null); }}>↺ Clear Sort</button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { dropInto('rows', `col:${contextMenu.colKey}`, null); setContextMenu(null); }}>☰ Group By (to Rows){activeGroupKeys.includes(contextMenu.colKey) ? ' ✓' : ''}</button>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { dropInto('cols', `col:${contextMenu.colKey}`, null); setContextMenu(null); }}>⫼ Values as Columns (pivot){activePivotCols.includes(contextMenu.colKey) ? ' ✓' : ''}</button>
                    {allColumns.find(c => c.key === contextMenu.colKey && isNum(c)) && (
                        <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { dropInto('vals', `col:${contextMenu.colKey}`, null); setContextMenu(null); }}>Σ Add to Values (pivot)</button>
                    )}
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { removeGroupKey(contextMenu.colKey); setPivotCols(l => l.filter(k => k !== contextMenu.colKey)); setContextMenu(null); }}>✕ Remove from Rows / Columns</button>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setChartCfg({ ...(effectiveChart || defaultChartConfig(allColumns, enrichedRows, activeGroupKeys)), x: contextMenu.colKey, bucket: 'none', order: 'value', top: 12 }); setChartOn(true); setContextMenu(null); }}>📊 Chart by this column</button>
                    {allColumns.find(c => c.key === contextMenu.colKey && isNum(c)) && (
                        <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setDataBars(d => ({ ...d, [contextMenu.colKey]: !d[contextMenu.colKey] })); setContextMenu(null); }}>▬ Data bars {dataBars[contextMenu.colKey] ? '✓' : ''}</button>
                    )}
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setColumnsConfig(cfg => cfg.map(c => (c.key === contextMenu.colKey ? { ...c, visible: false } : c))); setContextMenu(null); }}>🙈 Hide Column</button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => {
                        const w = window.prompt('Width in pixels:', String(columnWidths[contextMenu.colKey] || 150));
                        if (w && !isNaN(parseInt(w, 10))) setColumnWidths(cw => ({ ...cw, [contextMenu.colKey]: parseInt(w, 10) }));
                        setContextMenu(null);
                    }}>📏 Set Width</button>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setColumnWidths(cw => { const n = { ...cw }; delete n[contextMenu.colKey]; return n; }); setContextMenu(null); }}>↺ Reset Width</button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setCollapsedGroups(new Set(collectGroupPaths(displayTree))); setContextMenu(null); }}>📁 Collapse All</button>
                    <button className="w-full text-left px-3 py-1 hover:bg-gray-50" onClick={() => { setCollapsedGroups(new Set()); setContextMenu(null); }}>📂 Expand All</button>
                </div>
            )}

            <div className="mt-1 text-xs text-gray-500">
                {sorted.length} of {rows.length} row{rows.length === 1 ? '' : 's'}
                {pivot && ` · pivot: ${pivot.tree.length || 1} row group(s) × ${activePivotCols.length ? pivot.tuples.length : 1} column(s)${activeGroupKeys.length ? '' : ' - drag a field to ☰ Rows for row groups'}`}
                {!pivot && shownGroupKeys.length > 0 && ` · ${displayTree.length} group(s)`}
                {activeFilterCount > 0 && <button className="ml-2 text-blue-700 underline" onClick={() => { setValueFilters({}); setFilters([]); setSearch(''); }}>clear {activeFilterCount} filter(s)</button>}
                {onCellEdit && !pivot && <span className="ml-2">· Double-click or press F2 on an editable cell to change it in place</span>}
                {note && <span className="ml-2">· {note}</span>}
            </div>
        </div>
    );
}

// FEATURE: added (display-only) columns - running balance, % of total,
// a formula of two number columns (or a column and a number), blank text.
function AddColumnPanel({ numericColumns, onAdd, onClose }) {
    const [calc, setCalc] = useState('running_balance');
    const [label, setLabel] = useState('');
    const [sourceKey, setSourceKey] = useState(numericColumns[0]?.key || '');
    const [op, setOp] = useState('-');
    const [otherKey, setOtherKey] = useState(numericColumns[1]?.key || '__const');
    const [constant, setConstant] = useState('');
    const needsNumber = calc !== 'text';
    const suggested = () => {
        const l = k => numericColumns.find(c => c.key === k)?.label || '';
        if (calc === 'running_balance') return `Running ${l(sourceKey)}`;
        if (calc === 'percent_of_total') return `% of ${l(sourceKey)}`;
        if (calc === 'formula') return `${l(sourceKey)} ${op} ${otherKey === '__const' ? constant : l(otherKey)}`;
        return '';
    };

    return (
        <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500">Add a column to this view (not saved to the database - display only; kept with the report layout)</p>
            <div className="flex flex-wrap gap-2 items-center text-sm">
                <select value={calc} onChange={e => setCalc(e.target.value)} className="border rounded px-2 py-1">
                    <option value="running_balance">Running Balance (of a number column)</option>
                    <option value="percent_of_total">% of Total (of a number column)</option>
                    <option value="formula">Formula (A + − × ÷ B)</option>
                    <option value="text">Blank Text Column</option>
                </select>
                {needsNumber && (
                    <select value={sourceKey} onChange={e => setSourceKey(e.target.value)} className="border rounded px-2 py-1">
                        {numericColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                )}
                {calc === 'formula' && (
                    <>
                        <select value={op} onChange={e => setOp(e.target.value)} className="border rounded px-2 py-1"><option value="+">+</option><option value="-">−</option><option value="*">×</option><option value="/">÷</option></select>
                        <select value={otherKey} onChange={e => setOtherKey(e.target.value)} className="border rounded px-2 py-1">
                            {numericColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            <option value="__const">a number…</option>
                        </select>
                        {otherKey === '__const' && <input value={constant} onChange={e => setConstant(e.target.value)} placeholder="e.g. 1.13" className="border rounded px-2 py-1 w-24" />}
                    </>
                )}
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder={suggested() || 'Column name'} className="border rounded px-2 py-1 flex-1 min-w-[120px]" />
            </div>
            {needsNumber && numericColumns.length === 0 && <p className="text-xs text-red-600">This grid has no number column.</p>}
            <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-2 py-1 border rounded text-xs">Cancel</button>
                <button
                    onClick={() => {
                        const name = label.trim() || suggested();
                        if (!name || (needsNumber && !sourceKey)) return;
                        onAdd({ calc, label: name, sourceKey, op, otherKey, constant });
                    }}
                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                >
                    Add
                </button>
            </div>
        </div>
    );
}
