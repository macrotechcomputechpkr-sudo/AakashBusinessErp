// =============================================
// grid/PivotView.jsx - ReportGrid's pivot table
// Shown when a field is in the Columns area (Field Selector, or a column
// header / Rows chip dragged onto "⫼ Columns"): the values of the column
// fields become columns, the Rows fields a tree with sub-totals, each cell
// the chosen Values (Sum / Average / Count … ; none = Count of rows), with a
// Total column and a Grand Total row. 🌡 Heat map shades each cell by size.
// Built by gridAnalysis.buildPivot; CSV / print use gridAnalysis.pivotLines.
// =============================================
import React, { useMemo } from 'react';
import { AGG_LABELS, accResult, fmtAgg } from './gridAnalysis';

export default function PivotView({ pv, rowKeys, colKeys, labelOf, collapsed, toggle, heat }) {
    const { measures: ms, tuples } = pv;
    const mLabel = m => (m.key === '__row' ? 'Rows (count)' : `${AGG_LABELS[m.agg]} of ${labelOf(m.key)}`);
    const fmt = (a, m) => (a ? fmtAgg(accResult(a, m.agg), m.agg, true) : '');
    // largest value per measure (leaf cells), for the heat map
    const maxBy = useMemo(() => {
        if (!heat) return [];
        const mx = ms.map(() => 0);
        const walk = nodes => nodes.forEach(n => {
            if (n.children.length) { walk(n.children); return; }
            n.cells.forEach(arr => arr.forEach((a, i) => { mx[i] = Math.max(mx[i], Math.abs(accResult(a, ms[i].agg))); }));
        });
        walk(pv.tree.length ? pv.tree : [{ children: [], cells: pv.grand.cells }]);
        return mx;
    }, [pv, heat, ms]);
    const shade = (a, i) => {
        if (!heat || !a || !maxBy[i]) return undefined;
        const r = Math.abs(accResult(a, ms[i].agg)) / maxBy[i];
        return { backgroundColor: `rgba(42,120,214,${(0.06 + r * 0.42).toFixed(3)})` };
    };

    // header rows: one per column field (equal neighbours merged), then the measure names when there are several
    const headRows = colKeys.map((k, lvl) => {
        const cells = [];
        tuples.forEach((t, i) => {
            const prefix = t.labels.slice(0, lvl + 1).join('\u0001');
            const last = cells[cells.length - 1];
            if (last && last.prefix === prefix) last.span += ms.length; else cells.push({ prefix, label: t.labels[lvl], span: ms.length, i });
        });
        return cells;
    });
    const rowCaption = rowKeys.length ? rowKeys.map(labelOf).join(' › ') : 'Rows';
    const nHead = colKeys.length + (ms.length > 1 ? 1 : 0);

    const line = (n, key, depth, isGrand) => (
        <tr key={key} className={isGrand ? 'rg-footer font-semibold' : n.children && n.children.length ? (depth === 0 ? 'bg-gray-100 font-semibold' : 'bg-slate-50 font-semibold') : 'hover:bg-gray-50'}>
            <td className="px-3 py-1 whitespace-nowrap sticky left-0 bg-inherit" style={{ paddingLeft: 12 + depth * 18 }}>
                {!isGrand && n.children.length > 0 && <button type="button" className="mr-1 text-gray-500" onClick={() => toggle(n.path)}>{collapsed.has(n.path) ? '▸' : '▾'}</button>}
                {isGrand ? 'Grand Total' : String(n.val)} {!isGrand && <span className="text-gray-400 text-[11px] font-normal">({n.count})</span>}
            </td>
            {tuples.map(t => ms.map((m, i) => {
                const a = n.cells.get(t.id)?.[i];
                return <td key={`${t.id}|${i}`} className="px-3 py-1 text-right tabular-nums whitespace-nowrap" style={isGrand ? undefined : shade(a, i)}>{fmt(a, m)}</td>;
            }))}
            {colKeys.length > 0 && ms.map((m, i) => <td key={`tot${i}`} className="px-3 py-1 text-right tabular-nums whitespace-nowrap font-semibold bg-blue-50/60">{fmt(n.total[i], m)}</td>)}
        </tr>
    );
    const body = [];
    const walk = (nodes, depth) => nodes.forEach(n => {
        body.push(line(n, n.path, depth, false));
        if (!collapsed.has(n.path)) walk(n.children, depth + 1);
    });
    walk(pv.tree, 0);

    return (
        <table className="w-full text-sm" data-pivot>
            <thead className="bg-gray-50 sticky top-0 z-10">
                {headRows.map((cells, lvl) => (
                    <tr key={lvl}>
                        {lvl === 0 && <th rowSpan={nHead} className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap sticky left-0 bg-gray-50">{rowCaption}</th>}
                        {cells.map(c => <th key={`${lvl}|${c.i}`} colSpan={c.span} className="px-3 py-1 text-center text-xs font-semibold text-gray-600 border-b border-l border-gray-200 whitespace-nowrap" title={labelOf(colKeys[lvl])}>{c.label}</th>)}
                        {lvl === 0 && <th rowSpan={colKeys.length} colSpan={ms.length} className="px-3 py-1 text-center text-xs font-semibold text-gray-700 border-b border-l border-gray-200 bg-blue-50">Total</th>}
                    </tr>
                ))}
                {(ms.length > 1 || colKeys.length === 0) && (
                    <tr>
                        {colKeys.length === 0 && <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600 border-b border-gray-200">{rowCaption}</th>}
                        {(colKeys.length ? tuples : [null]).map((t, ti) => ms.map((m, i) => <th key={`${ti}|${i}`} className="px-3 py-1 text-right text-[11px] font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap">{mLabel(m)}</th>))}
                        {colKeys.length > 0 && ms.map((m, i) => <th key={`t${i}`} className="px-3 py-1 text-right text-[11px] font-semibold text-gray-600 border-b border-gray-200 bg-blue-50 whitespace-nowrap">{mLabel(m)}</th>)}
                    </tr>
                )}
            </thead>
            <tbody>
                {body}
                {colKeys.length === 0 && rowKeys.length === 0 && line({ ...pv.grand, children: [], val: 'All rows', count: 0 }, 'all', 0, false)}
            </tbody>
            <tfoot className="sticky bottom-0">{line({ ...pv.grand, children: [] }, 'grand', 0, true)}</tfoot>
        </table>
    );
}
