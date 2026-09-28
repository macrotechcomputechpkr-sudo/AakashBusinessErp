// =============================================
// utils/masterExtras.js
// The extra detail fields of Product Group, Product Company and Salesman /
// Agent (migration 140), cleaned the same way on create and on edit - only
// the fields present in the body are returned, so an edit that leaves them
// out changes nothing.
// =============================================
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const txt = max => v => (v === undefined ? undefined : (String(v || '').trim().slice(0, max) || null));
const num = v => (v === undefined ? undefined : (Number(v) || 0));
const id = v => (v === undefined ? undefined : (UUID.test(v || '') ? v : null));
const bool = v => (v === undefined ? undefined : !!v);

const FIELDS = {
    product_group: {
        short_name: txt(30), breakup_quantity: bool,
        qty_decimal_places: v => (v === undefined ? undefined : Math.min(6, Math.max(0, parseInt(v, 10) || 0)))
    },
    product_company: {
        short_name: txt(30), street: txt(200), phone_office: txt(40), phone_residence: txt(40), mobile: txt(40), fax: txt(40),
        email: txt(150), contact_person: txt(150), currency: txt(10), discount_percentage: num
    },
    agent: {
        short_name: txt(30), parent_agent_id: id, product_company_id: id, sub_ledger_id: id, credit_limit: num,
        credit_control: v => (v === undefined ? undefined : (['system', 'none', 'warn', 'block'].includes(v) ? v : 'system')),
        street: txt(200), phone_office: txt(40), phone_residence: txt(40), mobile: txt(40), fax: txt(40)
    }
};

/** the extra fields of a master found in the body, cleaned */
function extras(master, body) {
    const out = {};
    Object.entries(FIELDS[master] || {}).forEach(([k, clean]) => {
        if (!body || !(k in body)) return;
        const v = clean(body[k]);
        if (v !== undefined) out[k] = v;
    });
    return out;
}

module.exports = { extras, FIELDS };
