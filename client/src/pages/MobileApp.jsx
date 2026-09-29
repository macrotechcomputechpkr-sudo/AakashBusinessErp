// =============================================
// MobileApp.jsx  (/mobile)
// The salesman's phone screen (server: routes/salesmanRoutes.js /api/mobile):
//   Today    the route(s) planned for the salesman on the day (a date-range
//            plan shows its route on each date of the range); open a route
//            to see its customers in visiting sequence (with search), with
//            balance and visit / order status: Order, Receipt, No order
//   Receipt  cash / cheque received from a customer of today's route - a
//            draft Cash Receipt tagged with the salesman, posted by the office
//            (Mobile Approvals)
//   Return   sales return of a customer of ANY area / route (choose area,
//            route, customer), items and qty - a draft Sales Return tagged
//            with the salesman, posted by the office
//   Order    item search with stock, customer's rate tier, qty steppers;
//            rate / discount editable only when allowed; total with VAT
//   Parties  every customer on the salesman's routes: balance, open bills,
//            recent orders / bills
//   Stock    closing stock, pending orders, available
//   Entries  the salesman's own orders, receipts and returns of the last days
// Office users (not linked to a salesman) pick the salesman and date.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const drcr = n => (Math.abs(n) < 0.005 ? '0.00' : `${fmt(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`);
const REASONS = ['Stock available', 'Owner not present', 'Shop closed', 'Payment issue', 'Rate issue', 'Will order later', 'Other'];
const TABS = [['today', '📍', 'Today'], ['order', '🛒', 'Order'], ['return', '↩', 'Return'], ['parties', '👥', 'Parties'], ['stock', '📦', 'Stock'], ['orders', '🧾', 'Entries']];
const RETURN_REASONS = [['damaged', 'Damaged'], ['expired', 'Expired'], ['wrong_item', 'Wrong item'], ['quality_issue', 'Quality'], ['excess_supply', 'Excess supply'], ['other', 'Other']];

