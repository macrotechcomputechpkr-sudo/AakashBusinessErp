// =============================================
// utils/messaging.js
// Email / SMS / WhatsApp / Viber for documents and reminders.
//   templates   per channel and event, with {{placeholders}} filled from the
//               document (party, doc no, date, amounts, items, balance ...)
//   send        email over the company's own SMTP (nodemailer), SMS through
//               a Nepal gateway (Sparrow / Aakash SMS) or any HTTP gateway,
//               WhatsApp through the WhatsApp Cloud API or a free click-to-chat
//               link, Viber as a share link (Viber has no free direct API)
//   auto-send   rules per event (sales bill posted, receipt posted ...) and
//               channel; fired after posting, never blocking it; the same
//               message is never sent twice for one document
//   log         every message with status; link-channel messages wait in the
//               log until someone clicks to open WhatsApp / Viber
// =============================================
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CHANNELS = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', viber: 'Viber' };
const EVENTS = {
    sales_bill_posted: { label: 'Sales Bill posted', doc: 'sales_bill' },
    sales_order_confirmed: { label: 'Sales Order confirmed', doc: 'sales_order' },
    sales_delivery_posted: { label: 'Delivery / Challan posted', doc: 'sales_delivery' },
    sales_return_posted: { label: 'Sales Return posted', doc: 'sales_return' },
    receipt_posted: { label: 'Receipt posted (thank-you)', doc: 'cash_bank_entry' },
    payment_posted: { label: 'Payment posted (advice)', doc: 'cash_bank_entry' },
    purchase_order_confirmed: { label: 'Purchase Order confirmed (to supplier)', doc: 'purchase_order' },
    pdc_received: { label: 'PDC received (acknowledgement)', doc: 'pdc' },
    outstanding_reminder: { label: 'Outstanding / due reminder', doc: 'party' },
    custom: { label: 'Custom message', doc: null }
};
const PLACEHOLDERS = ['company_name', 'company_phone', 'party_name', 'doc_type', 'doc_no', 'doc_date', 'due_date', 'amount', 'vat', 'taxable', 'items', 'item_count',
    'balance', 'overdue', 'cheque_no', 'cheque_date', 'bank', 'payment_mode', 'narration', 'salesman'];
const DEFAULTS = [
    ['sales_bill_posted', 'sms', 'Bill SMS', null, 'Dear {{party_name}}, bill {{doc_no}} dated {{doc_date}} of Rs {{amount}} is issued. Balance Rs {{balance}}. - {{company_name}}'],
    ['sales_bill_posted', 'whatsapp', 'Bill WhatsApp', null, 'Namaste {{party_name}} 🙏\nYour bill *{{doc_no}}* ({{doc_date}})\n{{items}}\nTotal: *Rs {{amount}}* (VAT {{vat}})\nBalance: Rs {{balance}}\nThank you - {{company_name}}'],
    ['sales_bill_posted', 'email', 'Bill Email', 'Invoice {{doc_no}} from {{company_name}}', 'Dear {{party_name}},\n\nPlease find the details of invoice {{doc_no}} dated {{doc_date}}:\n\n{{items}}\n\nTaxable: Rs {{taxable}}\nVAT: Rs {{vat}}\nTotal: Rs {{amount}}\nDue date: {{due_date}}\nYour balance with us: Rs {{balance}}\n\nThank you for your business.\n{{company_name}}'],
    ['receipt_posted', 'sms', 'Receipt SMS', null, 'Dear {{party_name}}, we received Rs {{amount}} ({{payment_mode}}) on {{doc_date}}, ref {{doc_no}}. Balance Rs {{balance}}. Thank you - {{company_name}}'],
    ['receipt_posted', 'whatsapp', 'Receipt WhatsApp', null, 'Namaste {{party_name}} 🙏\nReceived *Rs {{amount}}* on {{doc_date}} (receipt {{doc_no}}).\nBalance: Rs {{balance}}\nThank you - {{company_name}}'],
    ['sales_order_confirmed', 'whatsapp', 'Order WhatsApp', null, 'Namaste {{party_name}}, your order {{doc_no}} ({{item_count}} items, Rs {{amount}}) is confirmed. - {{company_name}}'],
    ['purchase_order_confirmed', 'email', 'PO Email', 'Purchase Order {{doc_no}} - {{company_name}}', 'Dear {{party_name}},\n\nPlease supply the following against our purchase order {{doc_no}} dated {{doc_date}}:\n\n{{items}}\n\nTotal: Rs {{amount}}\n\nRegards,\n{{company_name}}'],
    ['outstanding_reminder', 'sms', 'Reminder SMS', null, 'Dear {{party_name}}, your outstanding balance is Rs {{balance}} (overdue Rs {{overdue}}). Kindly arrange payment. - {{company_name}}'],
    ['outstanding_reminder', 'whatsapp', 'Reminder WhatsApp', null, 'Namaste {{party_name}} 🙏\nYour balance with us is *Rs {{balance}}*, of which Rs {{overdue}} is overdue. Kindly arrange payment.\n- {{company_name}}'],
    ['outstanding_reminder', 'email', 'Reminder Email', 'Payment reminder - {{company_name}}', 'Dear {{party_name}},\n\nOur records show a balance of Rs {{balance}} on your account, of which Rs {{overdue}} is past due.\nKindly arrange the payment at the earliest.\n\nRegards,\n{{company_name}}'],
    ['pdc_received', 'sms', 'PDC SMS', null, 'Dear {{party_name}}, we received your cheque {{cheque_no}} ({{bank}}) of Rs {{amount}} dated {{cheque_date}}. - {{company_name}}']
];

