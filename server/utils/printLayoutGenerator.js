// =============================================
// utils/printLayoutGenerator.js
// "every module ko 5-6 ota templates timle nai banaideu" - rather than
// hand-positioning every field of every variation, this computes a
// sensible auto-layout from a short "recipe" (which field keys go in
// which band, plus paper size), so many template variations can be
// generated from the same field catalog quickly and consistently.
// =============================================

const HEADER_ROW_HEIGHT = 6;
const HEADER_COL_WIDTH = 90;
const FOOTER_ROW_HEIGHT = 6;
const DETAIL_ROW_HEIGHT = 7;

// Per-field-key hint for how wide that column should be in the detail
// (line-item) band, and a fallback for anything not listed.
const DETAIL_FIELD_WIDTH_HINTS = {
    product_name_snapshot: 45, product_code_snapshot: 20,
    qty: 15, uom_name_snapshot: 12, alt_qty: 15, alt_unit_name: 12,
    rate: 15, rate_basis: 12, discount_percent: 12, discount_amount: 15,
    free_qty: 12, free_alt_qty: 12, tax_percent: 10, amount: 18, batch_no: 15
};

function makeBlock(fieldKey, label, x, y, width, height, extra = {}) {
    return { id: `gen_${fieldKey}_${x}_${y}`, type: 'field', field_key: fieldKey, label, x, y, width, height, font_size: 9, bold: false, italic: false, align: 'left', ...extra };
}

// header: array of field keys, laid out two-per-row in a simple grid.
function generateHeaderLayout(fields, catalogByKey) {
    const blocks = [];
    fields.forEach((key, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const label = catalogByKey[key]?.label || key;
        blocks.push(makeBlock(key, label, 5 + col * HEADER_COL_WIDTH, 5 + row * HEADER_ROW_HEIGHT, HEADER_COL_WIDTH - 5, HEADER_ROW_HEIGHT, { bold: key === 'doc_no' || key.includes('company_name') }));
    });
    return blocks;
}

// detail: array of field keys, laid out left-to-right as table columns
// on a single row (the band repeats once per line item at print time).
function generateDetailLayout(fields, catalogByKey) {
    const blocks = [];
    let x = 2;
    fields.forEach(key => {
        const width = DETAIL_FIELD_WIDTH_HINTS[key] || 18;
        const isNumeric = ['qty', 'alt_qty', 'rate', 'discount_percent', 'discount_amount', 'free_qty', 'free_alt_qty', 'tax_percent', 'amount'].includes(key);
        blocks.push(makeBlock(key, catalogByKey[key]?.label || key, x, 1, width, DETAIL_ROW_HEIGHT, { align: isNumeric ? 'right' : 'left', font_size: 8 }));
        x += width;
    });
    return blocks;
}

// footer: totals stacked bottom-right; a term summary table (if
// requested) placed full-width above them.
function generateFooterLayout(fields, catalogByKey, pageWidthMm) {
    const blocks = [];
    let y = 5;
    const summaryField = fields.find(f => f === 'product_term_summary');
    const stackedFields = fields.filter(f => f !== 'product_term_summary' && f !== 'amount_in_words' && f !== 'terms_conditions');
    const wideFields = fields.filter(f => f === 'amount_in_words' || f === 'terms_conditions');

    if (summaryField) {
        blocks.push({ ...makeBlock('product_term_summary', 'Product Term Summary', 5, y, pageWidthMm - 10, 30), type: 'field' });
        y += 34;
    }
    wideFields.forEach(key => {
        blocks.push(makeBlock(key, catalogByKey[key]?.label || key, 5, y, pageWidthMm - 10, FOOTER_ROW_HEIGHT));
        y += FOOTER_ROW_HEIGHT + 2;
    });
    stackedFields.forEach(key => {
        const isTotal = key.includes('total') || key === 'grand_total';
        blocks.push(makeBlock(key, catalogByKey[key]?.label || key, pageWidthMm - 70, y, 65, FOOTER_ROW_HEIGHT, { align: 'right', bold: key === 'grand_total', font_size: isTotal ? 10 : 9 }));
        y += FOOTER_ROW_HEIGHT + 1;
    });
    return blocks;
}

function flattenCatalog(catalog) {
    const byKey = {};
    ['header', 'detail', 'footer'].forEach(band => (catalog[band] || []).forEach(f => { byKey[f.key] = f; }));
    return byKey;
}

// recipe: { template_name, description, paper_size, orientation, header: [...keys], detail: [...keys], footer: [...keys] }
function generateTemplateLayout(recipe, catalog) {
    const catalogByKey = flattenCatalog(catalog);
    const pageWidthMm = recipe.paper_size === 'A5' ? 148 : 210;
    return {
        header: generateHeaderLayout(recipe.header, catalogByKey),
        detail: generateDetailLayout(recipe.detail, catalogByKey),
        footer: generateFooterLayout(recipe.footer, catalogByKey, recipe.orientation === 'landscape' ? (recipe.paper_size === 'A5' ? 210 : 297) : pageWidthMm)
    };
}

module.exports = { generateTemplateLayout, flattenCatalog };
