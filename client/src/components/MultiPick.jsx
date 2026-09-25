// =============================================
// MultiPick.jsx
// Compact multi-select filter: a button showing the choice ("All", one
// name, or "3 selected") that opens a searchable checkbox list.
//   <MultiPick label="Customer" items={[{ id, name }]} value={ids} onChange={ids => ...} />
// =============================================
import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function MultiPick({ label, items = [], value = [], onChange, allLabel = 'All' }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    const shown = useMemo(() => {
        const s = search.trim().toLowerCase();
        return s ? items.filter(i => String(i.name).toLowerCase().includes(s)) : items;
    }, [items, search]);
    const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
    const text = !value.length ? allLabel : value.length === 1 ? items.find(i => i.id === value[0])?.name || '1 selected' : `${value.length} selected`;

    return (
        <div className="erp-field relative" ref={ref}>
            <label className="erp-label">{label}</label>
            <button type="button" className="erp-select text-left truncate" onClick={() => setOpen(o => !o)} title={text}>{text}</button>
            {open && (
                <div className="absolute z-20 mt-1 w-72 max-w-[90vw] bg-white border rounded shadow-lg p-2" style={{ top: '100%' }}>
                    <input autoFocus className="erp-input mb-1" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                    <div className="flex justify-between text-xs mb-1">
                        <button type="button" className="text-blue-600" onClick={() => onChange([...new Set([...value, ...shown.map(i => i.id)])])}>Select shown</button>
                        <button type="button" className="text-gray-600" onClick={() => onChange([])}>Clear</button>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                        {shown.map(i => (
                            <label key={i.id} className="flex items-center gap-2 py-0.5 text-sm cursor-pointer">
                                <input type="checkbox" checked={value.includes(i.id)} onChange={() => toggle(i.id)} /> <span className="truncate">{i.name}</span>
                            </label>
                        ))}
                        {shown.length === 0 && <p className="text-xs text-gray-400 py-2 text-center">Nothing found</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
