// =============================================
// utils/firmImport.js
// Tools > Import from another Firm (pages/FirmImport.jsx,
// routes/firmImportRoutes.js): copy masters and transactions from another
// firm (company / database) the user can open into the current one.
//
// Masters (dependency order): each source record is matched here by its code
// (account group code, ledger code, product code ...). Matched = mapped (or
// updated, mode 'update'); not found = inserted. The masters a chosen master
// needs (a ledger's account group, a product's unit / group ...) come along.
// Opening balances / quantities are copied only when asked.
//
// Transactions: the masters they need (ledgers, sub-ledgers, products, billing
// terms) are imported with them. Header + lines (+ their billing terms, VAT included) come in
// as DRAFTS with every master id translated to this firm's id; posting them
// (Post imported drafts, or each screen) makes the ledger / stock effect with
// this firm's own rules. A document number already used here gets "-<firm>".
//
// Any *_id column whose master is not known here is left empty; a record
// that then fails (a required master missing) is reported, the rest go on.
// firm_import_log keeps source id -> id here: masters match again next time
// and a transaction is never imported twice.
// =============================================
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const SYS = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'company_id']);

// key, table, code column, label, masters it needs, opening-balance columns
const MASTERS = [
    { key: 'account_groups', table: 'account_groups', code: 'group_code', label: 'Account Groups', needs: [] },
    { key: 'ledger_accounts', table: 'ledger_accounts', code: 'account_code', label: 'Ledgers (accounts, parties)', needs: ['account_groups'], opening: { opening_balance: 0, current_balance: 0 } },
    { key: 'sub_ledgers', table: 'sub_ledgers', code: 'sub_ledger_code', label: 'Sub-Ledgers', needs: ['ledger_accounts'] },
    { key: 'product_units', table: 'product_units', code: 'unit_code', label: 'Units', needs: [] },
    { key: 'product_groups', table: 'product_groups', code: 'group_code', label: 'Product Groups', needs: [] },
    { key: 'product_categories', table: 'product_categories', code: 'category_code', label: 'Product Categories', needs: [] },
    { key: 'areas', table: 'areas', code: 'area_code', label: 'Areas', needs: [] },
    { key: 'salesman_agents', table: 'salesman_agents', code: 'agent_code', label: 'Salesman / Agents', needs: [] },
    { key: 'product_companies', table: 'product_companies', code: 'company_code', label: 'Product Companies', needs: [] },
    { key: 'routes', table: 'routes', code: 'route_code', label: 'Routes', needs: ['areas'] },
    { key: 'cost_centers', table: 'cost_centers', code: 'cost_center_code', label: 'Cost Centers', needs: [] },
    { key: 'profit_centers', table: 'profit_centers', code: 'profit_center_code', label: 'Profit Centers', needs: [] },
    { key: 'business_units', table: 'business_units', code: 'unit_code', label: 'Business Units', needs: [] },
    { key: 'warehouses', table: 'warehouses', code: 'warehouse_code', label: 'Warehouses', needs: [] },
    { key: 'currencies', table: 'currencies', code: 'currency_code', label: 'Currencies', needs: [] },
    { key: 'billing_terms', table: 'billing_terms', code: 'term_code', label: 'Billing Terms', needs: ['ledger_accounts'] },
    { key: 'products', table: 'products', code: 'product_code', label: 'Products', needs: ['product_units', 'product_groups'], opening: { opening_qty: 0, opening_rate: 0, opening_value: 0 } },
    { key: 'transport_master', table: 'transport_master', code: 'transport_code', label: 'Transport', needs: [] },
    { key: 'remarks_master', table: 'remarks_master', code: 'remark_text', label: 'Remarks', needs: [] }
];
// key, header, lines, line -> header column, label, status api (for posting the drafts)
const TXNS = [
    { key: 'sales_orders', table: 'sales_orders', lines: 'sales_order_details', fk: 'order_id', label: 'Sales Orders', api: 'sales-orders' },
    { key: 'purchase_orders', table: 'purchase_orders', lines: 'purchase_order_details', fk: 'order_id', label: 'Purchase Orders', api: 'purchase-orders' },
    { key: 'sales_bills', table: 'sales_bills', lines: 'sales_bill_details', fk: 'bill_id', label: 'Sales Bills', api: 'sales-bills' },
    { key: 'purchase_bills', table: 'purchase_bills', lines: 'purchase_bill_details', fk: 'bill_id', label: 'Purchase Bills', api: 'purchase-bills' },
    { key: 'sales_returns', table: 'sales_returns', lines: 'sales_return_details', fk: 'return_id', label: 'Sales Returns', api: 'sales-returns' },
    { key: 'purchase_returns', table: 'purchase_returns', lines: 'purchase_return_details', fk: 'return_id', label: 'Purchase Returns', api: 'purchase-returns' },
    { key: 'credit_notes', table: 'credit_notes', lines: 'credit_note_details', fk: 'credit_note_id', label: 'Credit Notes', api: 'credit-notes' },
    { key: 'debit_notes', table: 'debit_notes', lines: 'debit_note_details', fk: 'debit_note_id', label: 'Debit Notes', api: 'debit-notes' },
    { key: 'cash_bank_entries', table: 'cash_bank_entries', lines: 'cash_bank_entry_lines', fk: 'entry_id', label: 'Cash / Bank Receipts & Payments', api: 'cash-bank-entries' },
    { key: 'journal_vouchers', table: 'journal_vouchers', lines: 'journal_voucher_details', fk: 'jv_id', label: 'Journal Vouchers', api: 'journal-vouchers' }
];
// masters every transaction needs (party / cash / bank ledgers, products, VAT and other terms): imported with them
const TXN_NEEDS = ['ledger_accounts', 'sub_ledgers', 'products', 'billing_terms'];
const masterOf = k => MASTERS.find(m => m.key === k);
const txnOf = k => TXNS.find(x => x.key === k);

