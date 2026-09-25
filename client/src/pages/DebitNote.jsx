import React from 'react';
import PartyLedgerNoteForm from '../components/PartyLedgerNoteForm';

const REASON_OPTIONS = [
    { value: 'rate_correction', label: 'Rate Correction' },
    { value: 'early_payment_rebate', label: 'Early Payment Rebate' },
    { value: 'quality_claim', label: 'Quality Claim' },
    { value: 'tds_adjustment', label: 'TDS Adjustment' },
    { value: 'other', label: 'Other' }
];

export default function DebitNote() {
    return (
        <PartyLedgerNoteForm
            title="Debit Note"
            icon="📤"
            apiBase="debit-notes"
            voucherType="debit_note"
            partyLabel="Vendor"
            reasonOptions={REASON_OPTIONS}
            outstandingNature="cr"
        />
    );
}
