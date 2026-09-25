import React from 'react';
import PartyLedgerNoteForm from '../components/PartyLedgerNoteForm';

const REASON_OPTIONS = [
    { value: 'rate_correction', label: 'Rate Correction' },
    { value: 'discount_given', label: 'Discount Given' },
    { value: 'quality_claim', label: 'Quality Claim' },
    { value: 'goodwill', label: 'Goodwill' },
    { value: 'other', label: 'Other' }
];

export default function CreditNote() {
    return (
        <PartyLedgerNoteForm
            title="Credit Note"
            icon="📥"
            apiBase="credit-notes"
            voucherType="credit_note"
            partyLabel="Customer"
            reasonOptions={REASON_OPTIONS}
            outstandingNature="dr"
        />
    );
}
