// =============================================
// charts/Chart.tsx
// Plain-SVG charts for the dashboard (no chart library): bar, horizontal
// bar, line, area, pie, donut and a table view of the same numbers.
// One y-axis only; a second series (value2) is a comparison in the same
// unit. Colours follow a fixed categorical order (colour-blind checked
// palette); "Other" is always grey. Every mark has a hover tooltip.
// =============================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartType, SeriesPoint } from '../../types/erp';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER = '#9b9a95';
const INK = '#52514e', GRID = '#e5e4e0';

export const money = (n: number): string => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Short axis labels in the Nepali / Indian system: 1.2K, 3.4L (lakh), 1.1Cr (crore). */
export const short = (n: number): string => {
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e7) return `${s}${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
    if (a >= 1e5) return `${s}${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
    if (a >= 1e3) return `${s}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
    return `${s}${Math.round(a * 100) / 100}`;
};
function niceMax(v: number): number {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

interface Props { type: ChartType; points: SeriesPoint[]; labels?: (string | undefined)[]; height?: number }
interface Tip { x: number; y: number; lines: string[] }

export default function Chart({ type, points, labels = [], height = 220 }: Props) {
    const [tip, setTip] = useState<Tip | null>(null);
    // draw at the real pixel width so text keeps its size in small tiles
    const box = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(560);
    useEffect(() => {
        const el = box.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setW(Math.max(240, w)); });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const two = points.some(p => p.value2 !== undefined && p.value2 !== null);
    const empty = points.every(p => !Number(p.value) && !Number(p.value2));
    const H = height;
    const show = (e: React.MouseEvent, lines: string[]) => {
        const box = (e.currentTarget as SVGElement).ownerSVGElement?.getBoundingClientRect() || (e.currentTarget as Element).getBoundingClientRect();
        setTip({ x: e.clientX - box.left, y: e.clientY - box.top, lines });
    };
    const hide = () => setTip(null);
    const name1 = labels[0] || 'Value', name2 = labels[1] || 'Compared';

    const body = useMemo(() => {
        if (!points.length) return null;
        if (type === 'pie' || type === 'donut') {
            const pos = points.filter(p => p.value > 0);
            const total = pos.reduce((s, p) => s + p.value, 0) || 1;
            // wide: legend right of the pie; narrow tile: legend under it (full labels)
            const narrow = W < 420;
            const r = narrow ? Math.min(70, W / 2 - 20) : Math.min(100, H / 2 - 10, W * 0.22);
            const cx = narrow ? W / 2 : r + 8, cy = narrow ? r + 6 : H / 2, ir = type === 'donut' ? r * 0.58 : 0;
            const lx = narrow ? 4 : cx + r + 16, ly = narrow ? 2 * r + 30 : 18;
            const chars = Math.max(6, Math.floor((W - lx - 100) / 6));
            let a0 = -Math.PI / 2;
            return (
                <>
                    {pos.map((p, i) => {
                        const a1 = a0 + (p.value / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
                        const pt = (a: number, rr: number) => `${cx + rr * Math.cos(a)} ${cy + rr * Math.sin(a)}`;
                        const d = ir ? `M ${pt(a0, r)} A ${r} ${r} 0 ${large} 1 ${pt(a1, r)} L ${pt(a1, ir)} A ${ir} ${ir} 0 ${large} 0 ${pt(a0, ir)} Z`
                            : `M ${cx} ${cy} L ${pt(a0, r)} A ${r} ${r} 0 ${large} 1 ${pt(a1, r)} Z`;
                        const color = p.label === 'Other' ? OTHER : SERIES[i % SERIES.length];
                        const pct = Math.round(p.value * 1000 / total) / 10;
                        a0 = a1;
                        if (pos.length === 1) return null;              // a full circle is drawn below
                        return <path key={p.label} d={d} fill={color} stroke="#fff" strokeWidth={2}
                            onMouseMove={e => show(e, [p.label, `${money(p.value)} (${pct}%)`])} onMouseLeave={hide} />;
                    })}
                    {pos.length === 1 && <circle cx={cx} cy={cy} r={r} fill={SERIES[0]} />}
                    {pos.length === 1 && ir > 0 && <circle cx={cx} cy={cy} r={ir} fill="#fff" />}
                    {ir > 0 && <text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight={600} fill="#0b0b0b">{short(total)}</text>}
                    {pos.slice(0, 8).map((p, i) => (
                        <g key={p.label} transform={`translate(${lx}, ${ly + i * 20})`}>
                            <rect width={10} height={10} rx={2} y={-9} fill={p.label === 'Other' ? OTHER : SERIES[i % SERIES.length]} />
                            <text x={16} fontSize={11} fill={INK}>{p.label.length > chars ? `${p.label.slice(0, chars - 1)}…` : p.label}</text>
                            <text x={W - lx - 4} fontSize={11} fill={INK} textAnchor="end">{short(p.value)} · {Math.round(p.value * 1000 / total) / 10}%</text>
                        </g>
                    ))}
                </>
            );
        }
        if (type === 'hbar') {
            const n = points.length, rowH = Math.min(26, (H - 10) / n), lw = Math.min(150, Math.round(W * 0.34)), chars = Math.floor(lw / 6.2);
            const max = niceMax(Math.max(...points.map(p => Math.abs(p.value)), 0));
            return points.map((p, i) => {
                const w = Math.max(1, (Math.abs(p.value) / max) * (W - lw - 70));
                return (
                    <g key={p.label} transform={`translate(0, ${5 + i * rowH})`} onMouseMove={e => show(e, [p.label, money(p.value)])} onMouseLeave={hide}>
                        <rect x={0} y={0} width={W} height={rowH} fill="transparent" />
                        <text x={lw - 6} y={rowH / 2 + 4} fontSize={11} fill={INK} textAnchor="end">{p.label.length > chars ? `${p.label.slice(0, chars - 1)}…` : p.label}</text>
                        <rect x={lw} y={rowH * 0.18} width={w} height={rowH * 0.64} rx={3} fill={p.label === 'Other' ? OTHER : p.value < 0 ? SERIES[7] : SERIES[0]} />
                        <text x={lw + w + 4} y={rowH / 2 + 4} fontSize={10} fill={INK}>{short(p.value)}</text>
                    </g>
                );
            });
        }
        // vertical: bar / line / area
        const padL = 44, padB = 22, padT = 8, cw = W - padL - 6, ch = H - padB - padT;
        const vals = points.flatMap(p => [p.value, ...(two ? [p.value2 || 0] : [])]);
        const hi = niceMax(Math.max(0, ...vals)), lo = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(0, ...vals)) : 0;
        const y = (v: number) => padT + ch - ((v - lo) / (hi - lo)) * ch;
        const step = cw / points.length;
        const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f);
        const every = Math.ceil(points.length / Math.max(3, Math.floor(cw / 46)));
        const axis = (
            <>
                {ticks.map(v => <g key={v}><line x1={padL} x2={W - 6} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#b8b7b1' : GRID} /><text x={padL - 4} y={y(v) + 3} fontSize={10} fill={INK} textAnchor="end">{short(v)}</text></g>)}
                {points.map((p, i) => i % every === 0 && <text key={i} x={padL + step * i + step / 2} y={H - 6} fontSize={10} fill={INK} textAnchor="middle">{p.label}</text>)}
            </>
        );
        const tipLines = (p: SeriesPoint) => [p.label, `${name1}: ${money(p.value)}`, ...(two ? [`${name2}: ${money(p.value2 || 0)}`] : [])];
        if (type === 'bar') {
            const gw = step * 0.72, bw = two ? (gw - 2) / 2 : gw;
            return (
                <>
                    {axis}
                    {points.map((p, i) => {
                        const x0 = padL + step * i + (step - gw) / 2;
                        const bar = (v: number, x: number, color: string) => <rect x={x} y={Math.min(y(v), y(0))} width={Math.max(1, bw)} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={Math.min(4, bw / 3)} fill={color} />;
                        return (
                            <g key={i} onMouseMove={e => show(e, tipLines(p))} onMouseLeave={hide}>
                                <rect x={padL + step * i} y={padT} width={step} height={ch} fill="transparent" />
                                {bar(p.value, x0, SERIES[0])}
                                {two && bar(p.value2 || 0, x0 + bw + 2, SERIES[1])}
                            </g>
                        );
                    })}
                </>
            );
        }
        const cx = (i: number) => padL + step * i + step / 2;
        const path = (k: 'value' | 'value2') => points.map((p, i) => `${i ? 'L' : 'M'} ${cx(i)} ${y(Number(p[k]) || 0)}`).join(' ');
        const areaPath = (k: 'value' | 'value2') => `${path(k)} L ${cx(points.length - 1)} ${y(0)} L ${cx(0)} ${y(0)} Z`;
        return (
            <>
                {axis}
                {type === 'area' && two && <path d={areaPath('value2')} fill={SERIES[1]} opacity={0.15} />}
                {type === 'area' && <path d={areaPath('value')} fill={SERIES[0]} opacity={0.18} />}
                {two && <path d={path('value2')} fill="none" stroke={SERIES[1]} strokeWidth={2} />}
                <path d={path('value')} fill="none" stroke={SERIES[0]} strokeWidth={2} />
                {points.map((p, i) => (
                    <g key={i} onMouseMove={e => show(e, tipLines(p))} onMouseLeave={hide}>
                        <rect x={padL + step * i} y={padT} width={step} height={ch} fill="transparent" />
                        {points.length <= 31 && <circle cx={cx(i)} cy={y(p.value)} r={3} fill={SERIES[0]} stroke="#fff" strokeWidth={1.5} />}
                    </g>
                ))}
            </>
        );
    }, [type, points, two, H, W, name1, name2]);
    // a stacked pie legend needs more height than the tile default
    const svgH = (type === 'pie' || type === 'donut') && W < 420 ? Math.min(70, W / 2 - 20) * 2 + 36 + Math.min(8, points.filter(p => p.value > 0).length) * 20 : H;

    return <div ref={box} className="w-full">{content()}</div>;

    function content() {
    if (!points.length || (empty && type !== 'table')) return <p className="text-sm text-gray-400 text-center py-10">No data for this period</p>;
    if (type === 'table') {
        return (
            <div className="overflow-auto" style={{ maxHeight: height }} data-no-excel>
                <table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="text-left py-1">Name</th><th className="text-right">{name1}</th>{two && <th className="text-right">{name2}</th>}</tr></thead>
                    <tbody>{points.map(p => <tr key={p.label} className="border-t"><td className="py-1">{p.label}</td><td className="text-right tabular-nums">{money(p.value)}</td>{two && <td className="text-right tabular-nums">{money(p.value2 || 0)}</td>}</tr>)}</tbody></table>
            </div>
        );
    }
    return (
        <div className="relative" data-no-excel>
            {two && !['pie', 'donut', 'hbar'].includes(type) && (
                <div className="flex gap-4 text-[11px] text-gray-600 mb-1">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: SERIES[0] }} />{name1}</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: SERIES[1] }} />{name2}</span>
                </div>
            )}
            <svg viewBox={`0 0 ${W} ${svgH}`} width="100%" height={svgH} role="img" aria-label={`${type} chart`} style={{ overflow: 'visible' }}>{body}</svg>
            {tip && (
                <div className="absolute pointer-events-none bg-white border border-slate-300 shadow rounded px-2 py-1 text-xs z-10 whitespace-nowrap"
                    style={{ left: Math.min(tip.x + 12, W - 160), top: Math.max(0, tip.y - 10) }}>
                    {tip.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-semibold' : 'tabular-nums'}>{l}</div>)}
                </div>
            )}
        </div>
    );
    }
}