export default function MobileApp() {
    const { authFetch, logout, tenant } = useAuth();
    const navigate = useNavigate();
    const [me, setMe] = useState(null);
    const [agentId, setAgentId] = useState('');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [tab, setTab] = useState('today');
    const [day, setDay] = useState(null);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [busy, setBusy] = useState(false);
    // order
    const [customer, setCustomer] = useState(null);
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [cart, setCart] = useState({});
    const [remarks, setRemarks] = useState('');
    // other tabs
    const [parties, setParties] = useState([]);
    const [partySearch, setPartySearch] = useState('');
    const [party, setParty] = useState(null);
    const [stock, setStock] = useState([]);
    const [stockSearch, setStockSearch] = useState('');
    const [orders, setOrders] = useState([]);
    const [orderView, setOrderView] = useState(null);
    const [noOrder, setNoOrder] = useState(null);
    // today: route first, then its customers
    const [route, setRoute] = useState(null);
    const [custSearch, setCustSearch] = useState('');
    const [receipt, setReceipt] = useState(null);
    // return (customer of any area / route)
    const [ar, setAr] = useState(null);
    const [ret, setRet] = useState({ area_id: '', route_id: '', search: '', customer: null, reason: 'damaged', remarks: '' });
    const [retCustomers, setRetCustomers] = useState([]);
    const [retProducts, setRetProducts] = useState([]);
    const [retSearch, setRetSearch] = useState('');
    const [retCart, setRetCart] = useState({});
    const [entryView, setEntryView] = useState('orders');
    const [entries, setEntries] = useState([]);

    const q = useCallback((extra = {}) => {
        const p = new URLSearchParams(extra);
        if (me && !me.is_salesman && agentId) p.set('agent_id', agentId);
        return p.toString();
    }, [me, agentId]);
    const flash = m => { setToast(m); setTimeout(() => setToast(''), 3500); };

    useEffect(() => {
        authFetch('/api/mobile/me').then(r => { setMe(r.data); if (r.data.agent) setAgentId(r.data.agent.id); }).catch(e => setError(e.message));
    }, [authFetch]);
    const ready = me && (me.is_salesman || agentId);

    const loadDay = useCallback(async () => {
        if (!ready) return;
        setBusy(true); setError('');
        try { setDay((await authFetch(`/api/mobile/day?${q({ date })}`)).data); } catch (e) { setError(e.message); setDay(null); }
        setBusy(false);
    }, [authFetch, q, date, ready]);
    useEffect(() => { loadDay(); }, [loadDay]);

    const loadProducts = useCallback(async (cust) => {
        try { setProducts((await authFetch(`/api/mobile/products?${q({ customer_id: cust?.id || '', search })}`)).data || []); } catch (e) { setError(e.message); }
    }, [authFetch, q, search]);
    useEffect(() => { if (tab === 'order' && ready) { const t = setTimeout(() => loadProducts(customer), 300); return () => clearTimeout(t); } return undefined; }, [tab, customer, loadProducts, ready]);
    useEffect(() => {
        if (!ready) return undefined;
        if (tab === 'parties') { const t = setTimeout(() => authFetch(`/api/mobile/parties?${q({ search: partySearch, date })}`).then(r => setParties(r.data || [])).catch(e => setError(e.message)), 300); return () => clearTimeout(t); }
        if (tab === 'stock') { const t = setTimeout(() => authFetch(`/api/mobile/stock?${q({ search: stockSearch })}`).then(r => setStock(r.data || [])).catch(e => setError(e.message)), 300); return () => clearTimeout(t); }
        if (tab === 'orders' && entryView === 'orders') authFetch(`/api/mobile/orders?${q()}`).then(r => setOrders(r.data.rows || [])).catch(e => setError(e.message));
        if (tab === 'orders' && entryView === 'entries') authFetch(`/api/mobile/entries?${q()}`).then(r => setEntries(r.data.rows || [])).catch(e => setError(e.message));
        return undefined;
    }, [tab, partySearch, stockSearch, authFetch, q, ready, date, entryView]);
    useEffect(() => { setRoute(null); setCustSearch(''); }, [date, agentId]);
    // return: areas / routes once, customers of the chosen route (or area), products for the customer
    useEffect(() => {
        if (tab === 'return' && ready && !ar) authFetch(`/api/mobile/areas-routes?${q()}`).then(r => setAr(r.data)).catch(e => setError(e.message));
    }, [tab, ready, ar, authFetch, q]);
    useEffect(() => {
        if (tab !== 'return' || !ready || (!ret.route_id && !ret.area_id)) { setRetCustomers([]); return undefined; }
        const t = setTimeout(() => authFetch(`/api/mobile/route-customers?${q({ route_id: ret.route_id, area_id: ret.area_id, search: ret.search })}`).then(r => setRetCustomers(r.data || [])).catch(e => setError(e.message)), 300);
        return () => clearTimeout(t);
    }, [tab, ready, ret.route_id, ret.area_id, ret.search, authFetch, q]);
    useEffect(() => {
        if (tab !== 'return' || !ret.customer) return undefined;
        const t = setTimeout(() => authFetch(`/api/mobile/products?${q({ customer_id: ret.customer.id, search: retSearch })}`).then(r => setRetProducts(r.data || [])).catch(e => setError(e.message)), 300);
        return () => clearTimeout(t);
    }, [tab, ret.customer, retSearch, authFetch, q]);
    const retLines = Object.values(retCart).filter(l => Number(l.qty) > 0);
    const retTotal = retLines.reduce((s2, l) => s2 + Number(l.qty) * Number(l.p.rate) * (1 + (l.p.tax_percent || 0) / 100), 0);
    const saveReturn = async () => {
        if (!ret.customer) return setError('Choose the customer');
        if (!retLines.length) return setError('Add at least one item');
        setBusy(true); setError('');
        try {
            const r = await authFetch(`/api/mobile/returns?${q()}`, { method: 'POST', body: JSON.stringify({ customer_ledger_id: ret.customer.id, route_id: ret.customer.route_id || ret.route_id || undefined, doc_date: date,
                details: retLines.map(l => ({ product_id: l.p.id, qty: Number(l.qty) })), return_reason: ret.reason, remarks: ret.remarks, agent_id: me.is_salesman ? undefined : agentId }) });
            flash(`✅ Return ${r.data.doc_no} saved - the office will post it`);
            setRetCart({}); setRet(x => ({ ...x, customer: null, remarks: '' }));
        } catch (e) { setError(e.message); }
        setBusy(false);
    };
    const saveReceipt = async () => {
        if (!(Number(receipt?.amount) > 0)) return setError('Enter the amount received');
        setBusy(true); setError('');
        try {
            const r = await authFetch(`/api/mobile/receipts?${q()}`, { method: 'POST', body: JSON.stringify({ customer_ledger_id: receipt.c.id, amount: Number(receipt.amount), payment_mode: receipt.mode || 'cash', ref_no: receipt.ref_no, remarks: receipt.remarks, doc_date: date, agent_id: me.is_salesman ? undefined : agentId }) });
            flash(`✅ Receipt ${r.data.doc_no} saved - the office will post it`); setReceipt(null);
        } catch (e) { setError(e.message); }
        setBusy(false);
    };

    const startOrder = c => { setCustomer(c); setCart({}); setRemarks(''); setTab('order'); window.scrollTo(0, 0); };
    const line = p => cart[p.id] || { qty: 0, rate: p.rate, discount_percent: p.discount_percent };
    const setLine = (p, patch) => setCart(c => ({ ...c, [p.id]: { ...(c[p.id] || { qty: 0, rate: p.rate, discount_percent: p.discount_percent }), ...patch, p } }));
    const cartLines = useMemo(() => Object.values(cart).filter(l => Number(l.qty) > 0), [cart]);
    const allCartIds = Object.keys(cart).filter(id => Number(cart[id].qty) > 0);
    const totals = useMemo(() => {
        let net = 0, vat = 0;
        cartLines.forEach(({ p, qty, rate, discount_percent }) => {
            const g = Number(qty) * Number(rate); const n = g - g * (Number(discount_percent) || 0) / 100;
            net += n; vat += n * (p.tax_percent || 0) / 100;
        });
        return { net, vat, total: net + vat };
    }, [cartLines]);

    // GPS is optional: never let an unanswered permission prompt hold the order up
    const position = () => new Promise(resolve => {
        if (!navigator.geolocation) return resolve({});
        const stop = setTimeout(() => resolve({}), 5000);
        navigator.geolocation.getCurrentPosition(p => { clearTimeout(stop); resolve({ latitude: Number(p.coords.latitude.toFixed(7)), longitude: Number(p.coords.longitude.toFixed(7)) }); }, () => { clearTimeout(stop); resolve({}); }, { timeout: 4000, maximumAge: 60000 });
    });
    const submitOrder = async () => {
        if (!customer) return setError('Choose a customer from Today or Parties');
        if (!allCartIds.length) return setError('Add at least one item');
        setBusy(true); setError('');
        try {
            const geo = await position();
            const details = allCartIds.map(id => ({ product_id: id, qty: Number(cart[id].qty), rate: cart[id].rate, discount_percent: cart[id].discount_percent }));
            const r = await authFetch(`/api/mobile/orders?${q()}`, { method: 'POST', body: JSON.stringify({ customer_ledger_id: customer.id, doc_date: date, details, remarks, ...geo, agent_id: me.is_salesman ? undefined : agentId }) });
            flash(`✅ Order ${r.data.doc_no} saved${r.warning ? ` - ${r.warning}` : ''}`);
            setCart({}); setRemarks(''); setCustomer(null); setTab('today'); loadDay();
        } catch (e) { setError(e.message); }
        setBusy(false);
    };
    const saveNoOrder = async () => {
        if (!noOrder?.reason) return setError('Choose a reason');
        try {
            const geo = await position();
            await authFetch(`/api/mobile/visits?${q()}`, { method: 'POST', body: JSON.stringify({ ledger_account_id: noOrder.c.id, route_id: noOrder.c.route_id, visit_date: date, outcome: noOrder.reason === 'Shop closed' ? 'closed' : 'no_order', no_order_reason: noOrder.reason, remarks: noOrder.remarks || null, ...geo, agent_id: me.is_salesman ? undefined : agentId }) });
            setNoOrder(null); flash('Visit recorded'); loadDay();
        } catch (e) { setError(e.message); }
    };
    const openParty = async id => { try { setParty((await authFetch(`/api/mobile/parties/${id}?${q()}`)).data); } catch (e) { setError(e.message); } };
    const openOrder = async id => { try { setOrderView((await authFetch(`/api/mobile/orders/${id}?${q()}`)).data); } catch (e) { setError(e.message); } };

    const badge = c => c.orders.length ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ordered {fmt(c.order_value)}</span>
        : c.visit ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{c.visit === 'closed' ? 'Closed' : 'No order'}{c.no_order_reason ? ` · ${c.no_order_reason}` : ''}</span>
            : <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Pending</span>;

    return (
        <div className="min-h-screen bg-slate-100 pb-20" style={{ maxWidth: 640, margin: '0 auto' }}>
            <header className="sticky top-0 z-20 bg-blue-700 text-white px-4 py-3 shadow">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="font-bold truncate">{me?.agent?.agent_name || 'Salesman'} </p>
                        <p className="text-xs opacity-80 truncate">{tenant?.company_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {me && !me.is_salesman && <button className="text-xs bg-white/20 rounded px-2 py-1" onClick={() => navigate('/dashboard')}>Desk</button>}
                        <button className="text-xs bg-white/20 rounded px-2 py-1" onClick={async () => { await logout(); navigate('/login'); }}>Logout</button>
                    </div>
                </div>
                {me && !me.is_salesman && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                        <select className="text-black rounded px-2 py-1 text-sm" value={agentId} onChange={e => setAgentId(e.target.value)}>
                            <option value="">Choose salesman…</option>{me.agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
                        </select>
                        <input type="date" className="text-black rounded px-2 py-1 text-sm" value={date} onChange={e => setDate(e.target.value)} />
                    </div>
                )}
            </header>

            {error && <div className="mx-3 mt-3 p-3 rounded bg-red-50 text-red-700 text-sm" onClick={() => setError('')}>{error}</div>}
            {toast && <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 bg-green-600 text-white text-sm px-4 py-2 rounded-full shadow">{toast}</div>}
            {me && !ready && <p className="p-6 text-center text-gray-500">Choose a salesman to continue.</p>}

            {ready && tab === 'today' && (
                <div className="p-3 space-y-3">
                    {day && (
                        <>
                            <div className="grid grid-cols-4 gap-2 text-center">
                                {[['Planned', day.summary.planned], ['Visited', day.summary.visited], ['Orders', day.summary.productive], ['Value', fmt(day.summary.order_value)]].map(([k, v]) => (
                                    <div key={k} className="bg-white rounded-lg p-2 shadow-sm"><p className="text-[11px] text-gray-500">{k}</p><p className="font-bold text-sm">{v}</p></div>
                                ))}
                            </div>
                            {!route && (
                                <>
                                    <p className="text-sm font-semibold text-gray-600">{day.routes.length ? `Routes for ${day.date}` : 'No route planned for this date'}</p>
                                    {day.routes.map(r => {
                                        const cs = day.customers.filter(x => x.route_id === r.id);
                                        return (
                                            <button key={r.id} className="w-full bg-white rounded-lg p-4 shadow-sm flex items-center justify-between text-left" onClick={() => { setRoute(r.id); setCustSearch(''); }}>
                                                <div><p className="font-bold">🛣 {r.route_name}</p><p className="text-xs text-gray-500">{cs.length} customers · {cs.filter(x => x.visit || x.orders.length).length} visited · {cs.filter(x => x.orders.length).length} orders</p></div>
                                                <span className="text-2xl text-blue-600">›</span>
                                            </button>
                                        );
                                    })}
                                </>
                            )}
                            {route && (() => {
                                const r = day.routes.find(x => x.id === route);
                                const s2 = custSearch.trim().toLowerCase();
                                const list = day.customers.filter(x => x.route_id === route)
                                    .filter(x => !s2 || [x.account_name, x.account_code, x.address, x.phone, x.mobile].some(v => String(v || '').toLowerCase().includes(s2)));
                                return (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <button className="bg-white rounded px-3 py-2 shadow-sm text-sm" onClick={() => setRoute(null)}>◀ Routes</button>
                                            <p className="font-bold truncate">🛣 {r?.route_name}</p>
                                        </div>
                                        <input className="w-full rounded-lg border px-3 py-2" placeholder="🔍 Search customer / phone" value={custSearch} onChange={e => setCustSearch(e.target.value)} />
                                        {list.map(c => (
                                            <div key={c.id} className="bg-white rounded-lg p-3 shadow-sm">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <p className="font-semibold truncate"><span className="text-gray-400">{c.sequence_order ?? ''}.</span> {c.account_name}</p>
                                                        <p className="text-xs text-gray-500 truncate">{c.address || '—'}{c.phone || c.mobile ? ` · ${c.mobile || c.phone}` : ''}</p>
                                                        <p className="text-xs mt-1">Balance <b className={c.balance > 0 ? 'text-red-600' : 'text-green-700'}>{drcr(c.balance)}</b>{c.credit_limit > 0 ? <span className="text-gray-400"> / limit {fmt(c.credit_limit)}</span> : ''}</p>
                                                    </div>
                                                    {badge(c)}
                                                </div>
                                                <div className="grid grid-cols-4 gap-2 mt-2">
                                                    <button className="bg-blue-600 text-white rounded py-2 text-sm" onClick={() => startOrder(c)}>🛒 Order</button>
                                                    <button className="bg-green-100 text-green-800 rounded py-2 text-sm disabled:opacity-40" disabled={me?.agent && me.agent.allow_receipt === false} onClick={() => setReceipt({ c, amount: '', mode: 'cash' })}>💵 Receipt</button>
                                                    <button className="bg-amber-100 text-amber-800 rounded py-2 text-sm" onClick={() => setNoOrder({ c, reason: '' })}>✋ No order</button>
                                                    <button className="bg-slate-100 rounded py-2 text-sm" onClick={() => openParty(c.id)}>ℹ Details</button>
                                                </div>
                                            </div>
                                        ))}
                                        {list.length === 0 && <p className="text-center text-gray-400 py-8">No customers{custSearch ? ' match' : ' on this route'}.</p>}
                                    </>
                                );
                            })()}
                        </>
                    )}
                    {busy && !day && <p className="text-center text-gray-400 py-8">Loading…</p>}
                </div>
            )}

            {ready && tab === 'order' && (
                <div className="p-3 space-y-3">
                    <div className="bg-white rounded-lg p-3 shadow-sm">
                        {customer ? (
                            <div className="flex items-center justify-between"><div><p className="text-xs text-gray-500">Customer</p><p className="font-semibold">{customer.account_name}</p><p className="text-xs">Balance {drcr(customer.balance || 0)}</p></div>
                                <button className="text-xs text-blue-600" onClick={() => setTab('today')}>Change</button></div>
                        ) : <p className="text-sm text-gray-500">Choose a customer from <button className="text-blue-600 underline" onClick={() => setTab('today')}>Today</button> first.</p>}
                    </div>
                    <input className="w-full rounded-lg border px-3 py-2" placeholder="🔍 Search item / code" value={search} onChange={e => setSearch(e.target.value)} />
                    {products.map(p => {
                        const l = line(p);
                        return (
                            <div key={p.id} className={`bg-white rounded-lg p-3 shadow-sm ${Number(l.qty) > 0 ? 'ring-2 ring-blue-400' : ''}`}>
                                <div className="flex justify-between gap-2">
                                    <div className="min-w-0"><p className="font-medium text-sm truncate">{p.product_name}</p>
                                        <p className="text-[11px] text-gray-500">{p.product_code} · Stock <b className={p.stock <= 0 ? 'text-red-600' : ''}>{qtyFmt(p.stock)}</b> {p.unit_name}{p.discount_percent ? ` · Disc ${p.discount_percent}%` : ''}</p></div>
                                    <p className="text-sm font-semibold whitespace-nowrap">Rs {fmt(l.rate)}</p>
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <button className="w-9 h-9 rounded bg-slate-200 text-lg" onClick={() => setLine(p, { qty: Math.max(0, Number(l.qty || 0) - 1) })}>−</button>
                                    <input type="number" inputMode="decimal" className="w-20 text-center border rounded h-9" value={l.qty || ''} placeholder="0" onChange={e => setLine(p, { qty: e.target.value })} />
                                    <button className="w-9 h-9 rounded bg-blue-600 text-white text-lg" onClick={() => setLine(p, { qty: Number(l.qty || 0) + 1 })}>+</button>
                                    {p.rate_editable && <>
                                        <input type="number" inputMode="decimal" className="w-24 border rounded h-9 px-1 text-sm" value={l.rate} title="Rate" onChange={e => setLine(p, { rate: e.target.value })} />
                                        <input type="number" inputMode="decimal" className="w-14 border rounded h-9 px-1 text-sm" value={l.discount_percent} title="Discount %" onChange={e => setLine(p, { discount_percent: e.target.value })} />
                                    </>}
                                </div>
                            </div>
                        );
                    })}
                    {products.length === 0 && <p className="text-center text-gray-400 py-6">No items.</p>}
                    <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} placeholder="Remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                    <div className="sticky bottom-16 bg-white rounded-lg p-3 shadow-lg border">
                        <div className="flex justify-between text-sm"><span>{allCartIds.length} item(s)</span><span>Net {fmt(totals.net)} + VAT {fmt(totals.vat)}</span></div>
                        <div className="flex items-center justify-between mt-2">
                            <p className="font-bold">Rs {fmt(totals.total)}</p>
                            <button className="bg-green-600 text-white rounded-lg px-5 py-2 font-semibold disabled:opacity-50" disabled={busy || !customer || !allCartIds.length} onClick={submitOrder}>{busy ? 'Saving…' : '✔ Save Order'}</button>
                        </div>
                    </div>
                </div>
            )}

            {ready && tab === 'return' && (
                <div className="p-3 space-y-3">
                    {me?.agent && me.agent.allow_return === false && <p className="p-3 bg-amber-50 text-amber-800 rounded text-sm">Returns on the phone are not allowed for this salesman.</p>}
                    {!ret.customer ? (
                        <>
                            <p className="text-sm text-gray-600">Return from a customer of any area / route.</p>
                            <div className="grid grid-cols-2 gap-2">
                                <select className="rounded-lg border px-2 py-2 bg-white" value={ret.area_id} onChange={e => setRet(x => ({ ...x, area_id: e.target.value, route_id: '' }))}>
                                    <option value="">Area…</option>{(ar?.areas || []).map(a => <option key={a.id} value={a.id}>{a.area_name}</option>)}
                                </select>
                                <select className="rounded-lg border px-2 py-2 bg-white" value={ret.route_id} onChange={e => setRet(x => ({ ...x, route_id: e.target.value }))}>
                                    <option value="">Route…</option>{(ar?.routes || []).filter(r => !ret.area_id || r.area_id === ret.area_id).map(r => <option key={r.id} value={r.id}>{r.route_name}</option>)}
                                </select>
                            </div>
                            <input className="w-full rounded-lg border px-3 py-2" placeholder="🔍 Search customer" value={ret.search} onChange={e => setRet(x => ({ ...x, search: e.target.value }))} disabled={!ret.area_id && !ret.route_id} />
                            {retCustomers.map(c => (
                                <button key={c.id} className="w-full bg-white rounded-lg p-3 shadow-sm text-left" onClick={() => { setRet(x => ({ ...x, customer: c })); setRetCart({}); setRetSearch(''); }}>
                                    <p className="font-medium">{c.account_name}</p><p className="text-[11px] text-gray-500">{c.address || '—'}{c.mobile || c.phone ? ` · ${c.mobile || c.phone}` : ''}</p>
                                </button>
                            ))}
                            {(ret.area_id || ret.route_id) && retCustomers.length === 0 && <p className="text-center text-gray-400 py-6">No customers.</p>}
                        </>
                    ) : (
                        <>
                            <div className="bg-white rounded-lg p-3 shadow-sm flex items-center justify-between">
                                <div><p className="text-xs text-gray-500">Return from</p><p className="font-semibold">{ret.customer.account_name}</p></div>
                                <button className="text-xs text-blue-600" onClick={() => setRet(x => ({ ...x, customer: null }))}>Change</button>
                            </div>
                            <input className="w-full rounded-lg border px-3 py-2" placeholder="🔍 Search item / code" value={retSearch} onChange={e => setRetSearch(e.target.value)} />
                            {retProducts.map(p => {
                                const l = retCart[p.id] || { qty: 0 };
                                const setQ = v => setRetCart(c => ({ ...c, [p.id]: { qty: v, p } }));
                                return (
                                    <div key={p.id} className={`bg-white rounded-lg p-3 shadow-sm ${Number(l.qty) > 0 ? 'ring-2 ring-red-300' : ''}`}>
                                        <div className="flex justify-between gap-2"><p className="font-medium text-sm truncate">{p.product_name}</p><p className="text-sm whitespace-nowrap">Rs {fmt(p.rate)} / {p.unit_name}</p></div>
                                        <div className="flex items-center gap-2 mt-2">
                                            <button className="w-9 h-9 rounded bg-slate-200 text-lg" onClick={() => setQ(Math.max(0, Number(l.qty || 0) - 1))}>−</button>
                                            <input type="number" inputMode="decimal" className="w-20 text-center border rounded h-9" value={l.qty || ''} placeholder="0" onChange={e => setQ(e.target.value)} />
                                            <button className="w-9 h-9 rounded bg-red-500 text-white text-lg" onClick={() => setQ(Number(l.qty || 0) + 1)}>+</button>
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="grid grid-cols-3 gap-2">{RETURN_REASONS.map(([k, l]) => <button key={k} className={`rounded py-2 text-xs border ${ret.reason === k ? 'bg-red-500 text-white' : 'bg-white'}`} onClick={() => setRet(x => ({ ...x, reason: k }))}>{l}</button>)}</div>
                            <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} placeholder="Remarks" value={ret.remarks} onChange={e => setRet(x => ({ ...x, remarks: e.target.value }))} />
                            <div className="sticky bottom-16 bg-white rounded-lg p-3 shadow-lg border flex items-center justify-between">
                                <div><p className="text-sm">{retLines.length} item(s)</p><p className="font-bold">Rs {fmt(retTotal)}</p></div>
                                <button className="bg-red-600 text-white rounded-lg px-5 py-2 font-semibold disabled:opacity-50" disabled={busy || !retLines.length} onClick={saveReturn}>{busy ? 'Saving…' : '↩ Save Return'}</button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {ready && tab === 'parties' && (
                <div className="p-3 space-y-2">
                    <input className="w-full rounded-lg border px-3 py-2" placeholder="🔍 Search party / phone / PAN" value={partySearch} onChange={e => setPartySearch(e.target.value)} />
                    {parties.map(p => (
                        <div key={p.id} className="bg-white rounded-lg p-3 shadow-sm flex items-center justify-between gap-2" onClick={() => openParty(p.id)}>
                            <div className="min-w-0"><p className="font-medium truncate">{p.account_name}</p><p className="text-[11px] text-gray-500 truncate">{p.route_name || '—'} · {p.mobile || p.phone || ''}</p></div>
                            <div className="text-right"><p className={`text-sm font-semibold ${p.balance > 0 ? 'text-red-600' : 'text-green-700'}`}>{drcr(p.balance)}</p>
                                <button className="text-xs text-blue-600" onClick={e => { e.stopPropagation(); startOrder(p); }}>Order</button></div>
                        </div>
                    ))}
                    {parties.length === 0 && <p className="text-center text-gray-400 py-6">No parties.</p>}
                </div>
            )}

            {ready && tab === 'stock' && (
                <div className="p-3 space-y-2">
                    <input className="w-full rounded-lg border px-3 py-2" placeholder="🔍 Search item" value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
                    {stock.map(s => (
                        <div key={`${s.product_id}${s.warehouse_name || ''}`} className="bg-white rounded-lg p-3 shadow-sm">
                            <p className="font-medium text-sm">{s.product_name}</p>
                            <div className="grid grid-cols-3 text-center text-xs mt-1">
                                <div><p className="text-gray-500">Stock</p><p className="font-semibold">{qtyFmt(s.stock)} {s.unit_name}</p></div>
                                <div><p className="text-gray-500">On order</p><p className="font-semibold">{qtyFmt(s.pending_orders)}</p></div>
                                <div><p className="text-gray-500">Available</p><p className={`font-semibold ${s.available <= 0 ? 'text-red-600' : 'text-green-700'}`}>{qtyFmt(s.available)}</p></div>
                            </div>
                        </div>
                    ))}
                    {stock.length === 0 && <p className="text-center text-gray-400 py-6">No stock rows.</p>}
                </div>
            )}

            {ready && tab === 'orders' && (
                <div className="p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-1 bg-white rounded-lg p-1 shadow-sm">
                        {[['orders', 'Orders'], ['entries', 'Receipts & Returns']].map(([k, l]) => <button key={k} className={`rounded py-2 text-sm ${entryView === k ? 'bg-blue-600 text-white' : ''}`} onClick={() => setEntryView(k)}>{l}</button>)}
                    </div>
                    {entryView === 'entries' && entries.map(x => (
                        <div key={x.type + x.id} className="bg-white rounded-lg p-3 shadow-sm flex justify-between">
                            <div><p className="font-medium text-sm">{x.type === 'receipt' ? '💵' : '↩'} {x.doc_no} · {x.party}</p><p className="text-[11px] text-gray-500">{x.doc_date} · {x.type === 'receipt' ? 'Receipt' : 'Return'}</p></div>
                            <div className="text-right"><p className="font-semibold text-sm">{fmt(x.amount)}</p><p className={`text-[11px] ${x.status === 'draft' ? 'text-amber-600' : 'text-green-700'}`}>{x.status === 'draft' ? 'Pending approval' : x.status}</p></div>
                        </div>
                    ))}
                    {entryView === 'entries' && entries.length === 0 && <p className="text-center text-gray-400 py-6">No receipts or returns in the last 7 days.</p>}
                    {entryView === 'orders' && orders.map(o => (
                        <div key={o.id} className="bg-white rounded-lg p-3 shadow-sm flex justify-between" onClick={() => openOrder(o.id)}>
                            <div><p className="font-medium text-sm">{o.doc_no} · {o.customer_name_snapshot}</p><p className="text-[11px] text-gray-500">{String(o.doc_date).slice(0, 10)} · {o.route_name_snapshot || ''}</p></div>
                            <div className="text-right"><p className="font-semibold text-sm">{fmt(o.total_amount)}</p><p className="text-[11px] capitalize text-gray-500">{String(o.status).replace('_', ' ')}</p></div>
                        </div>
                    ))}
                    {entryView === 'orders' && orders.length === 0 && <p className="text-center text-gray-400 py-6">No orders in the last 7 days.</p>}
                </div>
            )}

            {(party || orderView || noOrder || receipt) && (
                <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => { setParty(null); setOrderView(null); setNoOrder(null); setReceipt(null); }}>
                    <div className="bg-white w-full rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto" style={{ maxWidth: 640, margin: '0 auto' }} onClick={e => e.stopPropagation()}>
                        {party && (<>
                            <p className="font-bold text-lg">{party.account_name}</p>
                            <p className="text-xs text-gray-500">{party.address} {party.pan_number ? `· PAN ${party.pan_number}` : ''}</p>
                            <p className="mt-2">Balance <b>{drcr(party.balance)}</b>{party.credit_limit > 0 ? ` · Limit ${fmt(party.credit_limit)}` : ''}</p>
                            {(party.mobile || party.phone) && <a className="inline-block mt-2 text-blue-600" href={`tel:${party.mobile || party.phone}`}>📞 {party.mobile || party.phone}</a>}
                            <p className="font-semibold mt-3 text-sm">Open bills</p>
                            {party.open_bills.map((b, i) => <div key={i} className="flex justify-between text-sm border-b py-1"><span>{b.doc_no} · {String(b.doc_date).slice(0, 10)}{b.overdue_days ? <span className="text-red-600"> · {b.overdue_days}d overdue</span> : ''}</span><span>{fmt(b.remaining_amount)}</span></div>)}
                            {party.open_bills.length === 0 && <p className="text-xs text-gray-400">None</p>}
                            <p className="font-semibold mt-3 text-sm">Recent orders</p>
                            {party.recent_orders.map(o => <div key={o.id} className="flex justify-between text-sm border-b py-1"><span>{o.doc_no} · {String(o.doc_date).slice(0, 10)}</span><span>{fmt(o.total_amount)} · {o.status}</span></div>)}
                            <p className="font-semibold mt-3 text-sm">Recent bills</p>
                            {party.recent_bills.map(o => <div key={o.id} className="flex justify-between text-sm border-b py-1"><span>{o.doc_no} · {String(o.doc_date).slice(0, 10)}</span><span>{fmt(o.total_amount)}</span></div>)}
                        </>)}
                        {orderView && (<>
                            <p className="font-bold text-lg">{orderView.doc_no}</p>
                            <p className="text-xs text-gray-500">{orderView.customer_name_snapshot} · {String(orderView.doc_date).slice(0, 10)} · {orderView.status}</p>
                            {orderView.details.map(d => <div key={d.id} className="flex justify-between text-sm border-b py-1"><span>{d.product_name_snapshot} × {qtyFmt(d.qty)}</span><span>{fmt(d.amount)}</span></div>)}
                            <p className="text-right font-bold mt-2">Total {fmt(orderView.total_amount)}</p>
                        </>)}
                        {noOrder && (<>
                            <p className="font-bold">No order - {noOrder.c.account_name}</p>
                            <div className="grid grid-cols-2 gap-2 mt-3">
                                {REASONS.map(r => <button key={r} className={`rounded py-2 text-sm border ${noOrder.reason === r ? 'bg-amber-500 text-white' : 'bg-white'}`} onClick={() => setNoOrder({ ...noOrder, reason: r })}>{r}</button>)}
                            </div>
                            <textarea className="w-full border rounded mt-3 px-2 py-1 text-sm" rows={2} placeholder="Remarks" value={noOrder.remarks || ''} onChange={e => setNoOrder({ ...noOrder, remarks: e.target.value })} />
                            <button className="w-full bg-amber-600 text-white rounded-lg py-2 mt-3 font-semibold" onClick={saveNoOrder}>Save visit</button>
                        </>)}
                        {receipt && (<>
                            <p className="font-bold">💵 Receipt - {receipt.c.account_name}</p>
                            <p className="text-xs text-gray-500">Balance {drcr(receipt.c.balance || 0)}</p>
                            <input type="number" inputMode="decimal" className="w-full border rounded-lg mt-3 px-3 py-3 text-lg" placeholder="Amount received" value={receipt.amount} onChange={e => setReceipt({ ...receipt, amount: e.target.value })} autoFocus />
                            <div className="grid grid-cols-3 gap-2 mt-2">{[['cash', 'Cash'], ['cheque', 'Cheque'], ['online', 'Online']].map(([k, l]) => <button key={k} className={`rounded py-2 text-sm border ${receipt.mode === k ? 'bg-green-600 text-white' : 'bg-white'}`} onClick={() => setReceipt({ ...receipt, mode: k })}>{l}</button>)}</div>
                            {receipt.mode !== 'cash' && <input className="w-full border rounded mt-2 px-2 py-2 text-sm" placeholder={receipt.mode === 'cheque' ? 'Cheque no' : 'Reference'} value={receipt.ref_no || ''} onChange={e => setReceipt({ ...receipt, ref_no: e.target.value })} />}
                            <textarea className="w-full border rounded mt-2 px-2 py-1 text-sm" rows={2} placeholder="Remarks" value={receipt.remarks || ''} onChange={e => setReceipt({ ...receipt, remarks: e.target.value })} />
                            <button className="w-full bg-green-600 text-white rounded-lg py-3 mt-3 font-semibold disabled:opacity-50" disabled={busy} onClick={saveReceipt}>{busy ? 'Saving…' : 'Save receipt'}</button>
                            <p className="text-[11px] text-gray-500 mt-1">Saved as pending; the office posts it (Mobile Approvals).</p>
                        </>)}
                        <button className="w-full mt-4 py-2 rounded-lg bg-slate-100" onClick={() => { setParty(null); setOrderView(null); setNoOrder(null); setReceipt(null); }}>Close</button>
                    </div>
                </div>
            )}

            <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t grid grid-cols-6" style={{ maxWidth: 640, margin: '0 auto' }}>
                {TABS.map(([k, icon, label]) => (
                    <button key={k} className={`py-2 text-center ${tab === k ? 'text-blue-700 font-semibold' : 'text-gray-500'}`} onClick={() => setTab(k)}>
                        <div className="text-lg leading-none">{icon}</div><div className="text-[11px]">{label}{k === 'order' && allCartIds.length ? ` (${allCartIds.length})` : ''}</div>
                    </button>
                ))}
            </nav>
        </div>
    );
}
