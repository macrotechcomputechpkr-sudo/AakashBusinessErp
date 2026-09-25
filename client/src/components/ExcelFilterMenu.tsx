// =============================================
// ExcelFilterMenu.tsx
// The spreadsheet-style column filter: sort A→Z / Z→A, search the values,
// tick / untick each distinct value (with its count), Select all, Clear.
// Used by ReportGrid's column headers and by useExcelTableFilters (which
// adds the same ▼ button to every plain report table).
// =============================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface FilterValue { value: string; count: number }

interface Props {
    anchor: { left: number; top: number; bottom: number };
    title?: string;
    values: FilterValue[];
    /** null = no filter (everything allowed) */
    selected: Set<string> | null;
    onApply: (allowed: Set<string> | null) => void;
    onSort?: (dir: 'asc' | 'desc') => void;
    onClose: () => void;
}

export const BLANK = '(Blanks)';

export default function ExcelFilterMenu({ anchor, title, values, selected, onApply, onSort, onClose }: Props) {
    const [search, setSearch] = useState('');
    const [ticked, setTicked] = useState<Set<string>>(() => new Set(selected ? Array.from(selected) : values.map(v => v.value)));
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        const t = setTimeout(() => document.addEventListener('mousedown', close), 0);
        document.addEventListener('keydown', esc);
        return () => { clearTimeout(t); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, [onClose]);

    const shown = useMemo(() => {
        const s = search.trim().toLowerCase();
        return s ? values.filter(v => v.value.toLowerCase().includes(s)) : values;
    }, [values, search]);
    const allShownTicked = shown.length > 0 && shown.every(v => ticked.has(v.value));
    const toggle = (v: string) => setTicked(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n; });
    const toggleShown = () => setTicked(prev => {
        const n = new Set(prev);
        shown.forEach(v => (allShownTicked ? n.delete(v.value) : n.add(v.value)));
        return n;
    });
    const apply = () => {
        // with a search typed, OK keeps only the matching ticked values (as a spreadsheet does)
        const keep = search.trim() ? new Set(shown.filter(v => ticked.has(v.value)).map(v => v.value)) : ticked;
        onApply(keep.size === values.length ? null : keep);
        onClose();
    };

    const width = 260;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    const top = Math.min(anchor.bottom + 2, window.innerHeight - 380);

    return createPortal(
        <div ref={ref} data-enter-nav="off" className="fixed z-[1000] bg-white border border-slate-300 rounded-lg shadow-xl text-sm normal-case font-normal text-gray-800"
            style={{ left, top: Math.max(8, top), width }} onClick={e => e.stopPropagation()}>
            {title && <div className="px-3 pt-2 text-xs font-semibold text-gray-500 truncate">{title}</div>}
            {onSort && (
                <div className="border-b py-1">
                    <button type="button" className="w-full text-left px-3 py-1 hover:bg-slate-100" onClick={() => { onSort('asc'); onClose(); }}>↑ Sort A → Z / smallest first</button>
                    <button type="button" className="w-full text-left px-3 py-1 hover:bg-slate-100" onClick={() => { onSort('desc'); onClose(); }}>↓ Sort Z → A / largest first</button>
                </div>
            )}
            <div className="p-2">
                <input autoFocus className="w-full border rounded px-2 py-1 text-sm" placeholder="Search values…" value={search} onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); apply(); } }} />
                <div className="mt-2 max-h-56 overflow-y-auto border rounded">
                    <label className="flex items-center gap-2 px-2 py-1 border-b bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={allShownTicked} onChange={toggleShown} /> <b>(Select all{search ? ' shown' : ''})</b>
                    </label>
                    {shown.slice(0, 1000).map(v => (
                        <label key={v.value} className="flex items-center gap-2 px-2 py-0.5 hover:bg-slate-50 cursor-pointer">
                            <input type="checkbox" checked={ticked.has(v.value)} onChange={() => toggle(v.value)} />
                            <span className="truncate flex-1" title={v.value}>{v.value}</span>
                            <span className="text-[11px] text-gray-400">{v.count}</span>
                        </label>
                    ))}
                    {shown.length === 0 && <p className="px-2 py-2 text-xs text-gray-400">No matching values</p>}
                    {shown.length > 1000 && <p className="px-2 py-1 text-xs text-gray-400">First 1000 of {shown.length} - search to narrow</p>}
                </div>
            </div>
            <div className="flex justify-between gap-2 px-2 pb-2">
                <button type="button" className="px-2 py-1 text-xs border rounded" onClick={() => { onApply(null); onClose(); }}>Clear filter</button>
                <div className="flex gap-2">
                    <button type="button" className="px-3 py-1 text-xs border rounded" onClick={onClose}>Cancel</button>
                    <button type="button" className="px-3 py-1 text-xs rounded bg-blue-600 text-white" onClick={apply}>OK</button>
                </div>
            </div>
        </div>,
        document.body
    );
}

/** Distinct values with counts, blanks shown as "(Blanks)", sorted naturally. */
export function distinctValues(list: unknown[]): FilterValue[] {
    const m = new Map<string, number>();
    list.forEach(v => { const k = v === null || v === undefined || String(v).trim() === '' ? BLANK : String(v).trim(); m.set(k, (m.get(k) || 0) + 1); });
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return Array.from(m.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => coll.compare(a.value, b.value));
}
export const cellKey = (v: unknown): string => (v === null || v === undefined || String(v).trim() === '' ? BLANK : String(v).trim());
