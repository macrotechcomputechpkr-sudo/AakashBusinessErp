// =============================================
// ReportGrid.jsx
// A from-scratch, original reusable data-grid component used across every
// master listing in this app (Users, Ledger Accounts, Product Groups, etc).
//
// Deliberately original: naming, visual design (Tailwind, matches the
// rest of this app), and code are all written independently here - no
// third-party software's source, branding, or exact UI was copied.
// Functional ideas common to spreadsheet-style grids (sorting, multi-level
// grouping via drag-and-drop, a right-click column menu, a column chooser,
// a filter builder, an AutoFilter row, conditional highlighting, a
// per-column footer aggregate row, keyboard cell navigation, opt-in
// inline cell editing, CSV export) are standard, non-proprietary patterns
// found in many independent grid libraries.
//
// Inline editing is OFF by default per column: pass `editable: true` on a
// column definition AND an `onCellEdit(row, key, newValue)` prop to enable
// it - deliberately opt-in, because it's only appropriate for simple flat
// fields (a name, a code). Columns with a foreign-key relationship or a
// custom `render` are exactly the kind of thing that should stay on a
// proper form (with its picker/validation), not become a free-text grid
// cell - so don't mark those `editable`.
//
// Everything runs client-side over the `rows` array you pass in - fine
// for master-data lists (tens to low thousands of rows). For a true
// high-volume transactional report later, swap the local compute here
// for server-side paging/sorting/filtering, keeping the same UI.
// =============================================

import React, { useEffect, useMemo, useState } from 'react';
import ExcelFilterMenu, { distinctValues, cellKey } from './ExcelFilterMenu';
import RecordHistory from './RecordHistory';

const AGG_LABELS = { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count', distinct: 'Distinct', first: 'First', last: 'Last' };
const NUMERIC_AGGS = ['sum', 'avg', 'min', 'max', 'count', 'distinct'];
const TEXT_AGGS = ['count', 'distinct', 'first', 'last'];
const OPERATORS = [
    { value: 'contains', label: 'Contains' },
    { value: 'equals', label: 'Equals' },
    { value: 'starts_with', label: 'Starts With' },
    { value: 'ends_with', label: 'Ends With' },
    { value: 'not_contains', label: 'Does Not Contain' },
    { value: 'greater_than', label: 'Greater Than' },
    { value: 'less_than', label: 'Less Than' }
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
        case 'greater_than': { const n1 = parseFloat(cellValue), n2 = parseFloat(target); return !isNaN(n1) && !isNaN(n2) && n1 > n2; }
        case 'less_than': { const n1 = parseFloat(cellValue), n2 = parseFloat(target); return !isNaN(n1) && !isNaN(n2) && n1 < n2; }
        default: return true;
    }
}

function compareValues(a, b) {
    const na = parseFloat(a), nb = parseFloat(b);
    if (a !== '' && b !== '' && a != null && b != null && !isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a ?? '').localeCompare(String(b ?? ''));
}

function computeAggregate(values, type) {
    if (!type || type === 'none') return null;
    const nums = values.map(Number).filter(v => !isNaN(v));
    switch (type) {
        case 'sum': return nums.reduce((a, b) => a + b, 0);
        case 'avg': return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : '—';
        case 'min': return nums.length ? Math.min(...nums) : '—';
        case 'max': return nums.length ? Math.max(...nums) : '—';
        case 'count': return values.length;
        case 'distinct': return new Set(values.map(String)).size;
        case 'first': return values.length ? values[0] : '—';
        case 'last': return values.length ? values[values.length - 1] : '—';
        default: return '';
    }
}

