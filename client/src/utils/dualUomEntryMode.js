// =============================================
// utils/dualUomEntryMode.js
// "Fixed Alt System" vs "Flexible Alt System" (per the reference
// spreadsheet/HTML) - the underlying total is ALWAYS additive
// (qty*factor + alt_qty, unchanged everywhere in the backend) in BOTH
// systems; what differs is purely the ENTRY UX for the Secondary
// field, driven by system_control's dual_uom_mode ('fixed' |
// 'auto_convert') plus a reverse-conversion toggle:
//
// 'fixed' (Fixed Alt System) - both fields are independent, typed
//                   manually. Secondary must stay a proper remainder,
//                   strictly LESS than the conversion factor (5 Crt +
//                   3 Pcs is fine when 1 Crt = 5 Pcs; 5 Crt + 5 Pcs is
//                   not, since that 5th Pcs should have rolled into a
//                   6th Crt) - validateFixedSecondary() enforces this,
//                   clamping and flagging an error rather than saving
//                   an invalid remainder.
// 'auto_convert' (Flexible Alt System) - no such remainder constraint;
//                   Secondary can hold its OWN full value, which
//                   genuinely adds on top of Primary's converted
//                   amount (this is intentional, not a bug: typing
//                   Primary auto-suggests Secondary as its full
//                   equivalent, which the person is then free to
//                   adjust further either up or down):
//                     typing Primary   - ALWAYS auto-fills Secondary
//                                        as qty * factor (a starting
//                                        suggestion, still editable
//                                        afterward).
//                     typing Secondary - reverse ON: decomposes back
//                                        into Primary + a genuine
//                                        remainder (floor/mod), so the
//                                        combined total exactly matches
//                                        whatever was typed there.
//                                        reverse OFF: Secondary simply
//                                        keeps whatever was typed,
//                                        Primary is left untouched.
//                   Both fields are always saved as entered - there is
//                   no separate "total" column to persist; the total
//                   is derived (qty*factor + alt_qty) wherever needed,
//                   exactly the same formula as 'fixed' mode.
//
// A conversion_factor of 0 or missing degrades safely (nothing to
// convert against - values pass through unchanged).
// =============================================

export function resolveDualUomEntryMode(systemControl) {
    const mode = systemControl?.dual_uom_mode === 'auto_convert' ? 'auto_convert' : 'fixed';
    const reverseEnabled = !!systemControl?.dual_uom_reverse_conversion;
    return { mode, reverseEnabled };
}

// Called when the PRIMARY (qty) field changes in auto_convert mode -
// ALWAYS auto-fills Secondary as the full equivalent (a starting
// suggestion the person can still adjust), regardless of the reverse
// toggle.
export function onPrimaryQtyChange(value, conversionFactor) {
    const alt_qty = conversionFactor ? (Number(value) || 0) * conversionFactor : 0;
    return { qty: value, alt_qty };
}

// Called when the SECONDARY (alt_qty) field changes in auto_convert
// mode:
// - reverse ON: decompose the typed value into Primary + a genuine
//   remainder (floor/mod), so the combined total exactly matches what
//   was typed here.
// - reverse OFF: Secondary just keeps the typed value; Primary is left
//   untouched (the two fields are allowed to represent independent,
//   additive amounts, same as Fixed mode allows).
// Flexible (auto_convert): the Secondary field always holds the TOTAL in the
// secondary unit. With reverse ON, typing 27 PCS (factor 5) shows 5 CRT and
// KEEPS 27 in the secondary - it used to leave only the remainder (2), which
// meant Secondary was "total" after typing Primary but "remainder" after
// typing Secondary, so no single formula could read the line correctly.
export function onSecondaryQtyChange(value, conversionFactor, reverseEnabled) {
    if (!reverseEnabled || !conversionFactor) return { alt_qty: value };
    const numericValue = Number(value) || 0;
    return { qty: Math.floor(numericValue / conversionFactor), alt_qty: value };
}

// Total quantity in the secondary (base) unit for one dual-UOM line.
// Fixed: Primary + Secondary are additive (5 CRT + 3 PCS, secondary < factor).
// Flexible: Secondary is the total when entered, else Primary x factor.
// Must match server/utils/dualUomCalculation.js toBaseQtyFromDual().
export function dualBaseQty(qty, altQty, conversionFactor, mode = 'fixed') {
    const factor = Number(conversionFactor) || 1;
    if (mode === 'auto_convert') {
        const hasAlt = altQty !== null && altQty !== undefined && altQty !== '' && Number(altQty) !== 0;
        return hasAlt ? Number(altQty) : (Number(qty) || 0) * factor;
    }
    return (Number(qty) || 0) * factor + (Number(altQty) || 0);
}

// 'fixed' mode only: Secondary must stay a proper remainder, strictly
// less than the conversion factor (a full set of `conversionFactor`
// pieces should have rolled into one more Primary unit instead).
// Returns the value to actually store (clamped to conversionFactor - 1
// when it was too high) plus an error message to show, or null when
// the typed value was already valid.
export function validateFixedSecondary(value, conversionFactor) {
    const numericValue = Number(value) || 0;
    if (!conversionFactor || numericValue < conversionFactor) return { value, error: null };
    return {
        value: conversionFactor - 1,
        error: `Max is ${conversionFactor - 1} - a full set of ${conversionFactor} should be entered as one more of the primary unit instead.`
    };
}
