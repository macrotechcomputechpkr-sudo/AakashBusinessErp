// =============================================
// RouteSequencing.jsx
// New: sets the order in which a salesman's mobile order-taking app lists
// customers on a Route (e.g. Route "Bagar" under Area "Pokhara"). Backed
// by server/routes/partyMasterRoutes.js's /routes/:id/customers endpoints
// and the tenant_master.route_customers table.
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

export default function RouteSequencing() {
    const { authFetch } = useAuth();
    const [routes, setRoutes] = useState([]);
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [customers, setCustomers] = useState([]); // route_customers rows, ordered
    const [candidates, setCandidates] = useState([]); // all sales/both ledger accounts
    const [search, setSearch] = useState('');
    const [alert, setAlert] = useState(null);
    const [dirty, setDirty] = useState(false);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 4000); };

    const loadRoutes = useCallback(async () => {
        try {
            const res = await authFetch('/api/routes');
            setRoutes(res.data || []);
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch]);

    const loadCandidates = useCallback(async () => {
        try {
            // Pull a generous page of customer-type ledger accounts to pick from.
            const res = await authFetch('/api/ledger-accounts?pageSize=200&category_type=sales');
            const res2 = await authFetch('/api/ledger-accounts?pageSize=200&category_type=both');
            setCandidates([...(res.data || []), ...(res2.data || [])]);
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch]);

    const loadRouteCustomers = useCallback(async (routeId) => {
        if (!routeId) { setCustomers([]); return; }
        try {
            const res = await authFetch(`/api/routes/${routeId}/customers`);
            setCustomers(res.data || []);
            setDirty(false);
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch]);

    useEffect(() => { loadRoutes(); loadCandidates(); }, [loadRoutes, loadCandidates]);
    useEffect(() => { loadRouteCustomers(selectedRouteId); }, [selectedRouteId, loadRouteCustomers]);

    const move = (index, dir) => {
        setCustomers(list => {
            const next = [...list];
            const swapIdx = index + dir;
            if (swapIdx < 0 || swapIdx >= next.length) return list;
            [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
            return next;
        });
        setDirty(true);
    };

    const saveOrder = async () => {
        try {
            await authFetch(`/api/routes/${selectedRouteId}/customers/reorder`, {
                method: 'PUT',
                body: JSON.stringify({ order: customers.map(c => c.id) })
            });
            showAlert('Visiting order saved', 'success');
            setDirty(false);
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const addCustomer = async (ledgerAccountId) => {
        try {
            await authFetch(`/api/routes/${selectedRouteId}/customers`, {
                method: 'POST',
                body: JSON.stringify({ ledger_account_id: ledgerAccountId })
            });
            loadRouteCustomers(selectedRouteId);
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const removeCustomer = async (routeCustomerId) => {
        try {
            await authFetch(`/api/routes/${selectedRouteId}/customers/${routeCustomerId}`, { method: 'DELETE' });
            loadRouteCustomers(selectedRouteId);
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const onRoute = new Set(customers.map(c => c.ledger_accounts?.id));
    const availableCandidates = candidates.filter(c =>
        !onRoute.has(c.id) && (c.account_name || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <Layout>
            <div className="max-w-4xl mx-auto p-4">
                <h1 className="text-2xl font-bold mb-4">Route Customer Sequencing</h1>
                <p className="text-sm text-gray-500 mb-4">
                    Sets the order customers appear in for the salesman's mobile order-taking app on this route.
                </p>

                {alert && (
                    <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                        alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                        alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                        'bg-yellow-50 border-yellow-500 text-yellow-800'
                    }`}>{alert.message}</div>
                )}

                <div className="mb-4">
                    <label className="block text-sm font-medium mb-1">Route</label>
                    <select className="w-full md:w-96 border rounded-lg px-3 py-2" value={selectedRouteId} onChange={e => setSelectedRouteId(e.target.value)}>
                        <option value="">Select a route</option>
                        {routes.map(r => (
                            <option key={r.id} value={r.id}>{r.route_name} ({r.areas?.area_name || 'no area'})</option>
                        ))}
                    </select>
                </div>

                {selectedRouteId && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-white border rounded-xl p-4">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="font-semibold">Visiting Order</h2>
                                {dirty && <button onClick={saveOrder} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">💾 Save Order</button>}
                            </div>
                            {customers.length === 0 && <p className="text-sm text-gray-400">No customers on this route yet.</p>}
                            <ol className="space-y-2">
                                {customers.map((c, i) => (
                                    <li key={c.id} className="flex items-center justify-between bg-gray-50 border rounded-lg px-3 py-2">
                                        <span className="text-sm">
                                            <span className="text-gray-400 mr-2">{i + 1}.</span>
                                            {c.ledger_accounts?.account_name} <span className="text-xs text-gray-400">({c.ledger_accounts?.account_code})</span>
                                        </span>
                                        <div className="flex gap-1">
                                            <button onClick={() => move(i, -1)} className="px-2 py-1 text-gray-500 hover:text-gray-800">↑</button>
                                            <button onClick={() => move(i, 1)} className="px-2 py-1 text-gray-500 hover:text-gray-800">↓</button>
                                            <button onClick={() => removeCustomer(c.id)} className="px-2 py-1 text-red-500 hover:text-red-700">✕</button>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </div>

                        <div className="bg-white border rounded-xl p-4">
                            <h2 className="font-semibold mb-3">Add Customer to Route</h2>
                            <input
                                className="w-full border rounded-lg px-3 py-2 mb-3"
                                placeholder="Search customers..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                            <div className="max-h-80 overflow-y-auto space-y-1">
                                {availableCandidates.map(c => (
                                    <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50">
                                        <span className="text-sm">{c.account_name} <span className="text-xs text-gray-400">({c.account_code})</span></span>
                                        <button onClick={() => addCustomer(c.id)} className="px-2 py-1 bg-purple-600 text-white rounded text-xs">➕ Add</button>
                                    </div>
                                ))}
                                {availableCandidates.length === 0 && <p className="text-sm text-gray-400">No matching customers.</p>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
}
