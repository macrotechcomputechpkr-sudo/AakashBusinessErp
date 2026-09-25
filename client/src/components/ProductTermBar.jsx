// =============================================
// components/ProductTermBar.jsx
// "Product Level Discount... Product Level Billing Term popup huda
// multiple row maa aunu paryo." A Term Summary bar sitting above a
// detail grid: type ONE discount (percent, or Rs distributed
// proportionally by each line's gross amount) and Apply it either to
// every line, or to a checkbox-selected subset via the popup - without
// requiring a new schema column, since it writes straight into the
// same discount_percent field every line already has.
//
// Rs mode: distributes the Rs total across the target lines
// proportionally to each line's OWN gross (qty * rate, dual-UOM aware
// via the caller-supplied lineGross), then converts that back to a
// per-line percent so the stored value - and every downstream GL/
// stock calculation that already reads discount_percent - needs no
// changes at all.
// =============================================

import React, { useState } from 'react';

export default function ProductTermBar({ details, selectedIndexes, onSelectedIndexesChange, lineGross, onApply }) {
    const [value, setValue] = useState('');
    const [unit, setUnit] = useState('pct');
    const [showRowPicker, setShowRowPicker] = useState(false);

    const targetIndexes = selectedIndexes && selectedIndexes.length > 0
        ? selectedIndexes
        : details.map((_, i) => i);

    const applyTerm = (indexes) => {
        const v = Number(value);
        if (!v || v <= 0) return;
        if (unit === 'pct') {
            onApply(indexes.map(idx => ({ idx, discount_percent: v })));
            return;
        }
        const grosses = indexes.map(idx => lineGross(details[idx]));
        const grossSum = grosses.reduce((s, g) => s + g, 0);
        if (grossSum <= 0) return;
        const updates = indexes.map((idx, i) => {
            const amt = v * (grosses[i] / grossSum);
            const pct = grosses[i] > 0 ? (amt / grosses[i]) * 100 : 0;
            return { idx, discount_percent: +pct.toFixed(4) };
        });
        onApply(updates);
    };

    return (
        <div className="flex flex-wrap items-end gap-2 mb-3 p-2 bg-slate-50 rounded-lg border">
            <div className="erp-field" style={{ minWidth: '110px' }}>
                <label className="erp-label">Product Discount</label>
                <input type="number" step="0.01" className="erp-input" value={value} onChange={e => setValue(e.target.value)} placeholder="0" />
            </div>
            <div className="erp-field" style={{ width: '90px' }}>
                <label className="erp-label">Unit</label>
                <select className="erp-select" value={unit} onChange={e => setUnit(e.target.value)}>
                    <option value="pct">%</option>
                    <option value="amt">Rs</option>
                </select>
            </div>
            <button type="button" onClick={() => applyTerm(details.map((_, i) => i))} className="erp-btn">
                Apply to All ({details.length})
            </button>
            <button type="button" onClick={() => setShowRowPicker(true)} className="erp-btn">
                Apply to Selected Rows…
            </button>
            {selectedIndexes && selectedIndexes.length > 0 && (
                <span className="text-xs text-gray-500">{selectedIndexes.length} row(s) currently checked</span>
            )}

            {showRowPicker && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                        <div className="erp-header"><span className="erp-header-title">Apply Product Term to Rows</span></div>
                        <div className="p-4">
                            <p className="text-xs text-gray-400 mb-2">Check the rows this discount should apply to, then Apply.</p>
                            <div className="space-y-1 max-h-72 overflow-y-auto">
                                {details.map((d, idx) => (
                                    <label key={idx} className="flex items-center gap-2 text-sm border-b py-1.5">
                                        <input
                                            type="checkbox"
                                            checked={(selectedIndexes || []).includes(idx)}
                                            onChange={e => {
                                                const current = selectedIndexes || [];
                                                onSelectedIndexesChange(e.target.checked ? [...current, idx] : current.filter(i => i !== idx));
                                            }}
                                        />
                                        <span>Row {idx + 1}{d.product_id ? '' : ' (empty)'} — Gross: {lineGross(d).toFixed(2)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="erp-bottombar">
                            <button type="button" onClick={() => onSelectedIndexesChange([])} className="erp-btn">Clear Selection</button>
                            <div className="erp-bottombar-actions">
                                <button type="button" onClick={() => setShowRowPicker(false)} className="erp-btn">Close</button>
                                <button
                                    type="button"
                                    onClick={() => { applyTerm(targetIndexes); setShowRowPicker(false); }}
                                    className="erp-btn primary"
                                    disabled={!selectedIndexes || selectedIndexes.length === 0}
                                >
                                    Apply to {targetIndexes.length} Selected
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
