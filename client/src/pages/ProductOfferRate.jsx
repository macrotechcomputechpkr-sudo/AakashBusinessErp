// =============================================
// ProductOfferRate.jsx
// Time-bound promotional pricing: pick a Product, a From/To date range,
// and whether the offer is a Discount (tied to a Billing Term) or a
// flat override Rate for that period.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const emptyForm = { product_id: '', from_date: '', to_date: '', offer_kind: 'discount', billing_term_id: '', offer_rate: '' };

export default function ProductOfferRate() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [products, setProducts] = useState([]);
    const [billingTerms, setBillingTerms] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [o, p, bt] = await Promise.all([
                authFetch('/api/product-offer-rates'),
                authFetch('/api/products'),
                authFetch('/api/billing-terms')
            ]);
            setRows(o.data || []);
            setProducts(p.data || []);
            setBillingTerms(bt.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.product_id || !form.from_date || !form.to_date) return showAlert('Product, From Date, and To Date are required', 'danger');
        try {
            await authFetch('/api/product-offer-rates', { method: 'POST', body: JSON.stringify(form) });
            showAlert('Offer rate created', 'success');
            setForm(emptyForm);
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm('Remove this offer?')) return;
        try {
            await authFetch(`/api/product-offer-rates/${row.id}`, { method: 'DELETE' });
            showAlert('Offer removed', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'product', label: 'Product', type: 'text', render: r => r.product?.product_name || '—' },
        { key: 'from_date', label: 'From', type: 'text' },
        { key: 'to_date', label: 'To', type: 'text' },
        { key: 'offer_kind', label: 'Kind', type: 'text' },
        { key: 'detail', label: 'Detail', type: 'text', render: r => r.offer_kind === 'discount' ? (r.billing_term?.term_name || '—') : r.offer_rate }
    ];

    return (
        <Layout>
        <div className="max-w-4xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Offer Rate</h1>
                <button onClick={() => { setForm(emptyForm); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Offer'}
                </button>
            </div>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <div>
                        <label className="erp-label">Product *</label>
                        <SearchablePopupSelect
                            listKey="offer_rate_product_picker"
                            columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                            defaultVisibleKeys={['product_name']}
                            items={products} getId={p => p.id} getLabel={p => p.product_name}
                            searchKeys={['product_name', 'product_code']}
                            value={form.product_id} onChange={id => setForm({ ...form, product_id: id })}
                            placeholder="Select Product" required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="erp-label">From Date *</label>
                            <input type="date" className="erp-input" value={form.from_date} onChange={e => setForm({ ...form, from_date: e.target.value })} required />
                        </div>
                        <div>
                            <label className="erp-label">To Date *</label>
                            <input type="date" className="erp-input" value={form.to_date} onChange={e => setForm({ ...form, to_date: e.target.value })} required />
                        </div>
                    </div>

                    <div>
                        <label className="erp-label">Is this a Discount or a Rate?</label>
                        <select className="erp-input" value={form.offer_kind} onChange={e => setForm({ ...form, offer_kind: e.target.value })}>
                            <option value="discount">Discount</option>
                            <option value="rate">Rate</option>
                        </select>
                    </div>

                    {form.offer_kind === 'discount' ? (
                        <div>
                            <label className="erp-label">Discount Term *</label>
                            <SearchablePopupSelect
                                listKey="offer_rate_billing_term_picker"
                                columns={[{ key: 'term_code', label: 'Code' }, { key: 'term_name', label: 'Name' }]}
                                defaultVisibleKeys={['term_name']}
                                items={billingTerms} getId={t => t.id} getLabel={t => t.term_name}
                                searchKeys={['term_name', 'term_code']}
                                value={form.billing_term_id} onChange={id => setForm({ ...form, billing_term_id: id })}
                                placeholder="Select Billing Term" required
                            />
                        </div>
                    ) : (
                        <div className="max-w-xs">
                            <label className="erp-label">Offer Rate *</label>
                            <input type="number" step="0.01" className="erp-input" value={form.offer_rate} onChange={e => setForm({ ...form, offer_rate: e.target.value })} required />
                            <p className="text-xs text-gray-400 mt-1">This product sells at this flat rate for the period above, overriding its normal Sales Rate.</p>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { setForm(emptyForm); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">Create Offer</button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="offer_rate_grid"
                rowActions={(row) => <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>}
            />
        </div>
        </Layout>
    );
}