async function fetchAll(build, page = 1000) {
    const out = [];
    for (let from = 0; ; from += page) {
        const { data, error } = await build().range(from, from + page - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < page) break;
    }
    return out;
}
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...((await fn(ids.slice(i, i + size))) || []));
    return out;
}
const norm = v => String(v ?? '').trim().toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// the masters asked for plus everything they need
function expandMasters(keys) {
    const want = new Set();
    const add = k => { if (want.has(k) || !masterOf(k)) return; masterOf(k).needs.forEach(add); want.add(k); };
    (keys || []).forEach(add);
    return MASTERS.filter(m => want.has(m.key)).map(m => m.key);
}

/** counts in the source firm and how many already exist here (by code) */
async function preview(src, tgt, srcT, tgtT, q = {}) {
    const masters = [];
    for (const m of MASTERS) {
        try {
            const s = await fetchAll(() => src.from(m.table).select(`id, ${m.code}`).eq('tenant_id', srcT).order('id'));
            const t = await fetchAll(() => tgt.from(m.table).select(`id, ${m.code}`).eq('tenant_id', tgtT).order('id'));
            const have = new Set(t.map(r => norm(r[m.code])));
            masters.push({ key: m.key, label: m.label, needs: m.needs, source: s.length, existing: s.filter(r => have.has(norm(r[m.code]))).length, new: s.filter(r => !have.has(norm(r[m.code]))).length });
        } catch (e) { masters.push({ key: m.key, label: m.label, needs: m.needs, error: e.message }); }
    }
    const { data: log } = await tgt.from('firm_import_log').select('entity, source_id').eq('tenant_id', tgtT).eq('source_tenant_id', srcT);
    const done = new Set((log || []).map(l => `${l.entity}|${l.source_id}`));
    const transactions = [];
    for (const x of TXNS) {
        try {
            let b = () => { let r = src.from(x.table).select('id, status, doc_date').eq('tenant_id', srcT).neq('status', 'cancelled'); if (q.date_from) r = r.gte('doc_date', q.date_from); if (q.date_to) r = r.lte('doc_date', q.date_to); return r.order('id'); };
            const s = await fetchAll(b);
            transactions.push({ key: x.key, label: x.label, source: s.length, posted: s.filter(d => d.status === 'posted').length, already: s.filter(d => done.has(`${x.key}|${d.id}`)).length });
        } catch (e) { transactions.push({ key: x.key, label: x.label, error: e.message }); }
    }
    return { masters, transactions };
}

