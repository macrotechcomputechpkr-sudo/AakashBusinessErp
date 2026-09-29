// =============================================
// charts/DataChart.tsx
// Plain-SVG chart with any number of series, for the report grid's 📊 Chart
// panel (components/ReportGrid.jsx > GridChartPanel): column (grouped),
// stacked column, horizontal bar, line, area, pie and donut.
// Same rules as charts/Chart.tsx: one y-axis only, colours in the fixed
// categorical order (SERIES), "Other" always grey, a legend from two series
// up, a hover tooltip on every category. Clicking a category calls onPick
// (the grid filters itself to that category).
// =============================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SERIES, money, short } from './Chart';

export type DataChartType = 'column' | 'stacked' | 'hbar' | 'line' | 'area' | 'pie' | 'donut';
export interface DataSeries { name: string; values: number[] }
interface Props {
    type: DataChartType;
    categories: string[];
    series: DataSeries[];
    height?: number;
    /** a category was clicked (index into categories) */
    onPick?: (index: number) => void;
}
interface Tip { x: number; y: number; lines: string[] }

const OTHER = '#9b9a95', INK = '#52514e', GRID = '#e5e4e0', BASE = '#b8b7b1';
export const seriesColor = (name: string, i: number): string => (name === 'Other' ? OTHER : SERIES[i % SERIES.length]);
function nice(v: number): number {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

export default function DataChart({ type, categories, series, height = 280, onPick }: Props) {
    const [tip, setTip] = useState<Tip | null>(null);
    const box = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(720);
    useEffect(() => {
        const el = box.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setW(Math.max(280, w)); });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const n = categories.length, ns = series.length;
    const show = (e: React.MouseEvent, lines: string[]) => {
        const r = box.current?.getBoundingClientRect();
        if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, lines });
    };
    const hide = () => setTip(null);
    const linesFor = (i: number) => {
        const vals = series.map(s => Number(s.values[i]) || 0);
        const out = [categories[i], ...series.map((s, k) => `${ns > 1 ? `${s.name}: ` : ''}${money(vals[k])}`)];
        if (ns > 1 && (type === 'stacked' || type === 'column')) out.push(`Total: ${money(vals.reduce((a, b) => a + b, 0))}`);
        return out;
    };
    const pick = (i: number) => { if (onPick && categories[i] !== 'Other') onPick(i); };

    // one series: the "Other" bar (the folded rest) is grey like everywhere else
    const barColor = (name: string, k: number, category: string) => (ns === 1 && category === 'Other' ? OTHER : seriesColor(name, k));
    const hbarRow = ns > 1 ? Math.max(18, ns * 9 + 8) : 24;
    const H = type === 'hbar' ? Math.max(height, n * hbarRow + 30) : height;

    const body = useMemo(() => {
        if (!n || !ns) return null;
        // ---------- pie / donut: the first series, one slice per category ----------
        if (type === 'pie' || type === 'donut') {
            const vals = series[0].values.map(v => Number(v) || 0);
            const slices = categories.map((c, i) => ({ c, i, v: vals[i] })).filter(s => s.v > 0);
            const total = slices.reduce((s, x) => s + x.v, 0) || 1;
            const narrow = W < 520;
            const r = narrow ? Math.min(90, W / 2 - 20) : Math.min(H / 2 - 12, 120);
            const cx = narrow ? W / 2 : r + 16, cy = narrow ? r + 8 : H / 2, ir = type === 'donut' ? r * 0.58 : 0;
            const lx = narrow ? 8 : cx + r + 28, ly = narrow ? 2 * r + 34 : 22;
            const legendW = Math.min(W - lx - 6, 360);      // value right after its name, not at the far edge
            const chars = Math.max(8, Math.floor((legendW - 110) / 6.4));
            let a0 = -Math.PI / 2;
            const pt = (a: number, rr: number) => `${cx + rr * Math.cos(a)} ${cy + rr * Math.sin(a)}`;
            return (
                <>
                    {slices.map((s, k) => {
                        const a1 = a0 + (s.v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
                        const d = ir ? `M ${pt(a0, r)} A ${r} ${r} 0 ${large} 1 ${pt(a1, r)} L ${pt(a1, ir)} A ${ir} ${ir} 0 ${large} 0 ${pt(a0, ir)} Z`
                            : `M ${cx} ${cy} L ${pt(a0, r)} A ${r} ${r} 0 ${large} 1 ${pt(a1, r)} Z`;
                        a0 = a1;
                        const pct = Math.round(s.v * 1000 / total) / 10;
                        if (slices.length === 1) return <circle key={s.c} cx={cx} cy={cy} r={r} fill={seriesColor(s.c, k)} onClick={() => pick(s.i)} />;
                        return <path key={s.c} d={d} fill={seriesColor(s.c, k)} stroke="#fff" strokeWidth={2} style={{ cursor: onPick ? 'pointer' : undefined }}
                            onMouseMove={e => show(e, [s.c, `${money(s.v)} (${pct}%)`])} onMouseLeave={hide} onClick={() => pick(s.i)} />;
                    })}
                    {ir > 0 && <circle cx={cx} cy={cy} r={ir} fill="#fff" />}
                    {ir > 0 && <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={600} fill="#0b0b0b">{short(total)}</text>}
                    {slices.slice(0, 12).map((s, k) => (
                        <g key={s.c} transform={`translate(${lx}, ${ly + k * 20})`} style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => pick(s.i)}>
                            <rect width={10} height={10} rx={2} y={-9} fill={seriesColor(s.c, k)} />
                            <text x={16} fontSize={11} fill={INK}>{cut(s.c, chars)}</text>
                            <text x={legendW} fontSize={11} fill={INK} textAnchor="end">{short(s.v)} · {Math.round(s.v * 1000 / total) / 10}%</text>
                        </g>
                    ))}
                </>
            );
        }
        // ---------- horizontal bars (grouped when several series) ----------
        if (type === 'hbar') {
            const lw = Math.min(190, Math.round(W * 0.3)), chars = Math.floor(lw / 6.2);
            const all = series.flatMap(s => s.values.map(v => Number(v) || 0));
            const hi = nice(Math.max(0, ...all)), lo = Math.min(0, ...all) < 0 ? -nice(-Math.min(0, ...all)) : 0;
            const plotW = W - lw - 64;
            const x = (v: number) => lw + ((v - lo) / (hi - lo)) * plotW;
            const sub = (hbarRow - 6) / ns;
            return (
                <>
                    {[0, 0.25, 0.5, 0.75, 1].map(f => { const v = lo + (hi - lo) * f; return <g key={f}><line x1={x(v)} x2={x(v)} y1={4} y2={H - 18} stroke={v === 0 ? BASE : GRID} /><text x={x(v)} y={H - 4} fontSize={10} fill={INK} textAnchor="middle">{short(v)}</text></g>; })}
                    {categories.map((c, i) => (
                        <g key={i} transform={`translate(0, ${6 + i * hbarRow})`} onMouseMove={e => show(e, linesFor(i))} onMouseLeave={hide} onClick={() => pick(i)} style={{ cursor: onPick ? 'pointer' : undefined }}>
                            <rect x={0} y={0} width={W} height={hbarRow} fill="transparent" />
                            <text x={lw - 6} y={hbarRow / 2 + 4} fontSize={11} fill={INK} textAnchor="end">{cut(c, chars)}</text>
                            {series.map((s, k) => {
                                const v = Number(s.values[i]) || 0, x0 = Math.min(x(0), x(v)), w = Math.max(1, Math.abs(x(v) - x(0)));
                                return <rect key={k} x={x0} y={3 + k * sub} width={w} height={Math.max(2, sub - 2)} rx={Math.min(4, sub / 3)} fill={barColor(s.name, k, c)} />;
                            })}
                            {ns === 1 && <text x={Math.max(x(0), x(Number(series[0].values[i]) || 0)) + 4} y={hbarRow / 2 + 4} fontSize={10} fill={INK}>{short(Number(series[0].values[i]) || 0)}</text>}
                        </g>
                    ))}
                </>
            );
        }
        // ---------- vertical: column / stacked / line / area ----------
        const padL = 52, padB = 34, padT = 10, cw = W - padL - 8, ch = H - padB - padT;
        const stacked = type === 'stacked';
        let hiV = 0, loV = 0;
        categories.forEach((_, i) => {
            if (stacked) {
                let p = 0, m = 0;
                series.forEach(s => { const v = Number(s.values[i]) || 0; if (v >= 0) p += v; else m += v; });
                hiV = Math.max(hiV, p); loV = Math.min(loV, m);
            } else series.forEach(s => { const v = Number(s.values[i]) || 0; hiV = Math.max(hiV, v); loV = Math.min(loV, v); });
        });
        const hi = nice(hiV), lo = loV < 0 ? -nice(-loV) : 0;
        const y = (v: number) => padT + ch - ((v - lo) / (hi - lo)) * ch;
        const step = cw / n;
        const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(cw / 64))));
        const chars = Math.max(4, Math.floor((step * every) / 6.2));
        const axis = (
            <>
                {[0, 0.25, 0.5, 0.75, 1].map(f => { const v = lo + (hi - lo) * f; return <g key={f}><line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} stroke={v === 0 ? BASE : GRID} /><text x={padL - 5} y={y(v) + 3} fontSize={10} fill={INK} textAnchor="end">{short(v)}</text></g>; })}
                {lo < 0 && <line x1={padL} x2={W - 8} y1={y(0)} y2={y(0)} stroke={BASE} />}
                {categories.map((c, i) => i % every === 0 && <text key={i} x={padL + step * i + step / 2} y={H - padB + 16} fontSize={10} fill={INK} textAnchor="middle">{cut(c, chars)}</text>)}
            </>
        );
        const hit = (i: number) => <rect x={padL + step * i} y={padT} width={step} height={ch} fill="transparent" />;
        if (type === 'column' || stacked) {
            const gw = Math.min(step * 0.74, 64), bw = stacked ? gw : Math.max(1, (gw - (ns - 1) * 2) / ns);
            return (
                <>
                    {axis}
                    {categories.map((_, i) => {
                        const x0 = padL + step * i + (step - gw) / 2;
                        let up = 0, down = 0;
                        return (
                            <g key={i} onMouseMove={e => show(e, linesFor(i))} onMouseLeave={hide} onClick={() => pick(i)} style={{ cursor: onPick ? 'pointer' : undefined }}>
                                {hit(i)}
                                {series.map((s, k) => {
                                    const v = Number(s.values[i]) || 0;
                                    let a: number, b: number, x: number;
                                    if (stacked) { if (v >= 0) { a = up; up += v; b = up; } else { a = down; down += v; b = down; } x = x0; }
                                    else { a = 0; b = v; x = x0 + k * (bw + 2); }
                                    const top = Math.min(y(a), y(b)), h = Math.abs(y(a) - y(b));
                                    // a 2px surface gap between stacked segments
                                    return <rect key={k} x={x} y={top + (stacked && k ? 1 : 0)} width={bw} height={Math.max(stacked ? 0 : 1, h - (stacked && k ? 2 : 0))} rx={Math.min(4, bw / 3)} fill={barColor(s.name, k, categories[i])} />;
                                })}
                            </g>
                        );
                    })}
                </>
            );
        }
        const cx = (i: number) => padL + step * i + step / 2;
        const path = (s: DataSeries) => s.values.map((v, i) => `${i ? 'L' : 'M'} ${cx(i)} ${y(Number(v) || 0)}`).join(' ');
        return (
            <>
                {axis}
                {type === 'area' && series.map((s, k) => <path key={`a${k}`} d={`${path(s)} L ${cx(n - 1)} ${y(0)} L ${cx(0)} ${y(0)} Z`} fill={seriesColor(s.name, k)} opacity={ns > 1 ? 0.12 : 0.18} />)}
                {series.map((s, k) => <path key={k} d={path(s)} fill="none" stroke={seriesColor(s.name, k)} strokeWidth={2} />)}
                {categories.map((_, i) => (
                    <g key={i} onMouseMove={e => show(e, linesFor(i))} onMouseLeave={hide} onClick={() => pick(i)} style={{ cursor: onPick ? 'pointer' : undefined }}>
                        {hit(i)}
                        {n <= 40 && series.map((s, k) => <circle key={k} cx={cx(i)} cy={y(Number(s.values[i]) || 0)} r={4} fill={seriesColor(s.name, k)} stroke="#fff" strokeWidth={2} />)}
                    </g>
                ))}
            </>
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type, categories, series, W, H, n, ns, hbarRow, onPick]);

    if (!n || !ns || series.every(s => s.values.every(v => !Number(v)))) return <div ref={box} className="w-full"><p className="text-sm text-gray-400 text-center py-10">Nothing to chart - pick a value column, or clear the filters.</p></div>;
    const legend = ns > 1 && type !== 'pie' && type !== 'donut';
    return (
        <div ref={box} className="relative w-full" data-no-excel>
            {legend && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-700 mb-1">
                    {series.map((s, k) => <span key={s.name} className="flex items-center gap-1"><span className="inline-block w-3 h-2.5 rounded-sm" style={{ background: seriesColor(s.name, k) }} />{s.name}</span>)}
                </div>
            )}
            <div style={{ maxHeight: type === 'hbar' ? 520 : undefined, overflowY: type === 'hbar' ? 'auto' : undefined }}>
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${type} chart`} style={{ overflow: 'visible', display: 'block' }} xmlns="http://www.w3.org/2000/svg" fontFamily="Segoe UI, Arial, sans-serif">{body}</svg>
            </div>
            {tip && (
                <div className="absolute pointer-events-none bg-white border border-slate-300 shadow rounded px-2 py-1 text-xs z-20 whitespace-nowrap"
                    style={{ left: Math.min(tip.x + 14, W - 200), top: Math.max(0, tip.y - 12) }}>
                    {tip.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-semibold' : 'tabular-nums'}>{l}</div>)}
                </div>
            )}
        </div>
    );
}
