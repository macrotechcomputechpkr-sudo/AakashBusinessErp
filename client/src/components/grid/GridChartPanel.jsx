// =============================================
// grid/GridChartPanel.jsx - ReportGrid's 📊 Chart panel
// Makes a chart (column, stacked, horizontal bar, line, area, pie, donut)
// and a pivot table from the rows the grid shows now (after its search,
// filters and ▾ value filters):
//   Category (X)  any column; a date column can go by month or year
//   Values (Y)    one or more number columns (Count needs none)
//   Split by      a column whose values become the series (e.g. month x branch)
//   Aggregate     Sum / Average / Count / Min / Max / Distinct
//   Top N         biggest N categories, the rest as "Other"
// Clicking a bar / slice filters the grid to that category (drill down).
// Download as PNG / SVG, pivot table as CSV. The settings are part of the
// grid's state (kept per report, and in 📁 Views).
// =============================================
import React, { useMemo, useRef } from 'react';
import DataChart from '../charts/DataChart';
import { AGG_LABELS, buildChartData, fmtAgg, isDateLike } from './gridAnalysis';

export const CHART_TYPES = [
    ['column', '▮ Column'], ['stacked', '▦ Stacked column'], ['hbar', '▬ Bar (horizontal)'],
    ['line', '📈 Line'], ['area', '◭ Area'], ['pie', '◔ Pie'], ['donut', '◯ Donut']
];
const CHART_AGGS = ['sum', 'avg', 'count', 'min', 'max', 'distinct'];
const VALUE_RE = /amount|amt|value|net|total|sales|purchase|balance|debit|credit|profit|income|expense|cost|paid|due/i;
const QTY_RE = /qty|quantity|count|nos/i;
const NOT_Y = /rate|price|%|percent|margin|\bdays?\b|\bage\b|turnover|ratio/i;
const last = c => String(c.label || '').split(' › ').pop();

/**
 * sensible first chart: the first group column, else a text column whose
 * values repeat (Class, Branch, Month … - they add up), else one with a
 * handful of values; Y = the first amount / value column, else a quantity.
 */
export function defaultChartConfig(columns, rows, groupByKeys) {
    const nums = columns.filter(c => c.type === 'number');
    const texts = columns.filter(c => c.type !== 'number');
    const sample = rows.slice(0, 2000);
    const distinct = key => new Set(sample.map(r => String(r[key] ?? ''))).size;
    const repeats = texts.filter(c => { const d = distinct(c.key); return d >= 2 && d <= 40 && d <= sample.length * 0.6; });
    const dateCol = texts.find(c => sample.slice(0, 50).some(r => isDateLike(r[c.key])));
    const x = groupByKeys[0]
        || repeats.find(c => c !== dateCol)?.key
        || texts.find(c => { const d = distinct(c.key); return d >= 2 && d <= 40; })?.key
        || texts[0]?.key || columns[0]?.key || '';
    const dateX = x && sample.slice(0, 50).some(r => isDateLike(r[x]));
    const y = nums.find(c => VALUE_RE.test(last(c)) && !NOT_Y.test(last(c))) || nums.find(c => QTY_RE.test(last(c))) || nums.find(c => !NOT_Y.test(last(c))) || nums[0];
    return { x, bucket: dateX ? 'month' : 'none', values: y ? [y.key] : [], split: '', agg: y ? 'sum' : 'count', type: dateX ? 'line' : 'column', top: dateX ? 0 : 12, order: dateX ? 'label' : 'value', height: 300, pivot: false };
}

