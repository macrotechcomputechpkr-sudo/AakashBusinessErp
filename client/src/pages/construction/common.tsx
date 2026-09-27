// =============================================
// construction/common.tsx
// Types of what server/utils/construction.js sends, and small pickers shared
// by the construction screens (NAV window frame etc. come from poultry/common).
// =============================================
import React from 'react';
import { SearchablePopupSelect } from '../../components/poultry/common';
import type { Ledger } from '../../components/poultry/common';

export interface SiteSummary {
    contract: { amount: number; billed_gross: number; billed_pct: number | null; balance_to_bill: number; vat: number; retention_held: number; tds_deducted: number; advance_recovered: number; advance_left: number; net_receivable: number; ra_bills: number };
    revenue: { billed: number; other_income: number; total: number };
    cost: { material: number; wages: number; subcontract: number; other: number; total: number };
    profit: number; margin_pct: number | null;
    budget: { material: number; labour: number; subcontract: number; other: number; total: number }; budget_used_pct: number | null;
    subcontracts: { count: number; given: number; billed: number; retention_held: number; tds: number };
    drafts: { ra: number; wages: number; sub_bills: number };
}
export interface Site {
    id: string; site_code: string; site_name: string; contract_type: 'main' | 'sub'; client_ledger_id: string | null; client_name?: string; employer_name: string | null;
    contract_no: string | null; contract_date: string | null; start_date: string | null; end_date: string | null; contract_amount: number; vat_percent: number; retention_percent: number; tds_percent: number;
    advance_amount: number; advance_recovery_percent: number; budget_material: number; budget_labour: number; budget_subcontract: number; budget_other: number;
    location: string | null; site_engineer: string | null; warehouse_id: string | null; cost_center_id: string | null; status: string; remarks: string | null; summary: SiteSummary;
}
export interface Boq { id?: string; item_no: string | null; description: string; unit: string | null; qty: number | string; rate: number | string; amount?: number; billed_qty?: number; billed_amount?: number; balance_qty?: number; progress_pct?: number }
export interface RaBill {
    id: string; doc_no: string; ra_no: number; doc_date: string; period_from: string | null; period_to: string | null; gross_amount: number; vat_amount: number; retention_amount: number; tds_amount: number;
    advance_recovery: number; other_deduction: number; net_amount: number; status: string; narration: string | null;
}
export interface Issue { id: string; issue_date: string; direction: 'out' | 'in'; total_amount: number; adjustment_no: string | null; adjustment_status: string | null; bill_no: string | null; remarks: string | null; lines: { id: string; product_name: string; qty: number; rate: number; amount: number }[] }
export interface WageSheet { id: string; doc_no: string; doc_date: string; period_from: string | null; period_to: string | null; total_amount: number; status: string; pay_ledger_name: string }
export interface SubBill { id: string; doc_no: string; party_bill_no: string | null; doc_date: string; gross_amount: number; vat_amount: number; retention_amount: number; tds_amount: number; advance_recovery: number; other_deduction: number; net_amount: number; status: string }
export interface Subcontract {
    id: string; subcontractor_ledger_id: string; subcontractor_name: string; work_description: string; contract_amount: number; vat_percent: number; retention_percent: number; tds_percent: number;
    start_date: string | null; end_date: string | null; status: string; bills: SubBill[]; billed: number; balance: number; retention_held: number; tds: number; progress_pct: number | null;
}
export interface SiteDetail extends Site {
    boq: Boq[]; ra_bills: RaBill[]; wage_sheets: WageSheet[]; subcontracts: Subcontract[]; material_issues: Issue[];
    material_by_item: { product_id: string; product_name: string; qty_out: number; qty_in: number; net_qty: number; amount: number }[];
    other_lines: { date: string; doc_label: string; doc_no: string; ledger_name: string; narration: string; kind: string; amount: number }[];
}

export const STATUS_LABEL: Record<string, string> = { active: 'Running', on_hold: 'On hold', completed: 'Completed', closed: 'Closed', draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled' };

export function LedgerPick({ listKey, ledgers, value, onChange, placeholder = 'Select ledger' }: { listKey: string; ledgers: Ledger[]; value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <SearchablePopupSelect listKey={listKey} columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
            items={ledgers} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name', 'account_code']} value={value} onChange={onChange} placeholder={placeholder} />
    );
}