// FEATURE: multi-level grouping tree, built fresh from the (already
// row-sorted) list every time the group keys or sort change. Each level
// partitions its parent's rows by one group key, in the order the user
// dragged the chips into the drop zone - so grouping by [Group, Type]
// nests Type inside Group, not the other way round.
function buildGroupTree(rowsList, keys, level, parentPath) {
    if (level >= keys.length) return rowsList.map(row => ({ type: 'row', row }));
    const key = keys[level];
    const map = new Map();
    rowsList.forEach(row => {
        const val = row[key] ?? '(Blank)';
        if (!map.has(val)) map.set(val, []);
        map.get(val).push(row);
    });
    const sortedVals = Array.from(map.keys()).sort(compareValues);
    return sortedVals.map(val => {
        const path = `${parentPath}/${key}:${val}`;
        return {
            type: 'group', level, key, val, path,
            count: map.get(val).length,
            children: buildGroupTree(map.get(val), keys, level + 1, path)
        };
    });
}

function collectGroupPaths(nodes) {
    let paths = [];
    nodes.forEach(n => {
        if (n.type === 'group') {
            paths.push(n.path);
            paths = paths.concat(collectGroupPaths(n.children));
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

function renderGroupNode(node, ctx) {
    const { visibleColumns, rowActions, collapsedGroups, toggleCollapse, rowHighlightColor, allColumns, footerAggs } = ctx;
    if (node.type === 'row') {
        const row = node.row;
        const bg = rowHighlightColor(row);
        return [(
            <tr key={row.__id} style={bg ? { backgroundColor: bg } : undefined} className={!bg ? 'hover:bg-gray-50 border-b border-gray-100 last:border-0' : 'border-b border-gray-100 last:border-0'}>
                {visibleColumns.map(col => {
                    const isEditingThis = ctx.editingCell && ctx.editingCell.rowId === row.__id && ctx.editingCell.colKey === col.key;
                    const editable = !!col.editable && !!ctx.onCellEdit;
                    if (isEditingThis) return <EditableCell key={col.key} row={row} col={col} ctx={ctx} />;
                    return (
                        <td
                            key={col.key}
                            data-cell-id={`${row.__id}:${col.key}`}
                            tabIndex={0}
                            onDoubleClick={() => { if (editable) ctx.startEdit(row, col); }}
                            onKeyDown={e => {
                                if (editable && e.key === 'F2') { e.preventDefault(); ctx.startEdit(row, col); }
                                else ctx.handleCellKeyDown(e, row.__id, col.key);
                            }}
                            className={`px-3 py-1.5 whitespace-nowrap focus:outline focus:outline-2 focus:outline-blue-400 focus:-outline-offset-2 ${editable ? 'cursor-text' : ''}`}
                            title={editable ? 'Double-click or press F2 to edit' : undefined}
                        >
                            {col.render ? col.render(row) : (row[col.key] ?? '-')}
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
    // is set, otherwise Sum by default) - computed from ALL rows under
    // this group regardless of collapse state, so collapsing a group still
    // shows its totals, not just its row count.
    const header = (
        <tr key={node.path} className="bg-gray-100">
            {visibleColumns.map((col, idx) => {
                if (idx === 0) {
                    return (
                        <td
                            key={col.key}
                            className="px-3 py-1.5 font-semibold text-gray-700 text-xs cursor-pointer whitespace-nowrap"
                            style={{ paddingLeft: 12 + node.level * 20 }}
                            onClick={() => toggleCollapse(node.path)}
                        >
                            {isCollapsed ? '📁' : '📂'} {colLabel}: {String(node.val)} <span className="text-gray-400 font-normal">({node.count})</span>
                        </td>
                    );
                }
                if (col.type === 'number') {
                    const agg = footerAggs[col.key] || 'sum';
                    const values = collectLeafValues(node, col.key);
                    const result = computeAggregate(values, agg);
                    return (
                        <td key={col.key} className="px-3 py-1.5 text-xs text-gray-600 font-semibold whitespace-nowrap cursor-pointer" onClick={() => toggleCollapse(node.path)}>
                            {result !== null ? `${AGG_LABELS[agg]}: ${result}` : ''}
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

export default function ReportGrid({
    columns,
    rows,
    getId,
    storageKey = 'report_grid',
    rowActions: ownActions,
    auditTable,     // optional tenant table name - adds a 🕘 History button (audit log, field-level changes)
    auditTitle,     // optional row => title for that history
    onCellEdit  // optional (row, columnKey, newValue) => void - enables inline editing for columns marked `editable: true`
}) {
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
    const [sort, setSort] = useState({ key: null, dir: 'asc' });
    // FEATURE: multiple, ordered group-by keys (drag column headers into the
    // drop zone, or right-click -> Group By) - replaces the earlier
    // single-column dropdown with real multi-level nested grouping.
    const [groupByKeys, setGroupByKeys] = useState([]);
    const [collapsedGroups, setCollapsedGroups] = useState(new Set());
    const [columnWidths, setColumnWidths] = useState({});
    const [contextMenu, setContextMenu] = useState(null); // { x, y, colKey } | null
    const [filters, setFilters] = useState([]);
    const [highlightRules, setHighlightRules] = useState([]);
    const [customColumns, setCustomColumns] = useState([]);
    const [footerAggs, setFooterAggs] = useState({}); // { [colKey]: aggType }
    const [autoWidth, setAutoWidth] = useState(true);

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
        allColumns.map((c, i) => ({ key: c.key, visible: true, order: i }))
    );
    useEffect(() => {
        setColumnsConfig(prev => {
            const known = new Set(prev.map(c => c.key));
            const additions = allColumns.filter(c => !known.has(c.key)).map((c, i) => ({ key: c.key, visible: true, order: prev.length + i }));
            return [...prev.filter(c => allColumns.some(ac => ac.key === c.key)), ...additions];
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allColumns.length]);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(`${storageKey}_state`);
            if (saved) {
                const s = JSON.parse(saved);
                if (s.columnsConfig) setColumnsConfig(s.columnsConfig);
                if (Array.isArray(s.groupByKeys)) setGroupByKeys(s.groupByKeys);
                if (s.footerAggs) setFooterAggs(s.footerAggs);
                if (s.columnWidths) setColumnWidths(s.columnWidths);
            }
        } catch { /* ignore malformed saved state */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        localStorage.setItem(`${storageKey}_state`, JSON.stringify({ columnsConfig, groupByKeys, footerAggs, columnWidths }));
    }, [columnsConfig, groupByKeys, footerAggs, columnWidths, storageKey]);

    // Close the right-click menu on any outside click.
    useEffect(() => {
        if (!contextMenu) return;
        const handler = () => setContextMenu(null);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [contextMenu]);

    const addCustomColumn = (type, label, sourceKey) => {
        const key = `custom_${Date.now()}`;
        setCustomColumns(cols => [...cols, { key, label, type, sourceKey, isCustom: true }]);
        setColumnsConfig(cfg => [...cfg, { key, visible: true, order: cfg.length }]);
        setPanel(null);
    };
    const removeCustomColumn = (key) => {
        setCustomColumns(cols => cols.filter(c => c.key !== key));
        setColumnsConfig(cfg => cfg.filter(c => c.key !== key));
    };

    const enrichedRows = useMemo(() => {
        let running = {};
        return rows.map(row => {
            const extra = {};
            customColumns.forEach(c => {
                if (c.type === 'running_balance') {
                    const v = Number(row[c.sourceKey]) || 0;
                    running[c.key] = (running[c.key] || 0) + v;
                    extra[c.key] = running[c.key].toFixed(2);
                } else {
                    extra[c.key] = row[c.key] ?? '';
                }
            });
            return { ...row, ...extra, __id: getId(row) };
        });
    }, [rows, customColumns, getId]);

    const filtered = useMemo(() => {
        let out = enrichedRows;
        if (search.trim()) {
            const s = search.toLowerCase();
            out = out.filter(row => allColumns.some(c => String(row[c.key] ?? '').toLowerCase().includes(s)));
        }
        filters.forEach(f => {
            out = out.filter(row => applyOperator(row[f.key], f.operator, f.value));
        });
        if (autoFilterOn) {
            Object.entries(autoFilterValues).forEach(([key, value]) => {
                if (value) out = out.filter(row => applyOperator(row[key], 'contains', value));
            });
        }
        Object.entries(valueFilters).forEach(([key, allowed]) => {
            if (allowed) out = out.filter(row => allowed.has(cellKey(row[key])));
        });
        return out;
    }, [enrichedRows, search, filters, allColumns, autoFilterOn, autoFilterValues, valueFilters]);

    // Sorting is independent of grouping now - grouping re-partitions rows
    // into its own group-value order at each level; the leaf row order
    // within the innermost group still follows this sort.
    const sorted = useMemo(() => {
        if (!sort.key) return filtered;
        const arr = [...filtered];
        arr.sort((a, b) => {
            const c = compareValues(a[sort.key], b[sort.key]);
            return sort.dir === 'asc' ? c : -c;
        });
        return arr;
    }, [filtered, sort]);

    const visibleColumns = columnsConfig
        .filter(c => c.visible)
        .sort((a, b) => a.order - b.order)
        .map(c => allColumns.find(col => col.key === c.key))
        .filter(Boolean);

    const displayTree = useMemo(() => {
        if (groupByKeys.length === 0) return sorted.map(row => ({ type: 'row', row }));
        return buildGroupTree(sorted, groupByKeys, 0, '');
    }, [sorted, groupByKeys]);

    const visibleRowIds = useMemo(() => collectVisibleRowIds(displayTree, collapsedGroups), [displayTree, collapsedGroups]);

    const toggleSort = (key) => {
        setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
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
            if (rule.value !== '' && applyOperator(row[rule.key], rule.operator, rule.value)) return rule.color;
        }
        return null;
    };

    const exportCSV = () => {
        const header = visibleColumns.map(c => c.label);
        const lines = [header, ...sorted.map(row => visibleColumns.map(c => row[c.key] ?? ''))];
        const csv = lines.map(line => line.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${storageKey}.csv`;
        a.click();
    };

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
            if (fromIndex < 0 || fromIndex >= keys.length) return keys;
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

    // ---------- right-click column context menu ----------
    const openContextMenu = (e, colKey) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, colKey });
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

    const numericColumns = allColumns.filter(c => c.type === 'number');
    const hasWidths = Object.keys(columnWidths).length > 0;

    return (
        <div className="w-full text-sm">
            <div className="flex flex-wrap items-center gap-2 mb-2 bg-white border border-gray-200 rounded-lg p-2">
                <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="🔎 Search all columns..."
                    className="flex-1 min-w-[160px] border rounded px-2 py-1.5 text-sm"
                />
                <button onClick={() => setPanel(p => p === 'columns' ? null : 'columns')} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">⚙️ Columns</button>
                <button onClick={() => setPanel(p => p === 'filter' ? null : 'filter')} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">🔽 Filter{filters.length > 0 ? ` (${filters.length})` : ''}</button>
                <button onClick={() => setAutoFilterOn(o => !o)} className={`px-2 py-1.5 border rounded text-xs font-medium ${autoFilterOn ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-gray-50'}`}>📋 AutoFilter</button>
                <button onClick={() => setPanel(p => p === 'highlight' ? null : 'highlight')} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">🎨 Highlight{highlightRules.length > 0 ? ` (${highlightRules.length})` : ''}</button>
                <button onClick={() => setPanel(p => p === 'footer' ? null : 'footer')} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">Σ Footer Options</button>
                <button onClick={() => setPanel(p => p === 'addColumn' ? null : 'addColumn')} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">➕ Add Column</button>
                <button onClick={() => setAutoWidth(w => !w)} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">{autoWidth ? '↔ Auto Width' : '↔ Fixed Width'}</button>
                <button onClick={exportCSV} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">⬇ Export CSV</button>
                <button onClick={() => { setSearch(''); setSort({ key: null, dir: 'asc' }); setGroupByKeys([]); setCollapsedGroups(new Set()); setColumnWidths({}); setFilters([]); setHighlightRules([]); setAutoFilterOn(false); setAutoFilterValues({}); setFooterAggs({}); }} className="px-2 py-1.5 border rounded text-xs font-medium hover:bg-gray-50">↺ Reset</button>
            </div>

            {/* FEATURE: drag-and-drop, multi-level group-by zone. Drag a
                column header in, drag chips to reorder (outer chip = outer
                group level), click a chip's ✕ to remove it. */}
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">📂 Group:</span>
                <div
                    className="flex-1 min-w-[160px] flex flex-wrap gap-1.5 items-center border border-dashed border-gray-300 rounded px-2 py-1.5 min-h-[34px]"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                        const data = e.dataTransfer.getData('text/plain');
                        if (data.startsWith('col:')) addGroupKey(data.slice(4));
                    }}
                >
                    {groupByKeys.length === 0 && <span className="text-xs text-gray-400">Drag a column header here, or right-click a column → Group By</span>}
                    {groupByKeys.map((key, i) => {
                        const col = allColumns.find(c => c.key === key);
                        return (
                            <span
                                key={key}
                                draggable
                                onDragStart={e => e.dataTransfer.setData('text/plain', 'chip:' + i)}
                                onDragOver={e => e.preventDefault()}
                                onDrop={e => {
                                    e.stopPropagation();
                                    const data = e.dataTransfer.getData('text/plain');
                                    if (data.startsWith('chip:')) reorderGroupKey(parseInt(data.slice(5), 10), i);
                                    else if (data.startsWith('col:')) addGroupKey(data.slice(4));
                                }}
                                className="flex items-center gap-1.5 bg-gray-800 text-white text-xs px-2.5 py-1 rounded-full cursor-grab"
                            >
                                {i + 1}. {col?.label || key}
                                <span onClick={() => removeGroupKey(key)} className="cursor-pointer text-red-300 hover:text-red-100 font-bold">✕</span>
                            </span>
                        );
                    })}
                </div>
                {groupByKeys.length > 0 && (
                    <button onClick={() => { setGroupByKeys([]); setCollapsedGroups(new Set()); }} className="text-xs text-red-500 hover:underline whitespace-nowrap">✕ Clear</button>
                )}
            </div>

            {panel === 'columns' && (
                <div className="mb-2 bg-white border border-gray-200 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-semibold text-gray-500 mb-1">Show / hide, reorder with ↑↓</p>
                    {[...columnsConfig].sort((a, b) => a.order - b.order).map(c => {
                        const col = allColumns.find(x => x.key === c.key);
                        if (!col) return null;
                        return (
                            <div key={c.key} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={c.visible} onChange={() => toggleColumnVisible(c.key)} />
                                <span className="flex-1">{col.label}{col.isCustom && ' (custom)'}</span>
                                <button onClick={() => moveColumn(c.key, -1)} className="text-gray-400 hover:text-gray-700">↑</button>
                                <button onClick={() => moveColumn(c.key, 1)} className="text-gray-400 hover:text-gray-700">↓</button>
                                {col.isCustom && <button onClick={() => removeCustomColumn(c.key)} className="text-red-500 hover:text-red-700 text-xs ml-2">Remove</button>}
                            </div>
                        );
                    })}
                </div>
            )}

            {panel === 'filter' && (
                <div className="mb-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500">Filters (all conditions must match)</p>
                    {filters.map((f, i) => (
                        <div key={i} className="flex flex-wrap gap-2 items-center text-sm">
                            <select value={f.key} onChange={e => updateFilter(i, { key: e.target.value })} className="border rounded px-2 py-1">
                                {allColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                            <select value={f.operator} onChange={e => updateFilter(i, { operator: e.target.value })} className="border rounded px-2 py-1">
                                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <input value={f.value} onChange={e => updateFilter(i, { value: e.target.value })} placeholder="Value" className="border rounded px-2 py-1 flex-1 min-w-[100px]" />
                            <button onClick={() => removeFilter(i)} className="text-red-500 text-xs">Remove</button>
                        </div>
                    ))}
                    <button onClick={addFilter} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">➕ Add condition</button>
                </div>
            )}

            {panel === 'highlight' && (
                <div className="mb-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500">Highlight rows where...</p>
                    {highlightRules.map((h, i) => (
                        <div key={i} className="flex flex-wrap gap-2 items-center text-sm">
                            <select value={h.key} onChange={e => updateHighlight(i, { key: e.target.value })} className="border rounded px-2 py-1">
                                {allColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                            <select value={h.operator} onChange={e => updateHighlight(i, { operator: e.target.value })} className="border rounded px-2 py-1">
                                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <input value={h.value} onChange={e => updateHighlight(i, { value: e.target.value })} placeholder="Value" className="border rounded px-2 py-1 flex-1 min-w-[100px]" />
                            <input type="color" value={h.color} onChange={e => updateHighlight(i, { color: e.target.value })} className="w-8 h-8 border rounded" />
                            <button onClick={() => removeHighlight(i)} className="text-red-500 text-xs">Remove</button>
                        </div>
                    ))}
                    <button onClick={addHighlight} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">➕ Add rule</button>
                </div>
            )}

            {/* FEATURE: Footer Options - every visible column gets an
                aggregate choice (type-appropriate: numeric columns get
                Sum/Average/Min/Max too, text columns get Count/Distinct/
                First/Last), plus bulk "set all" shortcuts. Mirrors the
                always-visible footer aggregate row pattern. */}
            {panel === 'footer' && (
                <div className="mb-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500">Pick an aggregate per column for the footer row</p>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                        {visibleColumns.map(c => {
                            const options = c.type === 'number' ? NUMERIC_AGGS : TEXT_AGGS;
                            return (
                                <div key={c.key} className="flex items-center gap-2 text-sm">
                                    <span className="w-32 truncate">{c.label}</span>
                                    <select value={footerAggs[c.key] || 'none'} onChange={e => setFooterAggs(s => ({ ...s, [c.key]: e.target.value }))} className="border rounded px-2 py-1 flex-1">
                                        <option value="none">— None —</option>
                                        {options.map(k => <option key={k} value={k}>{AGG_LABELS[k]}</option>)}
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                        <button onClick={() => setFooterAggs(Object.fromEntries(numericColumns.map(c => [c.key, 'sum'])))} className="px-2 py-1 border rounded text-xs hover:bg-gray-50">Σ All Sum</button>
                        <button onClick={() => setFooterAggs(Object.fromEntries(numericColumns.map(c => [c.key, 'avg'])))} className="px-2 py-1 border rounded text-xs hover:bg-gray-50">x̄ All Average</button>
                        <button onClick={() => setFooterAggs(Object.fromEntries(visibleColumns.map(c => [c.key, 'count'])))} className="px-2 py-1 border rounded text-xs hover:bg-gray-50"># All Count</button>
                        <button onClick={() => setFooterAggs({})} className="px-2 py-1 border border-red-300 text-red-600 rounded text-xs hover:bg-red-50">✕ Clear All</button>
                    </div>
                </div>
            )}

            {panel === 'addColumn' && (
                <AddColumnPanel numericColumns={numericColumns} onAdd={addCustomColumn} onClose={() => setPanel(null)} />
            )}

            {historyOf && <RecordHistory table={auditTable} id={historyOf.id} title={historyOf.title} onClose={() => setHistoryOf(null)} />}
            {filterMenu && (
                <ExcelFilterMenu anchor={filterMenu.anchor} title={allColumns.find(c => c.key === filterMenu.key)?.label}
                    values={distinctValues(enrichedRows.map(r => r[filterMenu.key]))} selected={valueFilters[filterMenu.key] || null}
                    onApply={allowed => setValueFilters(v => ({ ...v, [filterMenu.key]: allowed }))}
                    onSort={dir => setSort({ key: filterMenu.key, dir })} onClose={() => setFilterMenu(null)} />
            )}
            {Object.values(valueFilters).some(Boolean) && (
                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                    <span className="text-gray-500">Column filters:</span>
                    {Object.entries(valueFilters).filter(([, v]) => v).map(([k, v]) => (
                        <span key={k} className="bg-blue-50 border border-blue-200 rounded px-2 py-0.5">{allColumns.find(c => c.key === k)?.label || k}: {v.size} value(s)
                            <button type="button" className="ml-1 text-red-600" onClick={() => setValueFilters(x => ({ ...x, [k]: null }))}>✕</button></span>
                    ))}
                    <button type="button" className="text-blue-600 underline" onClick={() => setValueFilters({})}>Clear all</button>
                </div>
            )}
            <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white" data-enter-nav="off" data-excel-managed="true">
                <table className={autoWidth ? 'w-full' : 'min-w-[900px]'} style={hasWidths ? { tableLayout: 'fixed' } : undefined}>
                    {hasWidths && (
                        <colgroup>
                            {visibleColumns.map(col => <col key={col.key} style={columnWidths[col.key] ? { width: columnWidths[col.key] } : undefined} />)}
                            {rowActions && <col />}
                        </colgroup>
                    )}
                    <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                            {visibleColumns.map(col => (
                                <th
                                    key={col.key}
                                    draggable
                                    onDragStart={e => e.dataTransfer.setData('text/plain', 'col:' + col.key)}
                                    onClick={() => toggleSort(col.key)}
                                    onContextMenu={e => openContextMenu(e, col.key)}
                                    className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide border-b border-gray-200 cursor-pointer select-none whitespace-nowrap"
                                >
                                    {col.label}{sort.key === col.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}{groupByKeys.includes(col.key) && ` 📌${groupByKeys.indexOf(col.key) + 1}`}
                                    <button type="button" data-enter-skip title="Filter / sort this column"
                                        className={`ml-1 px-1 rounded text-[10px] border ${valueFilters[col.key] ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-400 border-gray-300 hover:text-gray-700'}`}
                                        onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setFilterMenu({ key: col.key, anchor: { left: r.left, top: r.top, bottom: r.bottom } }); }}>▾</button>
                                </th>
                            ))}
                            {rowActions && <th className="px-3 py-2 border-b border-gray-200"></th>}
                        </tr>
                        {autoFilterOn && (
                            <tr className="bg-white">
                                {visibleColumns.map(col => (
                                    <th key={col.key} className="px-2 py-1 border-b border-gray-200 font-normal">
                                        <input
                                            value={autoFilterValues[col.key] || ''}
                                            onChange={e => setAutoFilterValues(v => ({ ...v, [col.key]: e.target.value }))}
                                            placeholder={`Filter ${col.label}...`}
                                            className="w-full border rounded px-1.5 py-1 text-xs font-normal normal-case"
                                        />
                                    </th>
                                ))}
                                {rowActions && <th className="px-2 py-1 border-b border-gray-200"></th>}
                            </tr>
                        )}
                    </thead>
                    <tbody>
                        {sorted.length === 0 && (
                            <tr><td colSpan={visibleColumns.length + (rowActions ? 1 : 0)} className="text-center py-8 text-gray-400">No records found.</td></tr>
                        )}
                        {sorted.length > 0 && displayTree.flatMap(node => renderGroupNode(node, {
                            visibleColumns, rowActions, collapsedGroups, toggleCollapse, rowHighlightColor, allColumns, footerAggs,
                            editingCell, editValue, setEditValue, startEdit, commitEdit, cancelEdit, onCellEdit, moveFocus, handleCellKeyDown
                        }))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-gray-800 text-white font-semibold sticky bottom-0">
                            {visibleColumns.map((col, i) => {
                                const agg = footerAggs[col.key] || 'none';
                                const values = sorted.map(r => r[col.key]);
                                const result = computeAggregate(values, agg);
                                const options = col.type === 'number' ? NUMERIC_AGGS : TEXT_AGGS;
                                return (
                                    <td key={col.key} className="px-2 py-1 text-xs align-top">
                                        <div className="flex flex-col gap-0.5">
                                            {i === 0 && agg === 'none' && <span className="text-gray-300 text-[10px] uppercase">Footer</span>}
                                            {result !== null && <span className="text-white text-xs font-bold truncate">{result}</span>}
                                            <select
                                                value={agg}
                                                onChange={e => setFooterAggs(s => ({ ...s, [col.key]: e.target.value }))}
                                                className="bg-gray-700 text-white border border-gray-600 rounded text-[10px] px-1 py-0.5"
                                            >
                                                <option value="none">— None —</option>
                                                {options.map(k => <option key={k} value={k}>{AGG_LABELS[k]}</option>)}
                                            </select>
                                        </div>
                                    </td>
                                );
                            })}
                            {rowActions && <td className="bg-gray-800"></td>}
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* FEATURE: right-click column context menu - the same sort/
                group/width/collapse actions the toolbar offers, reachable
                without leaving the header row. */}
            {contextMenu && (
                <div
                    className="fixed bg-white border border-gray-300 rounded-lg shadow-lg z-50 py-1 text-sm min-w-[190px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={e => e.stopPropagation()}
                >
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setSort({ key: contextMenu.colKey, dir: 'asc' }); setContextMenu(null); }}>⬆ Sort Up</button>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setSort({ key: contextMenu.colKey, dir: 'desc' }); setContextMenu(null); }}>⬇ Sort Down</button>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setSort({ key: null, dir: 'asc' }); setContextMenu(null); }}>↺ Clear Sort</button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { addGroupKey(contextMenu.colKey); setContextMenu(null); }}>📂 Group By{groupByKeys.includes(contextMenu.colKey) ? ' (✓)' : ''}</button>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { removeGroupKey(contextMenu.colKey); setContextMenu(null); }}>✕ Remove from Groups</button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => {
                        const w = window.prompt('Width in pixels:', String(columnWidths[contextMenu.colKey] || 150));
                        if (w && !isNaN(parseInt(w, 10))) setColumnWidths(cw => ({ ...cw, [contextMenu.colKey]: parseInt(w, 10) }));
                        setContextMenu(null);
                    }}>📏 Set Width</button>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setColumnWidths(cw => { const n = { ...cw }; delete n[contextMenu.colKey]; return n; }); setContextMenu(null); }}>↺ Reset Width</button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setCollapsedGroups(new Set(collectGroupPaths(displayTree))); setContextMenu(null); }}>📁 Collapse All</button>
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setCollapsedGroups(new Set()); setContextMenu(null); }}>📂 Expand All</button>
                </div>
            )}

            <div className="mt-2 text-xs text-gray-500">
                {sorted.length} of {rows.length} row{rows.length === 1 ? '' : 's'}
                {onCellEdit && <span className="ml-2">· Double-click or press F2 on an editable cell to change it in place</span>}
            </div>
        </div>
    );
}

function AddColumnPanel({ numericColumns, onAdd, onClose }) {
    const [type, setType] = useState('running_balance');
    const [label, setLabel] = useState('');
    const [sourceKey, setSourceKey] = useState(numericColumns[0]?.key || '');

    return (
        <div className="mb-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500">Add a column to this view (not saved to the database - display only)</p>
            <div className="flex flex-wrap gap-2 items-center text-sm">
                <select value={type} onChange={e => setType(e.target.value)} className="border rounded px-2 py-1">
                    <option value="running_balance">Running Balance (of a numeric column)</option>
                    <option value="text">Blank Text Column</option>
                </select>
                {type === 'running_balance' && (
                    <select value={sourceKey} onChange={e => setSourceKey(e.target.value)} className="border rounded px-2 py-1">
                        {numericColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                )}
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Column name" className="border rounded px-2 py-1 flex-1 min-w-[120px]" />
            </div>
            <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-2 py-1 border rounded text-xs">Cancel</button>
                <button
                    onClick={() => { if (label.trim()) onAdd(type, label.trim(), sourceKey); }}
                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                >
                    Add
                </button>
            </div>
        </div>
    );
}
