// =============================================
// utils/ageing.js
// Ageing - Receivable (customers) / Payable (suppliers), as on a date,
// customer / supplier-wise and bill-wise from one computation.
//
// What is aged (kinds, any mix):
//   bills     - the party's ledger outstanding
//   challans  - Goods Delivery / Goods Receipt not yet billed
//   orders    - Sales / Purchase Orders not yet delivered / received
// With only challans (and orders) this is the Goods Delivery / Goods
// Receipt ageing.
//
// How the ledger outstanding is split into bills (method):
//   auto      - bill-to-bill for a party whose bill-wise tracking is on
//               (ledger setting, else System Control), FIFO otherwise
//   bill_wise - always bill-to-bill (bill_wise_references + settlements)
//   fifo      - always FIFO over the ledger: receipts / payments /
//               returns clear the oldest bills first
// Bill-to-bill is rebuilt as on the date: a settlement counts only when
// both its documents are dated on or before it. What the references do
// not cover (opening balance, entries made without bill-wise) is shown as
// "Unallocated" so the party total always equals its ledger balance.
// An opposite balance (advance, over-payment) is "On Account".
//
// Company-wise (System Control > Product Company compulsory for the side,
// or asked for): each party is aged per Product Company - references and
// GL lines carry the company; the master opening balance has none.
//
// Age from the document date, or the due date (bill due date, else date
// + the party's credit days) with a "Not Due" column.
// =============================================
const fe = require('./financialEngine');
const { pendingDocuments } = require('./pendingDocuments');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const httpError = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const days = (from, to) => Math.floor((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}

// GL / reference document types -> header table (doc no, due date, party bill no).
const DOC_TABLES = {
    sales_bill: ['Sales Bill', 'sales_bills'], sales_return: ['Sales Return', 'sales_returns'], sales_nonsalable_return: ['Sales Non-saleable Return', 'sales_nonsaleable_returns'],
    sales_additional: ['Sales Additional Entry', 'sales_additional_entries'], purchase_bill: ['Purchase Bill', 'purchase_bills'], purchase_return: ['Purchase Return', 'purchase_returns'],
    purchase_nonsalable_return: ['Purchase Non-saleable Return', 'purchase_nonsaleable_returns'], purchase_grn: ['Purchase GRN', 'purchase_grns'],
    purchase_additional_expense: ['Purchase Additional Expense', 'purchase_additional_expenses'], cash_bank_entry: ['Cash / Bank Entry', 'cash_bank_entries'],
    pdc: ['PDC', 'pdc_vouchers'], journal_voucher: ['Journal Voucher', 'journal_vouchers'], credit_note: ['Credit Note', 'credit_notes'], debit_note: ['Debit Note', 'debit_notes']
};
async function docInfo(c, t, keys) {                   // keys: [[type, id]] -> { 'type:id': { doc_no, due_date, party_bill_no } }
    const out = {};
    const byType = {};
    keys.forEach(([type, id]) => { if (DOC_TABLES[type] && id) (byType[type] = byType[type] || new Set()).add(id); });
    for (const [type, ids] of Object.entries(byType)) {
        const rows = await inChunks([...ids], async chunk => {
            const { data } = await c.from(DOC_TABLES[type][1]).select('*').in('id', chunk);
            return data || [];
        });
        rows.forEach(h => { out[`${type}:${h.id}`] = { doc_no: h.doc_no || h.voucher_no || null, due_date: h.due_date ? String(h.due_date).slice(0, 10) : null, party_bill_no: h.party_bill_no || null }; });
    }
    return out;
}

function parseBuckets(s) {
    const cuts = [...new Set(csv(s || '30,60,90,120').map(Number).filter(n => n > 0 && Number.isFinite(n)))].sort((a, b) => a - b).slice(0, 10);
    const list = [];
    let prev = 0;
    cuts.forEach((n, i) => { list.push({ key: `b${i}`, label: `${i === 0 ? 0 : prev + 1}-${n}`, max: n }); prev = n; });
    list.push({ key: `b${cuts.length}`, label: `> ${prev}`, max: Infinity });
    return list;
}

async function ageing(c, t, q) {
    const side = q.side === 'payable' ? 'payable' : 'receivable';
    const asOn = q.as_on || new Date().toISOString().slice(0, 10);
    const method = ['auto', 'bill_wise', 'fifo'].includes(q.method) ? q.method : 'auto';
    const basis = q.age_basis === 'due_date' ? 'due_date' : 'doc_date';
    const kindsAsked = csv(q.kinds).filter(k => ['bills', 'challans', 'orders'].includes(k));
    const kinds = kindsAsked.length ? kindsAsked : ['bills'];
    const buckets = parseBuckets(q.buckets);
    if (basis === 'due_date') buckets.unshift({ key: 'not_due', label: 'Not Due', max: -1 });
    const f = {
        partyIds: csv(q.party_ids), areaIds: csv(q.area_ids), routeIds: csv(q.route_ids), agentIds: csv(q.agent_ids),
        groupIds: csv(q.party_group_ids), companyIds: csv(q.product_company_ids), search: (q.search || '').trim().toLowerCase()
    };
    const normalSign = side === 'receivable' ? 1 : -1;       // outstanding = sign x (Dr - Cr)
    const normalNature = side === 'receivable' ? 'dr' : 'cr';

    const [{ data: sc }, groups, ledgers, areas, routes, agents, companies] = await Promise.all([
        c.from('system_control_settings').select('*').eq('tenant_id', t).maybeSingle(),
        fe.loadGroups(c, t),
        fetchAll(() => c.from('ledger_accounts').select('id, account_code, account_name, account_group_id, area_id, route_id, agent_id, credit_limit, credit_days, opening_balance, opening_balance_type, opening_balance_date, bill_wise_tracking_control, phone_office, contact_person_mobile, billing_address, city')
            .eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('areas').select('id, area_name, parent_area_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('routes').select('id, route_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('salesman_agents').select('id, agent_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_companies').select('id, company_name').eq('tenant_id', t).order('id'))
    ]);
    const settings = sc || {};
    const companyWiseSetting = side === 'receivable' ? !!settings.product_company_compulsory_sales
        : !!settings.product_company_compulsory_purchase || settings.company_wise_entry_purchase === 'compulsory';
    const companyWise = q.company_wise === 'yes' ? true : q.company_wise === 'no' ? false : companyWiseSetting;
    const name = (rows, k) => Object.fromEntries(rows.map(r => [r.id, r[k]]));
    const areaName = name(areas, 'area_name'), routeName = name(routes, 'route_name'), agentName = name(agents, 'agent_name'), companyName = name(companies, 'company_name');

    // Sub-areas / sub-groups count with their parent.
    const withChildren = (ids, rows, parentKey) => {
        if (!ids.length) return null;
        const set = new Set(ids);
        for (let grew = true; grew;) { grew = false; rows.forEach(r => { if (r[parentKey] && set.has(r[parentKey]) && !set.has(r.id)) { set.add(r.id); grew = true; } }); }
        return set;
    };
    const areaSet = withChildren(f.areaIds, areas, 'parent_area_id');
    const groupSet = withChildren(f.groupIds, Object.values(groups), 'parent_group_id');
    const anchor = side === 'receivable' ? 'RECEIVABLES' : 'PAYABLES';
    const masterOk = l => (!f.partyIds.length || f.partyIds.includes(l.id)) && (!areaSet || areaSet.has(l.area_id))
        && (!f.routeIds.length || f.routeIds.includes(l.route_id)) && (!f.agentIds.length || f.agentIds.includes(l.agent_id))
        && (!groupSet || groupSet.has(l.account_group_id))
        && (!f.search || [l.account_name, l.account_code].some(v => v && String(v).toLowerCase().includes(f.search)));
    const byId = Object.fromEntries(ledgers.map(l => [l.id, l]));
    const parties = ledgers.filter(l => masterOk(l) && (groups[l.account_group_id]?.anchor === anchor || f.partyIds.includes(l.id)));
    const partyIds = parties.map(l => l.id);
    const trackingOn = l => {
        const ctl = l.bill_wise_tracking_control || 'system_default';
        return ctl === 'enabled' ? true : ctl === 'disabled' ? false : settings.bill_wise_tracking !== false;
    };
    const methodOf = l => (method === 'fifo' ? 'fifo' : method === 'bill_wise' ? 'bill_wise' : trackingOn(l) ? 'bill_wise' : 'fifo');
    const companyOk = id => !f.companyIds.length || f.companyIds.includes(id);
    const keyOf = (pid, co) => `${pid}|${companyWise ? co || '' : ''}`;

    // Rows keyed by party (+ company).
    const rows = new Map();
    const rowFor = (pid, co, fallbackName) => {
        const k = keyOf(pid, co);
        if (!rows.has(k)) {
            const l = byId[pid] || {};
            rows.set(k, {
                key: k, party_id: pid, party_code: l.account_code || '', party_name: l.account_name || fallbackName || '(unknown)',
                company_id: companyWise ? co || null : null, company_name: companyWise ? companyName[co] || (co ? '' : '(no company)') : null,
                area_name: areaName[l.area_id] || '', route_name: routeName[l.route_id] || '', agent_name: agentName[l.agent_id] || '',
                phone: [l.phone_office, l.contact_person_mobile].filter(Boolean).join(', '), address: l.billing_address || l.city || '',
                credit_limit: Number(l.credit_limit) || 0, credit_days: Number(l.credit_days) || 0, method: byId[pid] ? methodOf(l) : null,
                docs: [], on_account: 0, unallocated: 0, gl_balance: null
            });
        }
        return rows.get(k);
    };
    const warnings = [];

    if (kinds.includes('bills') && partyIds.length) {
        // ---- GL lines up to the date (balance for every party, FIFO entries) ----
        const lines = await inChunks(partyIds, chunk => fetchAll(() => c.from('ledger_transaction_lines')
            .select('ledger_account_id, product_company_id, debit_amount, credit_amount, batch:batch_id!inner(id, batch_date, document_type, document_id)')
            .eq('tenant_id', t).in('ledger_account_id', chunk).lte('batch.batch_date', asOn).order('id')), 100);
        // net per (party, company, batch)
        const entries = new Map();
        lines.forEach(l => {
            const co = l.product_company_id || null;
            if (!companyOk(co) && f.companyIds.length) return;
            const k = `${keyOf(l.ledger_account_id, co)}|${l.batch.id}`;
            if (!entries.has(k)) entries.set(k, { party: l.ledger_account_id, co, date: String(l.batch.batch_date).slice(0, 10), type: l.batch.document_type, id: l.batch.document_id, amt: 0 });
            entries.get(k).amt += normalSign * ((Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0));
        });
        const glBalance = {};
        entries.forEach(e => { const k = keyOf(e.party, e.co); glBalance[k] = (glBalance[k] || 0) + e.amt; });
        parties.forEach(l => {                            // master opening balance (no company)
            const ob = (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0) * normalSign;
            if (!ob || (f.companyIds.length && !f.companyIds.includes(null))) return;
            const k = keyOf(l.id, null);
            glBalance[k] = (glBalance[k] || 0) + ob;
            entries.set(`${k}|opening`, { party: l.id, co: null, date: l.opening_balance_date ? String(l.opening_balance_date).slice(0, 10) : '0000-01-01', type: 'opening', id: null, amt: ob });
        });

        // ---- bill-to-bill parties: references rebuilt as on the date ----
        const bwParties = parties.filter(l => methodOf(l) === 'bill_wise').map(l => l.id);
        const coveredByRefs = new Set();
        if (bwParties.length) {
            const refs = (await inChunks(bwParties, chunk => fetchAll(() => c.from('bill_wise_references')
                .select('id, ledger_id, source_type, source_id, source_doc_no, source_date, nature, total_amount, product_company_id')
                .eq('tenant_id', t).in('ledger_id', chunk).lte('source_date', asOn).order('id')), 100))
                .filter(r => !f.companyIds.length || companyOk(r.product_company_id || null));
            const refById = Object.fromEntries(refs.map(r => [r.id, r]));
            const settlements = await inChunks(refs.map(r => r.id), chunk => fetchAll(() => c.from('bill_wise_settlements')
                .select('new_reference_id, against_reference_id, settled_amount').in('new_reference_id', chunk).order('id')));
            const allocated = {};
            settlements.forEach(s => {
                const a = refById[s.new_reference_id], b = refById[s.against_reference_id];
                if (!a || !b) return;                     // other side is after the date (or filtered out)
                allocated[a.id] = (allocated[a.id] || 0) + Number(s.settled_amount);
                allocated[b.id] = (allocated[b.id] || 0) + Number(s.settled_amount);
            });
            const info = await docInfo(c, t, refs.map(r => [r.source_type, r.source_id]));
            refs.forEach(r => {
                const remaining = round2(Number(r.total_amount) - (allocated[r.id] || 0));
                const co = r.product_company_id || null;
                coveredByRefs.add(keyOf(r.ledger_id, co));
                if (remaining <= 0.005) return;
                const row = rowFor(r.ledger_id, co);
                const di = info[`${r.source_type}:${r.source_id}`] || {};
                const date = String(r.source_date).slice(0, 10);
                if (r.nature === normalNature) {
                    row.docs.push({ kind: 'bill', doc_type: r.source_type, doc_id: r.source_id, doc_label: DOC_TABLES[r.source_type]?.[0] || r.source_type, doc_no: r.source_doc_no, doc_date: date,
                        due_date: di.due_date, party_bill_no: di.party_bill_no, amount: round2(r.total_amount), settled: round2(allocated[r.id] || 0), remaining });
                } else {
                    row.on_account = round2(row.on_account + remaining);
                    row.docs.push({ kind: 'on_account', doc_type: r.source_type, doc_id: r.source_id, doc_label: DOC_TABLES[r.source_type]?.[0] || r.source_type, doc_no: r.source_doc_no, doc_date: date,
                        amount: round2(r.total_amount), settled: round2(allocated[r.id] || 0), remaining: -remaining });
                }
            });
            // What the references do not explain.
            Object.entries(glBalance).forEach(([k, bal]) => {
                const pid = k.split('|')[0];
                if (!bwParties.includes(pid)) return;
                const co = k.split('|')[1] || null;
                const row = rows.get(k);
                const refsNet = row ? row.docs.reduce((s, d) => s + d.remaining, 0) : 0;
                const diff = round2(bal - refsNet);
                if (Math.abs(diff) > 0.005) rowFor(pid, co).unallocated = diff;
                if (rows.has(k)) rows.get(k).gl_balance = round2(bal);
            });
        }

        // ---- FIFO parties: payments / returns clear the oldest first ----
        const fifoKeys = new Map();
        entries.forEach(e => {
            if (methodOf(byId[e.party] || {}) !== 'fifo') return;
            const k = keyOf(e.party, e.co);
            if (!fifoKeys.has(k)) fifoKeys.set(k, []);
            fifoKeys.get(k).push(e);
        });
        const info = await docInfo(c, t, [...fifoKeys.values()].flat().filter(e => e.amt > 0).map(e => [e.type, e.id]));
        fifoKeys.forEach((list, k) => {
            const [pid, coKey] = k.split('|');
            const co = coKey || null;
            const bills = list.filter(e => e.amt > 0.005).sort((a, b) => a.date.localeCompare(b.date));
            let credit = list.filter(e => e.amt < -0.005).reduce((s, e) => s - e.amt, 0);
            const row = rowFor(pid, co);
            row.gl_balance = round2(list.reduce((s, e) => s + e.amt, 0));
            bills.forEach(e => {
                const take = Math.min(credit, e.amt);
                credit -= take;
                const remaining = round2(e.amt - take);
                if (remaining <= 0.005) return;
                const di = info[`${e.type}:${e.id}`] || {};
                row.docs.push({ kind: e.type === 'opening' ? 'opening' : 'bill', doc_type: e.type, doc_id: e.id, doc_label: e.type === 'opening' ? 'Opening Balance' : DOC_TABLES[e.type]?.[0] || e.type,
                    doc_no: e.type === 'opening' ? 'Opening' : di.doc_no || '', doc_date: e.date === '0000-01-01' ? null : e.date, due_date: di.due_date || null, party_bill_no: di.party_bill_no || null,
                    amount: round2(e.amt), settled: round2(take), remaining });
            });
            if (credit > 0.005) row.on_account = round2(row.on_account + credit);
        });
    }

    // ---- challans / orders ----
    const pendingStages = [...(kinds.includes('challans') ? [side === 'receivable' ? 'sales_challan' : 'purchase_challan'] : []),
        ...(kinds.includes('orders') ? [side === 'receivable' ? 'sales_order' : 'purchase_order'] : [])];
    for (const stage of pendingStages) {
        const docs = await pendingDocuments(c, t, stage, { asOn, partyIds: f.partyIds, productCompanyIds: f.companyIds });
        docs.forEach(d => {
            const l = byId[d.party_id];
            if (l ? !masterOk(l) : (f.areaIds.length || f.routeIds.length || f.agentIds.length || f.groupIds.length || f.search)) return;
            const row = rowFor(d.party_id, d.product_company_id, d.party_name);
            row.docs.push({ kind: d.kind, doc_type: d.stage, doc_id: d.doc_id, doc_label: d.label, doc_no: d.doc_no, doc_date: d.doc_date, due_date: d.due_date,
                amount: d.total_amount, settled: round2(d.total_amount - d.pending_value), remaining: d.pending_value, pending_base_qty: d.pending_base_qty, vehicle_no: d.vehicle_no });
        });
        if (docs.length && asOn < new Date().toISOString().slice(0, 10)) warnings.push('Challan / order pending quantities are as of today.');
    }

    // ---- age every document ----
    const bucketOf = d => {
        if (basis === 'due_date' && d < 0) return 'not_due';
        return buckets.find(b => b.max >= 0 && d <= b.max)?.key || buckets[buckets.length - 1].key;
    };
    const out = [...rows.values()].map(r => {
        const b = Object.fromEntries(buckets.map(x => [x.key, 0]));
        const sums = { bill: 0, challan: 0, order: 0 };
        let oldest = null, overdue = 0;
        r.docs.forEach(d => {
            if (d.kind === 'on_account') { d.days = d.doc_date ? days(d.doc_date, asOn) : null; return; }
            const from = basis === 'due_date' ? d.due_date || (d.doc_date ? addDays(d.doc_date, r.credit_days) : null) : d.doc_date;
            d.age_from = from;
            d.days = from ? days(from, asOn) : 9999;
            d.doc_days = d.doc_date ? days(d.doc_date, asOn) : null;
            d.bucket = bucketOf(d.days);
            b[d.bucket] = round2(b[d.bucket] + d.remaining);
            sums[d.kind === 'opening' ? 'bill' : d.kind] = round2((sums[d.kind === 'opening' ? 'bill' : d.kind] || 0) + d.remaining);
            if (d.doc_days !== null) oldest = Math.max(oldest ?? 0, d.doc_days);
            if (basis === 'due_date' ? d.days > 0 : r.credit_days && d.doc_days > r.credit_days) overdue = round2(overdue + d.remaining);
        });
        r.docs.sort((x, y) => String(x.doc_date || '').localeCompare(String(y.doc_date || '')) || String(x.doc_no).localeCompare(String(y.doc_no)));
        const billsNet = round2(sums.bill - r.on_account + r.unallocated);
        return { ...r, buckets: b, bills_total: sums.bill, challan_total: sums.challan, order_total: sums.order,
            net_outstanding: billsNet, total: round2(billsNet + sums.challan + sums.order), overdue, oldest_days: oldest,
            over_limit: r.credit_limit > 0 && billsNet > r.credit_limit };
    }).filter(r => q.hide_zero === 'false' || Math.abs(r.total) > 0.005 || r.docs.length);
    const minAmt = Number(q.min_amount) || 0;
    let result = minAmt ? out.filter(r => r.total >= minAmt) : out;
    const sortBy = q.sort_by;
    result.sort((a, b) => (sortBy === 'total' ? b.total - a.total : sortBy === 'oldest' ? (b.oldest_days || 0) - (a.oldest_days || 0) : 0)
        || a.party_name.localeCompare(b.party_name) || String(a.company_name || '').localeCompare(String(b.company_name || '')));
    if (q.only_overdue === 'true') result = result.filter(r => r.overdue > 0.005);

    const sum = k => round2(result.reduce((s, r) => s + (r[k] || 0), 0));
    const totals = { buckets: Object.fromEntries(buckets.map(x => [x.key, round2(result.reduce((s, r) => s + r.buckets[x.key], 0))])),
        bills_total: sum('bills_total'), on_account: sum('on_account'), unallocated: sum('unallocated'), challan_total: sum('challan_total'),
        order_total: sum('order_total'), net_outstanding: sum('net_outstanding'), total: sum('total'), overdue: sum('overdue'), parties: result.length };
    if (method === 'auto' && result.some(r => r.method === 'bill_wise') && result.some(r => r.method === 'fifo')) warnings.push('Parties with bill-to-bill on are aged by their bills, the others by FIFO.');
    if (result.some(r => Math.abs(r.unallocated) > 0.005)) warnings.push('"Unallocated" = ledger balance not covered by bill-wise references (opening balance or entries without bill-wise) - choose FIFO to spread it over the bills.');
    return { side, as_on: asOn, method, basis, kinds, company_wise: companyWise, company_wise_setting: companyWiseSetting,
        bill_wise_setting: settings.bill_wise_tracking !== false, buckets: buckets.map(({ key, label }) => ({ key, label })), rows: result, totals, warnings: [...new Set(warnings)] };
}

// Party / company lists for the filter pickers.
async function ageingMeta(c, t) {
    const [groups, ledgers, areas, routes, agents, companies] = await Promise.all([
        fe.loadGroups(c, t),
        fetchAll(() => c.from('ledger_accounts').select('id, account_code, account_name, account_group_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('areas').select('id, area_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('routes').select('id, route_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('salesman_agents').select('id, agent_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_companies').select('id, company_name').eq('tenant_id', t).order('id'))
    ]);
    const party = anchor => ledgers.filter(l => groups[l.account_group_id]?.anchor === anchor)
        .map(l => ({ id: l.id, name: l.account_code ? `${l.account_name} · ${l.account_code}` : l.account_name })).sort((a, b) => a.name.localeCompare(b.name));
    const groupList = anchor => Object.values(groups).filter(g => g.anchor === anchor).map(g => ({ id: g.id, name: g.group_name })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const list = (rows, k) => rows.map(r => ({ id: r.id, name: r[k] })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { customers: party('RECEIVABLES'), suppliers: party('PAYABLES'), customer_groups: groupList('RECEIVABLES'), supplier_groups: groupList('PAYABLES'),
        areas: list(areas, 'area_name'), routes: list(routes, 'route_name'), agents: list(agents, 'agent_name'), companies: list(companies, 'company_name') };
}

module.exports = { ageing, ageingMeta, parseBuckets, docInfo };
