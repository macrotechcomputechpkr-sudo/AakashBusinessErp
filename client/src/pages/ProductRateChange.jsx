// =============================================
// ProductRateChange.jsx
// Two utilities: (1) Rate Change - pick a product, update Purchase/MRP/
// Sr1-Sr5 across its Base Unit AND every Alt Unit at once; propagates to
// any assembled product that lists this one as an auto-recalculate BOM
// component. (2) Batch Rate Update - correct one batch's rate, which
// recomputes the product's overall (weighted-average) opening rate.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';

export default function ProductRateChange() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [tab, setTab] = useState('rate');
    const [products, setProducts] = useState([]);
    const [alert, setAlert] = useState(null);

    const [selectedProductId, setSelectedProductId] = useState('');
    const [unitRates, setUnitRates] = useState([]);
    const [units, setUnits] = useState([]);

    const [batchProductId, setBatchProductId] = useState('');
    const [batches, setBatches] = useState([]);

    const [correctProductId, setCorrectProductId] = useState('');
    const [trackingRecords, setTrackingRecords] = useState({ batches: [], serials: [] });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [p, u] = await Promise.all([
                authFetch('/api/products'),
                authFetch('/api/product-units')
            ]);
            setProducts(p.data || []);
            setUnits(u.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const unitName = (unitId) => units.find(u => u.id === unitId)?.unit_name || unitId;

    const loadUnitRates = async (productId) => {
        setSelectedProductId(productId);
        if (!productId) return setUnitRates([]);
        // FIX: there is no GET /products/:id single-item endpoint - the
        // list endpoint already embeds each product's product_unit_rates,
        // so find it there instead of calling a route that doesn't exist.
        const product = products.find(p => p.id === productId);
        setUnitRates((product?.product_unit_rates || []).map(u => ({ ...u })));
    };

    const setUnitField = (id, field, value) => setUnitRates(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r));

    const saveRateChange = async () => {
        try {
            const res = await authFetch('/api/product-opening/rate-change', {
                method: 'PUT',
                body: JSON.stringify({
                    product_id: selectedProductId,
                    unit_rates: unitRates.map(u => ({
                        unit_rate_id: u.id, purchase_rate: u.purchase_rate, mrp: u.mrp,
                        sales_rate_sr1: u.sales_rate_sr1, sales_rate_sr2: u.sales_rate_sr2,
                        sales_rate_sr3: u.sales_rate_sr3, sales_rate_sr4: u.sales_rate_sr4, sales_rate_sr5: u.sales_rate_sr5
                    }))
                })
            });
            let msg = res.message;
            if (res.recalculated?.length > 0) msg += ` - also recalculated ${res.recalculated.length} assembled product(s) that use this as a component`;
            showAlert(msg, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const loadBatches = async (productId) => {
        setBatchProductId(productId);
        if (!productId) return setBatches([]);
        try {
            const res = await authFetch(`/api/product-opening/batches?product_id=${productId}`);
            setBatches(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const updateBatchRate = async (batchId, rate) => {
        try {
            await authFetch('/api/product-opening/batch-rate-update', { method: 'PUT', body: JSON.stringify({ batch_id: batchId, rate }) });
            showAlert('Batch rate updated - product opening rate recomputed', 'success');
            loadBatches(batchProductId);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const loadTrackingRecords = async (productId) => {
        setCorrectProductId(productId);
        if (!productId) return setTrackingRecords({ batches: [], serials: [] });
        try {
            const res = await authFetch(`/api/product-opening/tracking-records?product_id=${productId}`);
            setTrackingRecords(res.data);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const correctBatchNo = async (id, newNo) => {
        try {
            await authFetch(`/api/product-opening/batches/${id}/correct-number`, { method: 'PUT', body: JSON.stringify({ new_batch_no: newNo }) });
            showAlert('Batch number corrected', 'success');
            loadTrackingRecords(correctProductId);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const correctSerialNo = async (id, newNo) => {
        try {
            await authFetch(`/api/product-opening/serials/${id}/correct-number`, { method: 'PUT', body: JSON.stringify({ new_serial_no: newNo }) });
            showAlert('Serial number corrected', 'success');
            loadTrackingRecords(correctProductId);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div ref={enterAreaRef} className="max-w-4xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Product Rate Change</h1>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 w-fit">
                <button onClick={() => setTab('rate')} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'rate' ? 'bg-white shadow' : 'text-gray-500'}`}>Rate Change</button>
                <button onClick={() => setTab('batch')} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'batch' ? 'bg-white shadow' : 'text-gray-500'}`}>Batch Rate Update</button>
                <button onClick={() => setTab('correct')} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'correct' ? 'bg-white shadow' : 'text-gray-500'}`}>Correct Batch/Serial No.</button>
            </div>

            {tab === 'rate' && (
                <div className="bg-white border rounded-xl p-6">
                    <label className="block text-sm font-medium mb-1">Product</label>
                    <div className="mb-4 max-w-md">
                        <SearchablePopupSelect
                            listKey="rate_change_product_picker"
                            columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                            defaultVisibleKeys={['product_name']}
                            items={products} getId={p => p.id} getLabel={p => p.product_name}
                            searchKeys={['product_name', 'product_code']}
                            value={selectedProductId} onChange={loadUnitRates}
                            placeholder="Select Product"
                        />
                    </div>

                    {unitRates.length > 0 && (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm mb-4">
                                    <thead>
                                        <tr className="text-xs text-gray-500 uppercase">
                                            <th className="text-left px-2 py-1">Unit</th>
                                            <th className="text-left px-2 py-1">Purchase</th>
                                            <th className="text-left px-2 py-1">MRP</th>
                                            <th className="text-left px-2 py-1">Sr1</th>
                                            <th className="text-left px-2 py-1">Sr2</th>
                                            <th className="text-left px-2 py-1">Sr3</th>
                                            <th className="text-left px-2 py-1">Sr4</th>
                                            <th className="text-left px-2 py-1">Sr5</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {unitRates.map(u => (
                                            <tr key={u.id} className="border-t border-gray-100">
                                                <td className="px-2 py-1">{unitName(u.unit_id)} {u.is_base_unit && <span className="text-[10px] bg-gray-100 px-1 rounded">Base</span>}</td>
                                                {['purchase_rate', 'mrp', 'sales_rate_sr1', 'sales_rate_sr2', 'sales_rate_sr3', 'sales_rate_sr4', 'sales_rate_sr5'].map(f => (
                                                    <td key={f} className="px-2 py-1">
                                                        <input type="number" step="0.0001" className="w-20 border rounded px-1.5 py-1" value={u[f] ?? 0} onChange={e => setUnitField(u.id, f, e.target.value)} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <button onClick={saveRateChange} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">💾 Save Rate Change</button>
                        </>
                    )}
                </div>
            )}

            {tab === 'batch' && (
                <div className="bg-white border rounded-xl p-6">
                    <label className="block text-sm font-medium mb-1">Product</label>
                    <div className="mb-4 max-w-md">
                        <SearchablePopupSelect
                            listKey="batch_rate_product_picker"
                            columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                            defaultVisibleKeys={['product_name']}
                            items={products} getId={p => p.id} getLabel={p => p.product_name}
                            searchKeys={['product_name', 'product_code']}
                            value={batchProductId} onChange={loadBatches}
                            placeholder="Select Product"
                        />
                    </div>

                    {batches.length > 0 && (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-gray-500 uppercase">
                                    <th className="text-left px-2 py-1">Batch No</th>
                                    <th className="text-left px-2 py-1">Qty</th>
                                    <th className="text-left px-2 py-1">Rate</th>
                                    <th className="text-left px-2 py-1"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {batches.map(b => (
                                    <BatchRow key={b.id} batch={b} onSave={updateBatchRate} />
                                ))}
                            </tbody>
                        </table>
                    )}
                    {batchProductId && batches.length === 0 && <p className="text-sm text-gray-400">No batches recorded for this product.</p>}
                </div>
            )}

            {tab === 'correct' && (
                <div className="bg-white border rounded-xl p-6">
                    <p className="text-xs text-gray-400 mb-4">
                        Fixes a typo in a Batch or Serial Number itself (not its Qty/Rate -
                        use the tabs above for that). Once a Sales/Purchase/Production
                        module exists and references these records by ID rather than the
                        raw number, a correction here stays correct everywhere
                        automatically - recorded in the audit log either way.
                    </p>
                    <label className="block text-sm font-medium mb-1">Product</label>
                    <div className="mb-4 max-w-md">
                        <SearchablePopupSelect
                            listKey="correct_number_product_picker"
                            columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                            defaultVisibleKeys={['product_name']}
                            items={products} getId={p => p.id} getLabel={p => p.product_name}
                            searchKeys={['product_name', 'product_code']}
                            value={correctProductId} onChange={loadTrackingRecords}
                            placeholder="Select Product"
                        />
                    </div>

                    {trackingRecords.batches.length > 0 && (
                        <>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Batches</p>
                            {trackingRecords.batches.map(b => <CorrectRow key={b.id} record={b} field="batch_no" onSave={correctBatchNo} />)}
                        </>
                    )}
                    {trackingRecords.serials.length > 0 && (
                        <>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-4">Serial Numbers</p>
                            {trackingRecords.serials.map(s => <CorrectRow key={s.id} record={s} field="serial_no" onSave={correctSerialNo} />)}
                        </>
                    )}
                    {correctProductId && trackingRecords.batches.length === 0 && trackingRecords.serials.length === 0 && (
                        <p className="text-sm text-gray-400">No batch or serial records for this product.</p>
                    )}
                </div>
            )}
        </div>
        </Layout>
    );
}

function CorrectRow({ record, field, onSave }) {
    const [value, setValue] = useState(record[field]);
    const changed = value !== record[field];
    return (
        <div className="flex items-center gap-2 mb-2">
            <input className="border rounded px-2 py-1.5 text-sm w-48" value={value} onChange={e => setValue(e.target.value)} />
            <button onClick={() => onSave(record.id, value)} disabled={!changed || !value.trim()} className="text-xs text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline">
                Save Correction
            </button>
        </div>
    );
}

function BatchRow({ batch, onSave }) {
    const [rate, setRate] = useState(batch.rate);
    return (
        <tr className="border-t border-gray-100">
            <td className="px-2 py-1">{batch.batch_no}</td>
            <td className="px-2 py-1">{batch.qty}</td>
            <td className="px-2 py-1"><input type="number" step="0.0001" className="w-24 border rounded px-1.5 py-1" value={rate} onChange={e => setRate(e.target.value)} /></td>
            <td className="px-2 py-1"><button onClick={() => onSave(batch.id, rate)} className="text-xs text-blue-600 hover:underline">Update</button></td>
        </tr>
    );
}