const fill = (text, ctx) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (ctx[k] === undefined || ctx[k] === null ? '' : String(ctx[k])));
const digits = s => String(s || '').replace(/[^\d+]/g, '');
function normalizePhone(p, cc = '977') {
    let x = digits(p).replace(/^\+/, '');
    if (!x) return null;
    if (x.startsWith('00')) x = x.slice(2);
    if (x.length === 10 && x.startsWith('9') && !x.startsWith(cc)) x = cc + x;     // Nepali mobile 98xxxxxxxx
    return x;
}

// ---------------------------------------------------------------- settings / templates
async function settings(c, t) {
    const { data, error } = await c.from('message_settings').select('*').eq('tenant_id', t).maybeSingle();
    if (error && /message_settings|does not exist|Could not find/i.test(error.message)) throw httpError('Messaging tables are missing - run database migration 119 first');
    return data || { tenant_id: t, sms_gateway: 'none', whatsapp_mode: 'link', viber_mode: 'link', default_country_code: '977', smtp_port: 587 };
}
const SECRET = ['smtp_password', 'sms_token', 'whatsapp_token'];
const masked = s => ({ ...s, ...Object.fromEntries(SECRET.map(k => [k, s[k] ? '********' : ''])) });
async function saveSettings(c, t, userId, b) {
    const cols = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_password', 'from_email', 'from_name', 'sms_gateway', 'sms_token', 'sms_sender', 'sms_custom_url',
        'whatsapp_mode', 'whatsapp_token', 'whatsapp_phone_id', 'viber_mode', 'default_country_code', 'reminder_min_balance'];
    const row = { tenant_id: t, updated_by: userId, updated_at: new Date().toISOString() };
    cols.forEach(k => { if (b[k] !== undefined && !(SECRET.includes(k) && (b[k] === '' || b[k] === '********'))) row[k] = b[k] === '' ? null : b[k]; });
    if (row.smtp_port) row.smtp_port = Number(row.smtp_port) || 587;
    if (row.sms_gateway && !['none', 'sparrow', 'aakash', 'custom'].includes(row.sms_gateway)) throw httpError('Unknown SMS gateway');
    if (row.whatsapp_mode && !['link', 'cloud_api'].includes(row.whatsapp_mode)) throw httpError('Unknown WhatsApp mode');
    const { data: ex } = await c.from('message_settings').select('tenant_id').eq('tenant_id', t).maybeSingle();
    const { error } = ex ? await c.from('message_settings').update(row).eq('tenant_id', t) : await c.from('message_settings').insert(row);
    if (error) throw error;
    return masked(await settings(c, t));
}
async function templates(c, t, q = {}) {
    let x = c.from('message_templates').select('*').eq('tenant_id', t);
    if (q.channel) x = x.eq('channel', q.channel);
    if (q.event) x = x.eq('event', q.event);
    const { data, error } = await x.order('event').order('channel');
    if (error) throw error;
    return data || [];
}
async function seedDefaults(c, t, userId) {
    const have = await templates(c, t);
    const rows = DEFAULTS.filter(([ev, ch]) => !have.some(h => h.event === ev && h.channel === ch))
        .map(([event, channel, name, subject, body]) => ({ tenant_id: t, event, channel, name, subject, body, is_default: true, is_active: true, created_by: userId || null }));
    if (rows.length) { const { error } = await c.from('message_templates').insert(rows); if (error) throw error; }
    return { added: rows.length };
}
async function saveTemplate(c, t, userId, b) {
    if (!CHANNELS[b.channel]) throw httpError('Choose the channel');
    if (!EVENTS[b.event]) throw httpError('Choose the event');
    if (!String(b.name || '').trim() || !String(b.body || '').trim()) throw httpError('Name and message are required');
    if (b.channel === 'sms' && String(b.body).length > 480) throw httpError('An SMS template can be at most 480 characters (3 SMS)');
    const row = { tenant_id: t, channel: b.channel, event: b.event, name: String(b.name).trim(), subject: b.channel === 'email' ? b.subject || null : null, body: b.body, is_default: !!b.is_default, is_active: b.is_active !== false };
    if (row.is_default) await c.from('message_templates').update({ is_default: false }).eq('tenant_id', t).eq('event', row.event).eq('channel', row.channel);
    const { data, error } = b.id
        ? await c.from('message_templates').update(row).eq('id', b.id).eq('tenant_id', t).select().single()
        : await c.from('message_templates').insert({ ...row, created_by: userId || null }).select().single();
    if (error) throw error;
    return data;
}