export default function GridChartPanel({ columns, rows, config, onChange, onDrill, onClose, title }) {
    const cfg = config;
    const set = patch => onChange({ ...cfg, ...patch });
    const wrap = useRef(null);
    const label = k => columns.find(c => c.key === k)?.label || k;
    const nums = columns.filter(c => c.type === 'number');
    const dateX = !!cfg.x && rows.slice(0, 50).some(r => isDateLike(r[cfg.x]));
    const data = useMemo(() => buildChartData(rows, cfg, label), [rows, cfg]); // eslint-disable-line react-hooks/exhaustive-deps
    const toggleValue = k => set({ values: cfg.values.includes(k) ? cfg.values.filter(v => v !== k) : [...cfg.values, k] });
    const fileBase = (title || 'chart').replace(/[^\w-]+/g, '_').slice(0, 50);

    const svgText = () => {
        const svg = wrap.current?.querySelector('svg');
        if (!svg) return null;
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const vb = svg.viewBox.baseVal;
        clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height);
        return { text: new XMLSerializer().serializeToString(clone), w: vb.width, h: vb.height };
    };
    const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    const saveSvg = () => { const s = svgText(); if (s) download(new Blob([s.text], { type: 'image/svg+xml' }), `${fileBase}.svg`); };
    const savePng = () => {
        const s = svgText();
        if (!s) return;
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = s.w * 2; c.height = s.h * 2;
            const g = c.getContext('2d');
            g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.scale(2, 2); g.drawImage(img, 0, 0);
            c.toBlob(b => b && download(b, `${fileBase}.png`));
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.text)}`;
    };
    const pivotCsv = () => {
        const q = v => `"${String(v).replace(/"/g, '""')}"`;
        const head = [label(cfg.x), ...data.series.map(s => s.name), 'Total'];
        const lines = [head, ...data.categories.map((c, i) => [c, ...data.series.map(s => s.values[i]), data.rowTotals[i]]), ['Total', ...data.colTotals, data.grand]];
        download(new Blob([lines.map(l => l.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), `${fileBase}_pivot.csv`);
    };
    const fmt = v => fmtAgg(v, cfg.agg, true);

    return (
        <div className="mb-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2" data-enter-nav="off">
            <div className="flex flex-wrap items-end gap-2 text-xs">
                <b className="text-sm mr-1">📊 Chart</b>
                <label className="flex flex-col">Type
                    <select className="border rounded px-1 py-1" value={cfg.type} onChange={e => set({ type: e.target.value })}>{CHART_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="flex flex-col">Category (X)
                    <select className="border rounded px-1 py-1 max-w-[180px]" value={cfg.x} onChange={e => { const x = e.target.value; const d = rows.slice(0, 50).some(r => isDateLike(r[x])); set({ x, bucket: d ? 'month' : 'none', order: d ? 'label' : 'value', top: d ? 0 : cfg.top || 12 }); }}>
                        {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
                {dateX && (
                    <label className="flex flex-col">Date by
                        <select className="border rounded px-1 py-1" value={cfg.bucket} onChange={e => set({ bucket: e.target.value })}><option value="none">Day</option><option value="month">Month</option><option value="year">Year</option></select></label>
                )}
                <div className="flex flex-col">Values (Y)
                    <details className="relative">
                        <summary className="border rounded px-2 py-1 cursor-pointer list-none bg-white min-w-[140px] max-w-[220px] truncate">{cfg.values.length ? cfg.values.map(label).join(', ') : (cfg.agg === 'count' ? 'Rows (count)' : '— pick —')} ▾</summary>
                        <div className="absolute z-30 mt-1 bg-white border rounded shadow p-2 max-h-60 overflow-y-auto min-w-[200px]">
                            {nums.length === 0 && <p className="text-gray-500">No number column - use Count.</p>}
                            {nums.map(c => <label key={c.key} className="flex items-center gap-1 py-0.5 whitespace-nowrap"><input type="checkbox" checked={cfg.values.includes(c.key)} onChange={() => toggleValue(c.key)} /> {c.label}</label>)}
                        </div>
                    </details>
                </div>
                <label className="flex flex-col">Split by (series)
                    <select className="border rounded px-1 py-1 max-w-[160px]" value={cfg.split} onChange={e => set({ split: e.target.value })}>
                        <option value="">— none —</option>
                        {columns.filter(c => c.key !== cfg.x).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
                <label className="flex flex-col">Aggregate
                    <select className="border rounded px-1 py-1" value={cfg.agg} onChange={e => set({ agg: e.target.value })}>{CHART_AGGS.map(a => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}</select></label>
                <label className="flex flex-col">Show
                    <select className="border rounded px-1 py-1" value={cfg.top} onChange={e => set({ top: Number(e.target.value) })}>{[5, 10, 12, 15, 20, 30, 50, 0].map(n => <option key={n} value={n}>{n ? `Top ${n} + Other` : 'All'}</option>)}</select></label>
                <label className="flex flex-col">Order
                    <select className="border rounded px-1 py-1" value={cfg.order} onChange={e => set({ order: e.target.value })}><option value="value">Biggest first</option><option value="label">By name / date</option><option value="as_is">As in report</option></select></label>
                <label className="flex flex-col">Height
                    <select className="border rounded px-1 py-1" value={cfg.height} onChange={e => set({ height: Number(e.target.value) })}>{[220, 300, 400, 520].map(h => <option key={h} value={h}>{h}px</option>)}</select></label>
                <div className="flex gap-1 ml-auto">
                    <button type="button" className={`px-2 py-1 border rounded ${cfg.pivot ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-gray-50'}`} onClick={() => set({ pivot: !cfg.pivot })}>▦ Pivot table</button>
                    <button type="button" className="px-2 py-1 border rounded hover:bg-gray-50" onClick={savePng} title="Download the chart as a picture">⬇ PNG</button>
                    <button type="button" className="px-2 py-1 border rounded hover:bg-gray-50" onClick={saveSvg}>⬇ SVG</button>
                    <button type="button" className="px-2 py-1 border rounded hover:bg-gray-50" onClick={onClose}>✕</button>
                </div>
            </div>
            <div ref={wrap}>
                <DataChart type={cfg.type} categories={data.categories} series={data.series} height={cfg.height}
                    onPick={cfg.bucket === 'none' && onDrill ? i => onDrill(cfg.x, data.categories[i]) : undefined} />
            </div>
            <p className="text-[11px] text-gray-500">
                {data.categories.length} categor{data.categories.length === 1 ? 'y' : 'ies'} from {rows.length} row(s) shown in the grid
                {cfg.type === 'pie' || cfg.type === 'donut' ? ' · pie / donut use the first series' : ''}
                {cfg.bucket === 'none' && onDrill ? ' · click a bar / slice to filter the grid to it' : ''}
            </p>
            {cfg.pivot && data.categories.length > 0 && (
                <div className="overflow-auto max-h-80 border rounded" data-no-excel>
                    <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0"><tr>
                            <th className="text-left px-2 py-1">{label(cfg.x)}{cfg.bucket !== 'none' ? ` (${cfg.bucket})` : ''}</th>
                            {data.series.map(s => <th key={s.name} className="text-right px-2 py-1">{s.name}</th>)}
                            {data.series.length > 1 && <th className="text-right px-2 py-1">Total</th>}
                        </tr></thead>
                        <tbody>
                            {data.categories.map((c, i) => (
                                <tr key={c} className="border-t">
                                    <td className="px-2 py-0.5">{c}</td>
                                    {data.series.map(s => <td key={s.name} className="text-right px-2 py-0.5 tabular-nums">{fmt(s.values[i])}</td>)}
                                    {data.series.length > 1 && <td className="text-right px-2 py-0.5 tabular-nums font-semibold">{fmt(data.rowTotals[i])}</td>}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot><tr className="border-t-2 font-semibold bg-gray-50">
                            <td className="px-2 py-1">Total ({AGG_LABELS[cfg.agg]})</td>
                            {data.colTotals.map((v, i) => <td key={i} className="text-right px-2 py-1 tabular-nums">{fmt(v)}</td>)}
                            {data.series.length > 1 && <td className="text-right px-2 py-1 tabular-nums">{fmt(data.grand)}</td>}
                        </tr></tfoot>
                    </table>
                    <div className="p-1 text-right"><button type="button" className="text-xs underline" onClick={pivotCsv}>⬇ Pivot CSV</button></div>
                </div>
            )}
        </div>
    );
}
