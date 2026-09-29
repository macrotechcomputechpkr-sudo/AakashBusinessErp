// =============================================
// grid/FieldSelector.jsx - ReportGrid's ⚙ Field Selector (floating panel)
// Top: every field with a tick (show / hide the column), drag ⠿ to reorder
// or into an area; "Show Grouped" turns the row groups on / off.
// Bottom, four drop areas like a spreadsheet pivot:
//   🔽 Filters  pick one or many values of a field (click the chip)
//   ⫼ Columns  its values become columns (pivot view)
//   ☰ Rows     group rows by it (a tree with sub-totals); same as 📂 Group
//   Σ Values   what the pivot adds up: Sum / Average / Count / Min / Max
// Chips drag between areas (a Rows field to Columns and back); dropping one
// on the field list removes it. Column headers of the grid drag in as well.
// =============================================
import React, { useState } from 'react';
import { AGG_LABELS } from './gridAnalysis';

export const AREAS = [
    ['filt', '🔽 Filters', 'Drop a field - pick its values'],
    ['cols', '⫼ Columns', 'Drop a field - its values become columns'],
    ['rows', '☰ Rows', 'Drop a field - group rows by it'],
    ['vals', 'Σ Values', 'Drop a number field - Sum / Avg / Count']
];
const VAL_AGGS = ['sum', 'avg', 'count', 'min', 'max', 'distinct'];

/** a drop area (also used in the zone line above the grid) */
export function AreaDrop({ area, label, hint, items, labelOf, onDrop, onRemove, onChip, renderExtra, compact }) {
    const [over, setOver] = useState(false);
    return (
        <div
            className={`flex flex-wrap items-center gap-1 border border-dashed rounded ${compact ? 'px-1.5 py-0.5 min-h-[26px]' : 'p-1.5 min-h-[44px]'} ${over ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); onDrop(e.dataTransfer.getData('text/plain'), null); }}
        >
            {label && <span className="text-[11px] font-semibold text-gray-500 whitespace-nowrap mr-0.5">{label}</span>}
            {items.length === 0 && <span className="text-[11px] text-gray-400">{hint}</span>}
            {items.map((key, i) => (
                <span
                    key={key}
                    draggable
                    onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', `area:${area}:${key}`); }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); onDrop(e.dataTransfer.getData('text/plain'), key); }}
                    className={`rg-chip inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full cursor-grab ${onChip ? 'hover:underline' : ''}`}
                    title="Drag to another area, or drop a field before it"
                >
                    <span onClick={onChip ? e => onChip(key, e.currentTarget) : undefined} className={onChip ? 'cursor-pointer' : ''}>{area === 'rows' ? `${i + 1}. ` : ''}{labelOf(key)}</span>
                    {renderExtra && renderExtra(key)}
                    <span onClick={() => onRemove(key)} className="cursor-pointer text-red-400 hover:text-red-600 font-bold">✕</span>
                </span>
            ))}
        </div>
    );
}

export default function FieldSelector({ columns, columnsConfig, onToggle, onReorder, onShowAll, areas, onDrop, onRemove, onFilterChip, filterCount, values, onValueAgg, showGrouped, setShowGrouped, onClose }) {
    const [q, setQ] = useState('');
    const labelOf = k => columns.find(c => c.key === k)?.label || k;
    const ordered = [...columnsConfig].sort((a, b) => a.order - b.order).map(c => ({ cfg: c, col: columns.find(x => x.key === c.key) })).filter(x => x.col);
    const shown = q ? ordered.filter(x => x.col.label.toLowerCase().includes(q.toLowerCase())) : ordered;
    const where = key => AREAS.filter(([a]) => areas[a].includes(key)).map(([a]) => ({ filt: 'F', cols: 'C', rows: 'R', vals: 'Σ' }[a]));
    const [dragOver, setDragOver] = useState(null);

    return (
        <div className="text-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b">
                <b>📋 Field Selector</b>
                <div className="flex items-center gap-2">
                    <button type="button" className="text-xs underline" onClick={onShowAll}>Show all</button>
                    <button type="button" className="text-gray-500 hover:text-gray-800" onClick={onClose}>✕</button>
                </div>
            </div>
            <div className="p-2 space-y-2">
                <input className="w-full border rounded px-2 py-1 text-xs" placeholder="Search fields…" value={q} onChange={e => setQ(e.target.value)} />
                <div
                    className="max-h-52 overflow-y-auto border rounded"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('area:')) { const [, a, k] = d.split(':'); onRemove(a, k); } }}
                >
                    {shown.map(({ cfg, col }) => (
                        <div
                            key={cfg.key}
                            draggable
                            onDragStart={e => e.dataTransfer.setData('text/plain', `col:${cfg.key}`)}
                            onDragOver={e => { e.preventDefault(); setDragOver(cfg.key); }}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={e => {
                                const d = e.dataTransfer.getData('text/plain');
                                setDragOver(null);
                                if (d.startsWith('col:')) { e.stopPropagation(); onReorder(d.slice(4), cfg.key); }
                            }}
                            className={`flex items-center gap-2 px-2 py-0.5 hover:bg-slate-50 ${dragOver === cfg.key ? 'border-t-2 border-blue-500' : ''}`}
                        >
                            <span className="cursor-grab text-gray-400" title="Drag to reorder, or into an area below">⠿</span>
                            <input type="checkbox" checked={cfg.visible} onChange={() => onToggle(cfg.key)} />
                            <span className="flex-1 truncate" title={col.label}>{col.label}</span>
                            {col.type === 'number' && <span className="text-[10px] text-gray-400">123</span>}
                            {col.dim && <span className="text-[10px] text-gray-400" title="From the product / party master">master</span>}
                            {where(cfg.key).map(w => <span key={w} className="text-[10px] px-1 rounded bg-blue-100 text-blue-800">{w}</span>)}
                        </div>
                    ))}
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showGrouped} onChange={e => setShowGrouped(e.target.checked)} /> Show Grouped</label>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                    {AREAS.map(([a, label, hint]) => (
                        <div key={a}>
                            <div className="text-[11px] font-semibold text-gray-600 mb-0.5">{label}{a === 'filt' && filterCount ? ` (${filterCount} on)` : ''}</div>
                            <AreaDrop area={a} hint={hint} items={areas[a]} labelOf={labelOf}
                                onDrop={(d, before) => onDrop(a, d, before)} onRemove={k => onRemove(a, k)}
                                onChip={a === 'filt' ? onFilterChip : undefined}
                                renderExtra={a === 'vals' ? key => (
                                    <select className="text-[10px] border rounded px-0.5 bg-white" value={values.find(v => v.key === key)?.agg || 'sum'} onChange={e => onValueAgg(key, e.target.value)} onClick={e => e.stopPropagation()}>
                                        {VAL_AGGS.map(g => <option key={g} value={g}>{AGG_LABELS[g]}</option>)}
                                    </select>
                                ) : undefined} />
                        </div>
                    ))}
                </div>
                <p className="text-[10px] text-gray-500">Drag fields (or the grid's column headers) into an area; drag a chip from Rows to Columns and back; drop it on the list above to remove. A field in Columns or Values shows the pivot view.</p>
            </div>
        </div>
    );
}