// ---------------------------------------------------------------- context
async function partyBalance(c, t, ledgerId) {
    const { data: led } = await c.from('ledger_accounts').select('opening_balance, opening_balance_type, credit_days').eq('id', ledgerId).maybeSingle();
    let bal = (led?.opening_balance_type === 'cr' ? -1 : 1) * (Number(led?.opening_balance) || 0);
    for (let from = 0; ; from += 1000) {
        const { data } = await c.from('ledger_transaction_lines').select('debit_amount, credit_amount').eq('tenant_id', t).eq('ledger_account_id', ledgerId).range(from, from + 999);
        (data || []).forEach(l => { bal += Number(l.debit_amount || 0) - Number(l.credit_amount || 0); });
        if (!data || data.length < 1000) break;
    }
    const { data: refs } = await c.from('bill_wise_references').select('source_date, remaining_amount, nature').eq('ledger_id', ledgerId).gt('remaining_amount', 0);
    const today = new Date().toISOString().slice(0, 10), cd = Number(led?.credit_days) || 0;
    const overdue = (refs || []).filter(r => new Date(Date.parse(`${String(r.source_date).slice(0, 10)}T00:00:00Z`) + cd * 86400000).toISOString().slice(0, 10) < today)
        .reduce((s, r) => s + (r.nature === 'dr' ? 1 : -1) * Number(r.remaining_amount || 0), 0);
    return { balance: round2(bal), overdue: round2(overdue) };
}
const DOCS = {
    sales_bill: { table: 'sales_bills', detail: ['sales_bill_details', 'bill_id'], party: 'customer_ledger_id', label: 'Sales Bill' },
    sales_order: { table: 'sales_orders', detail: ['sales_order_details', 'order_id'], party: 'customer_ledger_id', label: 'Sales Order' },
    sales_delivery: { table: 'sales_deliveries', detail: ['sales_delivery_details', 'delivery_id'], party: 'customer_ledger_id', label: 'Delivery Challan' },
    sales_return: { table: 'sales_returns', detail: ['sales_return_details', 'return_id'], party: 'customer_ledger_id', label: 'Sales Return' },
    purchase_order: { table: 'purchase_orders', detail: ['purchase_order_details', 'order_id'], party: 'vendor_ledger_id', label: 'Purchase Order' },
    cash_bank_entry: { table: 'cash_bank_entries', party: 'party_ledger_id', label: 'Receipt / Payment' },
    pdc: { table: 'pdc_vouchers', party: 'party_ledger_id', label: 'PDC' }
};
async function buildContext(c, t, docType, docId, partyId) {
    const { data: co } = await c.from('company_profile').select('company_name, contact_phone, contact_mobile').eq('tenant_id', t).maybeSingle();
    const ctx = { company_name: co?.company_name || '', company_phone: co?.contact_mobile || co?.contact_phone || '' };
    let ledgerId = partyId || null;
    if (docType && docType !== 'party' && DOCS[docType]) {
        const D = DOCS[docType];
        const { data: h } = await c.from(D.table).select('*').eq('id', docId).eq('tenant_id', t).maybeSingle();
        if (!h) throw httpError('Document not found', 404);
        ledgerId = h[D.party];
        Object.assign(ctx, { doc_type: D.label, doc_no: h.doc_no, doc_date: String(h.doc_date || '').slice(0, 10), due_date: h.due_date ? String(h.due_date).slice(0, 10) : '',
            amount: fmt(h.total_amount ?? h.amount), vat: fmt(h.total_tax_amount), taxable: fmt(Number(h.total_amount ?? h.amount ?? 0) - Number(h.total_tax_amount || 0)),
            cheque_no: h.cheque_no || '', cheque_date: h.cheque_date ? String(h.cheque_date).slice(0, 10) : '', bank: h.bank_name || '', payment_mode: h.payment_mode || '',
            narration: h.narration || '', salesman: h.agent_name_snapshot || '', _doc: h });
        if (D.detail) {
            const { data: lines } = await c.from(D.detail[0]).select('product_id, product_name_snapshot, qty, uom_name_snapshot, rate, amount').eq(D.detail[1], docId).order('display_order');
            const missing = [...new Set((lines || []).filter(l => !l.product_name_snapshot && l.product_id).map(l => l.product_id))];
            if (missing.length) {
                const { data: ps } = await c.from('products').select('id, product_name').in('id', missing);
                const N = Object.fromEntries((ps || []).map(p => [p.id, p.product_name]));
                (lines || []).forEach(l => { if (!l.product_name_snapshot) l.product_name_snapshot = N[l.product_id] || ''; });
            }
            ctx.item_count = (lines || []).length;
            ctx.items = (lines || []).slice(0, 25).map(l => `${l.product_name_snapshot || ''} x ${Number(l.qty)} ${l.uom_name_snapshot || ''} = ${fmt(l.amount)}`).join('\n') + ((lines || []).length > 25 ? `\n... +${lines.length - 25} more` : '');
        }
    }
    if (!ledgerId) throw httpError('No party for this message');
    const { data: led } = await c.from('ledger_accounts').select('id, account_name, billing_name, email, contact_person_mobile, phone_office').eq('id', ledgerId).maybeSingle();
    Object.assign(ctx, { party_name: led?.billing_name || led?.account_name || '', _email: led?.email || '', _phone: led?.contact_person_mobile || led?.phone_office || '', _ledger: ledgerId });
    const b = await partyBalance(c, t, ledgerId);
    ctx.balance = fmt(b.balance); ctx.overdue = fmt(Math.max(0, b.overdue)); ctx._balance = b.balance; ctx._overdue = b.overdue;
    return ctx;
}