async function run(src, tgt, srcT, tgtT, opts, userId, sourceName) {
    const mode = opts.mode === 'update' ? 'update' : 'skip';
    const withOpening = !!opts.include_opening;
    const report = { masters: [], transactions: [], errors: [], imported_ids: {} };
    const idMap = new Map();                        // source id -> id here (masters and documents)
    const { data: log } = await tgt.from('firm_import_log').select('entity, source_id, target_id').eq('tenant_id', tgtT).eq('source_tenant_id', srcT);
    (log || []).forEach(l => idMap.set(l.source_id, l.target_id));
    const done = new Set((log || []).map(l => `${l.entity}|${l.source_id}`));
    const logRows = [];
    const remember = (entity, s, t, ref) => { idMap.set(s, t); if (!done.has(`${entity}|${s}`)) { done.add(`${entity}|${s}`); logRows.push({ tenant_id: tgtT, source_tenant_id: srcT, entity, source_id: s, target_id: t, source_ref: ref ? String(ref).slice(0, 120) : null, imported_by: userId }); } };

    // every *_id column translated; unknown masters left empty (self references in a second pass)
    const translate = (row, keep = {}) => {
        const out = {};
        Object.entries(row).forEach(([k, v]) => {
            if (SYS.has(k)) return;
            if (k in keep) { out[k] = keep[k]; return; }
            if (k.endsWith('_id') && v && UUID.test(String(v))) out[k] = idMap.get(v) || null;
            else if (k.endsWith('_ids') && Array.isArray(v)) out[k] = v.map(x => (UUID.test(String(x)) ? idMap.get(x) : x)).filter(Boolean);
            else out[k] = v;
        });
        return { ...out, ...keep, tenant_id: tgtT };
    };

    // ---- masters: match by code, insert the rest ----
    const wanted = expandMasters([...(opts.masters || []), ...((opts.transactions || []).length ? TXN_NEEDS : [])]);
    // masters not chosen are still matched by code, so transactions / chosen masters find them
    for (const m of MASTERS) {
        const s = await fetchAll(() => src.from(m.table).select('*').eq('tenant_id', srcT).order('id')).catch(() => null);
        if (!s) continue;
        const t = await fetchAll(() => tgt.from(m.table).select(`id, ${m.code}`).eq('tenant_id', tgtT).order('id'));
        const byCode = new Map(t.map(r => [norm(r[m.code]), r.id]));
        s.forEach(r => { const hit = byCode.get(norm(r[m.code])); if (hit && !idMap.has(r.id)) idMap.set(r.id, hit); });
        if (!wanted.includes(m.key)) continue;
        const stat = { key: m.key, label: m.label, inserted: 0, updated: 0, matched: 0, failed: 0 };
        const selfRefs = [];
        for (const r of s) {
            const hit = byCode.get(norm(r[m.code]));
            const opening = withOpening || !m.opening ? {} : m.opening;
            if (hit) {
                stat.matched += 1;
                remember(m.key, r.id, hit, r[m.code]);
                if (mode === 'update') {
                    const row = translate(r, opening); delete row[m.code]; delete row.is_system;
                    const { error } = await tgt.from(m.table).update(row).eq('id', hit).eq('tenant_id', tgtT);
                    if (error) { stat.failed += 1; report.errors.push(`${m.label} ${r[m.code]}: ${error.message}`); } else stat.updated += 1;
                }
                continue;
            }
            const row = translate(r, opening);
            // a reference to a record of the same list not yet here: fill it in after all are in
            Object.keys(r).forEach(k => { if (k.endsWith('_id') && r[k] && s.some(x => x.id === r[k]) && !idMap.get(r[k])) { selfRefs.push([r.id, k, r[k]]); row[k] = null; } });
            const { data: ins, error } = await tgt.from(m.table).insert(row).select('id').single();
            if (error) { stat.failed += 1; report.errors.push(`${m.label} ${r[m.code]}: ${error.message}`); continue; }
            stat.inserted += 1;
            byCode.set(norm(r[m.code]), ins.id);
            remember(m.key, r.id, ins.id, r[m.code]);
        }
        for (const [sid, col, ref] of selfRefs) {
            const t1 = idMap.get(sid), t2 = idMap.get(ref);
            if (t1 && t2) await tgt.from(m.table).update({ [col]: t2 }).eq('id', t1);
        }
        report.masters.push(stat);
    }

    // ---- transactions: as drafts, with their lines and billing terms ----
    const { data: fys } = await tgt.from('fiscal_years').select('id, start_date_eng, end_date_eng').eq('tenant_id', tgtT);
    const fyOf = d => (fys || []).find(y => d && String(y.start_date_eng).slice(0, 10) <= d && d <= String(y.end_date_eng).slice(0, 10))?.id || null;
    const suffix = String(sourceName || 'FIRM').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'FIRM';
    for (const key of (opts.transactions || [])) {
        const x = txnOf(key);
        if (!x) continue;
        const stat = { key, label: x.label, api: x.api, imported: 0, skipped: 0, failed: 0 };
        report.imported_ids[key] = [];
        let heads = await fetchAll(() => { let r = src.from(x.table).select('*').eq('tenant_id', srcT).neq('status', 'cancelled'); if (opts.date_from) r = r.gte('doc_date', opts.date_from); if (opts.date_to) r = r.lte('doc_date', opts.date_to); if (opts.posted_only) r = r.eq('status', 'posted'); return r.order('id'); });
        heads = heads.sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)) || String(a.doc_no).localeCompare(String(b.doc_no)));
        const fresh = heads.filter(h => { if (done.has(`${key}|${h.id}`)) { stat.skipped += 1; return false; } return true; });
        const ids = fresh.map(h => h.id);
        const lines = await inChunks(ids, async ch => (await src.from(x.lines).select('*').in(x.fk, ch)).data);
        const docTerms = await inChunks(ids, async ch => (await src.from('document_billing_terms').select('*').in('document_id', ch)).data).catch(() => []);
        const lineTerms = await inChunks(ids, async ch => (await src.from('document_line_billing_terms').select('*').in('document_id', ch)).data).catch(() => []);
        const usedNos = await inChunks(fresh.map(h => h.doc_no).filter(Boolean), async ch => (await tgt.from(x.table).select('doc_no').eq('tenant_id', tgtT).in('doc_no', ch)).data);
        const taken = new Set(usedNos.map(r => r.doc_no));
        for (const h of fresh) {
            let docNo = h.doc_no;
            if (taken.has(docNo)) docNo = `${h.doc_no}-${suffix}`;
            taken.add(docNo);
            // a fresh draft here: this firm's fiscal year, no approval / cancel / posting stamps of the other firm
            const extra = { doc_no: docNo, status: 'draft', fiscal_year_id: fyOf(String(h.doc_date || '').slice(0, 10)),
                cancellation_reason: null, cancelled_at: null, cancelled_by: null, approved_by: null, approved_at: null, posted_at: null, posted_by: null };
            const head = translate(h, Object.fromEntries(Object.entries(extra).filter(([k]) => k in h)));
            const mine = lines.filter(l => l[x.fk] === h.id);
            const { data: ins, error } = await tgt.from(x.table).insert(head).select('id').single();
            if (error) { stat.failed += 1; report.errors.push(`${x.label} ${h.doc_no}: ${error.message}`); continue; }
            remember(key, h.id, ins.id, h.doc_no);
            let lineErr = null;
            for (const l of mine) {
                const row = translate(l, { [x.fk]: ins.id });
                const { data: li, error: le } = await tgt.from(x.lines).insert(row).select('id').single();
                if (le) { lineErr = le.message; break; }
                idMap.set(l.id, li.id);
            }
            if (!lineErr) {
                const dt = docTerms.filter(t => t.document_id === h.id).map(t => translate(t, { document_id: ins.id })).filter(t => t.billing_term_id);
                const lt = lineTerms.filter(t => t.document_id === h.id).map(t => translate(t, { document_id: ins.id, detail_id: idMap.get(t.detail_id) || null })).filter(t => t.billing_term_id && t.detail_id);
                if (dt.length) { const { error: e1 } = await tgt.from('document_billing_terms').insert(dt); if (e1) lineErr = e1.message; }
                if (!lineErr && lt.length) { const { error: e2 } = await tgt.from('document_line_billing_terms').insert(lt); if (e2) lineErr = e2.message; }
            }
            if (lineErr) {
                // all or nothing per document: take the half-imported draft out again
                await tgt.from('document_line_billing_terms').delete().eq('document_id', ins.id);
                await tgt.from('document_billing_terms').delete().eq('document_id', ins.id);
                await tgt.from(x.lines).delete().eq(x.fk, ins.id);
                await tgt.from(x.table).delete().eq('id', ins.id);
                const li = logRows.findIndex(r => r.source_id === h.id && r.entity === key);
                if (li >= 0) logRows.splice(li, 1);
                done.delete(`${key}|${h.id}`); idMap.delete(h.id); taken.delete(docNo);
                stat.failed += 1; report.errors.push(`${x.label} ${h.doc_no}: ${lineErr}`);
                continue;
            }
            stat.imported += 1;
            report.imported_ids[key].push({ id: ins.id, doc_no: docNo, doc_date: h.doc_date, was_posted: h.status === 'posted' });
        }
        report.transactions.push(stat);
    }
    for (let i = 0; i < logRows.length; i += 500) {
        const { error } = await tgt.from('firm_import_log').insert(logRows.slice(i, i + 500));
        if (error) report.errors.push(`import log: ${error.message}`);
    }
    report.totals = { masters_inserted: report.masters.reduce((s, m) => s + m.inserted, 0), masters_matched: report.masters.reduce((s, m) => s + m.matched, 0),
        documents: report.transactions.reduce((s, t) => s + t.imported, 0), failed: report.errors.length };
    return report;
}

module.exports = { MASTERS, TXNS, TXN_NEEDS, expandMasters, preview, run, round2 };