// ---------------------------------------------------------------- transports
function smtpSender(s) {
    let nodemailer;
    try { nodemailer = require('nodemailer'); } catch { throw httpError('Email needs the nodemailer package on the server - run npm install in /server'); }
    if (!s.smtp_host || !s.from_email) throw httpError('Fill the SMTP host and From email in Messaging Settings');
    const tr = nodemailer.createTransport({ host: s.smtp_host, port: Number(s.smtp_port) || 587, secure: !!s.smtp_secure, auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_password } : undefined });
    return async (to, subject, text) => { const r = await tr.sendMail({ from: s.from_name ? `"${s.from_name}" <${s.from_email}>` : s.from_email, to, subject, text }); return r.messageId || 'sent'; };
}
async function httpSend(fetchImpl, url, opts) {
    const r = await fetchImpl(url, opts);
    const body = await r.text();
    if (!r.ok) throw new Error(`Gateway ${r.status}: ${body.slice(0, 200)}`);
    return body.slice(0, 300);
}
function smsSender(s, fetchImpl) {
    if (!s.sms_gateway || s.sms_gateway === 'none') throw httpError('Choose an SMS gateway in Messaging Settings');
    return async (to, text) => {
        if (s.sms_gateway === 'sparrow') {
            const u = new URL('https://api.sparrowsms.com/v2/sms/');
            u.search = new URLSearchParams({ token: s.sms_token || '', from: s.sms_sender || '', to: to.replace(/^977/, ''), text }).toString();
            return httpSend(fetchImpl, u.toString(), { method: 'GET' });
        }
        if (s.sms_gateway === 'aakash') {
            return httpSend(fetchImpl, 'https://sms.aakashsms.com/sms/v3/send', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ auth_token: s.sms_token || '', to: to.replace(/^977/, ''), text }).toString() });
        }
        if (!s.sms_custom_url) throw httpError('Give the custom SMS URL');
        const url = s.sms_custom_url.replace(/\{to\}/g, encodeURIComponent(to)).replace(/\{text\}/g, encodeURIComponent(text)).replace(/\{token\}/g, encodeURIComponent(s.sms_token || '')).replace(/\{sender\}/g, encodeURIComponent(s.sms_sender || ''));
        return httpSend(fetchImpl, url, { method: 'GET' });
    };
}
function whatsappCloud(s, fetchImpl) {
    if (!s.whatsapp_token || !s.whatsapp_phone_id) throw httpError('WhatsApp Cloud API needs the access token and phone number id');
    return (to, text) => httpSend(fetchImpl, `https://graph.facebook.com/v19.0/${encodeURIComponent(s.whatsapp_phone_id)}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${s.whatsapp_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: text } }) });
}
const waLink = (to, text) => `https://wa.me/${to || ''}?text=${encodeURIComponent(text)}`;
const viberLink = (to, text) => (to ? `viber://chat?number=%2B${to}&draft=${encodeURIComponent(text)}` : `viber://forward?text=${encodeURIComponent(text)}`);

// ---------------------------------------------------------------- send
async function log(c, t, row) {
    const { data, error } = await c.from('message_log').insert({ tenant_id: t, ...row }).select().single();
    if (error) console.error('message_log:', error.message);
    return data;
}
async function pickTemplate(c, t, event, channel, templateId) {
    if (templateId) { const { data } = await c.from('message_templates').select('*').eq('id', templateId).eq('tenant_id', t).maybeSingle(); if (data) return data; }
    const list = (await templates(c, t, { event, channel })).filter(x => x.is_active !== false);
    return list.find(x => x.is_default) || list[0] || null;
}
// One message. b: { channel, event, document_type, document_id, party_id, template_id, to, subject, body }
async function sendMessage(c, t, userId, b, { fetchImpl = globalThis.fetch, auto = false, sendEmail } = {}) {
    if (!CHANNELS[b.channel]) throw httpError('Choose Email, SMS, WhatsApp or Viber');
    const s = await settings(c, t);
    const event = b.event || (b.document_type ? Object.keys(EVENTS).find(k => EVENTS[k].doc === b.document_type) : 'custom') || 'custom';
    const ctx = await buildContext(c, t, b.document_type || (event === 'outstanding_reminder' ? 'party' : null), b.document_id, b.party_id);
    const tpl = b.body ? null : await pickTemplate(c, t, event, b.channel, b.template_id);
    if (!b.body && !tpl) throw httpError(`No ${CHANNELS[b.channel]} template for "${EVENTS[event]?.label || event}" - add one under Messaging > Templates`);
    const text = fill(b.body || tpl.body, ctx), subject = b.channel === 'email' ? fill(b.subject || tpl?.subject || `${ctx.doc_type || 'Message'} ${ctx.doc_no || ''} - ${ctx.company_name}`, ctx) : null;
    const cc = s.default_country_code || '977';
    const to = b.channel === 'email' ? String(b.to || ctx._email || '').trim() : normalizePhone(b.to || ctx._phone, cc);
    const base = { channel: b.channel, event, document_type: b.document_type || null, document_id: b.document_id || null, party_ledger_id: ctx._ledger, recipient: to || null,
        subject, body: text, template_id: tpl?.id || null, is_auto: !!auto, created_by: userId || null };
    if (!to && !(b.channel === 'viber' && (s.viber_mode || 'link') === 'link')) {
        await log(c, t, { ...base, status: 'failed', error: b.channel === 'email' ? 'Party has no email' : 'Party has no mobile number' });
        throw httpError(b.channel === 'email' ? 'The party has no email address - add it in Chart of Accounts or type one' : 'The party has no mobile number - add it in Chart of Accounts or type one');
    }
    if (b.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw httpError('Invalid email address');
    try {
        let status = 'sent', resp = null, link = null;
        if (b.channel === 'email') resp = await (sendEmail || smtpSender(s))(to, subject, text);
        else if (b.channel === 'sms') resp = await smsSender(s, fetchImpl)(to, text);
        else if (b.channel === 'whatsapp' && s.whatsapp_mode === 'cloud_api') resp = await whatsappCloud(s, fetchImpl)(to, text);
        else { link = b.channel === 'whatsapp' ? waLink(to, text) : viberLink(to, text); status = 'link'; }
        const row = await log(c, t, { ...base, status, provider_response: resp ? String(resp).slice(0, 500) : null, link, sent_at: status === 'sent' ? new Date().toISOString() : null });
        return { status, link, to, subject, body: text, log_id: row?.id || null };
    } catch (e) {
        await log(c, t, { ...base, status: 'failed', error: e.message.slice(0, 500) });
        throw httpError(`${CHANNELS[b.channel]} not sent: ${e.message}`, e.status || 502);
    }
}
async function preview(c, t, b) {
    const event = b.event || (b.document_type ? Object.keys(EVENTS).find(k => EVENTS[k].doc === b.document_type) : 'custom');
    const ctx = await buildContext(c, t, b.document_type || (event === 'outstanding_reminder' ? 'party' : null), b.document_id, b.party_id);
    const tpl = b.body ? null : await pickTemplate(c, t, event, b.channel, b.template_id);
    const s = await settings(c, t);
    return { event, template_id: tpl?.id || null, subject: b.channel === 'email' ? fill(b.subject || tpl?.subject || '', ctx) : null, body: fill(b.body || tpl?.body || '', ctx),
        to: b.channel === 'email' ? ctx._email : normalizePhone(ctx._phone, s.default_country_code || '977'), party_name: ctx.party_name,
        templates: (await templates(c, t, { channel: b.channel })).filter(x => x.event === event || x.event === 'custom').map(x => ({ id: x.id, name: x.name, event: x.event })) };
}

// ---------------------------------------------------------------- auto send
async function autoRules(c, t) {
    const { data } = await c.from('message_auto_rules').select('*').eq('tenant_id', t);
    return data || [];
}
async function saveRules(c, t, rules) {
    for (const r of rules || []) {
        if (!EVENTS[r.event] || !CHANNELS[r.channel]) continue;
        const { data: ex } = await c.from('message_auto_rules').select('id').eq('tenant_id', t).eq('event', r.event).eq('channel', r.channel).maybeSingle();
        const row = { tenant_id: t, event: r.event, channel: r.channel, enabled: !!r.enabled, template_id: r.template_id || null };
        const { error } = ex ? await c.from('message_auto_rules').update(row).eq('id', ex.id) : await c.from('message_auto_rules').insert(row);
        if (error) throw error;
    }
    return autoRules(c, t);
}
// Fired after a status change: never throws, never blocks the posting.
function onDocumentEvent(c, t, docType, status, docId, userId, extra = {}) {
    (async () => {
        try {
            let event = null;
            if (docType === 'sales_bill' && status === 'posted') event = 'sales_bill_posted';
            else if (docType === 'sales_order' && status === 'confirmed') event = 'sales_order_confirmed';
            else if (docType === 'sales_delivery' && status === 'posted') event = 'sales_delivery_posted';
            else if (docType === 'sales_return' && status === 'posted') event = 'sales_return_posted';
            else if (docType === 'purchase_order' && status === 'confirmed') event = 'purchase_order_confirmed';
            else if (docType === 'cash_bank_entry' && status === 'posted') event = extra.entry_type === 'payment' ? 'payment_posted' : 'receipt_posted';
            else if (docType === 'pdc' && status === 'pending') event = 'pdc_received';
            if (!event) return;
            const rules = (await autoRules(c, t)).filter(r => r.enabled && r.event === event);
            for (const r of rules) {
                const { data: done } = await c.from('message_log').select('id').eq('tenant_id', t).eq('event', event).eq('channel', r.channel).eq('document_id', docId).in('status', ['sent', 'link']).limit(1);
                if ((done || []).length) continue;                   // never twice for one document
                try { await sendMessage(c, t, userId, { channel: r.channel, event, document_type: docType, document_id: docId, template_id: r.template_id }, { auto: true }); }
                catch (e) { console.error(`auto ${r.channel} for ${docType}:`, e.message); }
            }
        } catch (e) { console.error('auto message:', e.message); }
    })();
}

// Outstanding reminders to many parties at once.
async function bulkReminders(c, t, userId, b, opts = {}) {
    const ids = Array.isArray(b.party_ids) ? b.party_ids : [];
    if (!ids.length) throw httpError('Choose the parties');
    const results = [];
    for (const id of ids.slice(0, 500)) {
        try { const r = await sendMessage(c, t, userId, { channel: b.channel, event: 'outstanding_reminder', party_id: id, template_id: b.template_id }, opts); results.push({ party_id: id, status: r.status, link: r.link, to: r.to }); }
        catch (e) { results.push({ party_id: id, status: 'failed', error: e.message }); }
    }
    return { sent: results.filter(r => r.status === 'sent').length, links: results.filter(r => r.status === 'link').length, failed: results.filter(r => r.status === 'failed').length, results };
}
async function messageLog(c, t, q) {
    let x = c.from('message_log').select('*').eq('tenant_id', t);
    if (q.status) x = x.eq('status', q.status);
    if (q.channel) x = x.eq('channel', q.channel);
    if (q.date_from) x = x.gte('created_at', `${q.date_from}T00:00:00`);
    if (q.date_to) x = x.lte('created_at', `${q.date_to}T23:59:59`);
    const { data, error } = await x.order('created_at', { ascending: false }).limit(Math.min(Number(q.limit) || 500, 2000));
    if (error) throw error;
    const ids = [...new Set((data || []).map(r => r.party_ledger_id).filter(Boolean))];
    const { data: leds } = ids.length ? await c.from('ledger_accounts').select('id, account_name').in('id', ids) : { data: [] };
    const N = Object.fromEntries((leds || []).map(l => [l.id, l.account_name]));
    return (data || []).map(r => ({ ...r, party_name: N[r.party_ledger_id] || '' }));
}

module.exports = { CHANNELS, EVENTS, PLACEHOLDERS, settings, masked, saveSettings, templates, seedDefaults, saveTemplate, sendMessage, preview, autoRules, saveRules,
    onDocumentEvent, bulkReminders, messageLog, fill, normalizePhone, waLink, viberLink };
