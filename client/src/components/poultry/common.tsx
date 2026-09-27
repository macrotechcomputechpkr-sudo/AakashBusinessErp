// =============================================
// components/poultry/common.tsx
// Shared bits of the Poultry & Hatchery screens: types of what
// server/utils/poultry.js and hatchery.js send, number formats, the
// NAV-style window frame and small lookups (products, units, warehouses).
// =============================================
import React, { useEffect, useState } from 'react';
import type { AuthFetch } from '../../types/erp';
import SearchablePopupSelectJs from '../SearchablePopupSelect';

interface PickProps<T> {
    listKey: string; columns: { key: string; label: string }[]; defaultVisibleKeys: string[]; items: T[]; getId: (x: T) => string; getLabel: (x: T) => string;
    searchKeys: string[]; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}
/** typed face of the (JS) searchable popup picker */
export const SearchablePopupSelect = SearchablePopupSelectJs as unknown as <T>(p: PickProps<T>) => React.ReactElement;

export interface Birds { placed: number; dead: number; culls: number; lifted: number; alive: number }
export interface KpiData {
    age_days: number; livability_pct: number; mortality_pct: number; feed_kg: number; feed_per_bird_kg: number; lifted_kg: number; live_kg_in_shed: number;
    produced_kg: number; avg_weight_kg: number; last_sample_weight_kg: number | null; fcr: number | null; epef: number | null; cost_per_kg: number | null; cost_per_bird: number | null;
}
export interface Costs { chicks: number; feed: number; medicine: number; vaccine: number; litter: number; other_items: number; direct_expenses: number; shed_share: number; total: number }
export interface Revenue { sales: number; unbilled_liftings: number; other_income: number; total: number }
export interface Cycle { cycle_days: number; lift_due_date: string; days_to_lift: number | null; lift_due: boolean }
export interface BirdAccount { chicks_in: number; dead: number; culls: number; sold_pcs: number; sold_kg: number; in_shed: number; avg_kg_per_bird: number | null; sale_rate_per_kg: number | null; cost_per_kg_sold: number | null; mortality_pcs: number; mortality_loss: number; feed_per_kg_sold: number | null }
export interface Summary { birds: Birds; kpi: KpiData; costs: Costs; revenue: Revenue; profit: number; profit_per_kg: number | null; profit_per_bird: number | null; stage: string; cycle?: Cycle; account?: BirdAccount }
export interface Batch extends Partial<Summary> {
    id: string; batch_no: string; shed_id: string; shed_name?: string; shed_code?: string; breed: string | null; chick_source: string | null; placement_date: string;
    chicks_placed: number; free_chicks: number; chick_product_id: string | null; target_weight_kg: number | null; expected_close_date: string | null; remarks: string | null;
    status: 'active' | 'closed'; closed_on: string | null; close_notes: string | null; placement_adjustment_no?: string | null;
}
/** a batch as the reports flatten it (birds / kpi spread on the row) */
export type FlatBatch = Birds & KpiData & { id: string; batch_no: string; shed_name: string; breed: string | null; placement_date: string; status: string; closed_on: string | null; stage: string; costs: Costs; revenue: Revenue; profit: number; profit_per_kg: number | null; profit_per_bird: number | null };
export interface Shed { id: string; shed_code: string; shed_name: string; shed_type: 'broiler' | 'hatchery'; farm_name?: string | null; location?: string | null; capacity: number | null; area_sqft?: number | null; warehouse_id?: string | null; supervisor?: string | null; is_active: boolean; active_batch?: { id: string; batch_no: string } | null }
export interface PItem { product_id: string; role: string; kg_per_unit: number | null; product_name?: string; product_code?: string }
export interface Product { id: string; product_name: string; product_code?: string; base_unit_id: string; product_unit_rates?: { unit_id: string; conversion_factor: number; is_base_unit?: boolean }[] }
export interface Unit { id: string; unit_name: string }
export interface Warehouse { id: string; warehouse_name: string }
export interface Ledger { id: string; account_name: string; account_code?: string }

export const n0 = (v: number | null | undefined): string => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const n2 = (v: number | null | undefined): string => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const n3 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`);
export const today = (): string => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const errText = (e: unknown): string => (e as Error)?.message || String(e);

export const ROLE_LABEL: Record<string, string> = {
    chick: 'Day-old chick', feed: 'Feed', medicine: 'Medicine', vaccine: 'Vaccine', litter: 'Litter / bedding', other: 'Other consumable',
    live_bird: 'Live bird (lifting)', hatching_egg: 'Hatching egg', table_egg: 'Table egg', cull_bird: 'Cull bird'
};

/** NAV window: blue title bar + optional toolbar, then the body */
export function NavWindow({ title, tools, children, wide }: { title: React.ReactNode; tools?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
    return (
        <div className="erp-shell">
            <div className="erp-card" style={wide ? { maxWidth: 1400 } : undefined}>
                <div className="erp-header"><span className="erp-header-title">{title}</span></div>
                {tools && <div className="nav-toolbar">{tools}</div>}
                <div className="nav-content">{children}</div>
            </div>
        </div>
    );
}

export function GroupBox({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
    return <div className={`nav-groupbox ${className}`}><span className="nav-groupbox-title">{title}</span>{children}</div>;
}

export function Msg({ ok, err, warn }: { ok?: string; err?: string; warn?: string[] }) {
    return (
        <>
            {err && <div className="nav-msg err">{err}</div>}
            {ok && <div className="nav-msg ok">{ok}</div>}
            {warn && warn.length > 0 && <div className="nav-msg warn">{warn.join(' · ')}</div>}
        </>
    );
}

export function Kpi({ label, value, sub, tone = '' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: '' | 'green' | 'red' | 'orange' }) {
    return <div className={`kpi-card ${tone}`}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{sub !== undefined && <div className="kpi-sub">{sub}</div>}</div>;
}

/** products, units, warehouses - loaded once per screen */
export function useLookups(authFetch: AuthFetch, want: { ledgers?: boolean } = {}) {
    const [products, setProducts] = useState<Product[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [ledgers, setLedgers] = useState<Ledger[]>([]);
    const wantLedgers = !!want.ledgers;
    useEffect(() => {
        authFetch<Product[]>('/api/products').then(r => setProducts(r.data || [])).catch(() => undefined);
        authFetch<Unit[]>('/api/product-units').then(r => setUnits(r.data || [])).catch(() => undefined);
        authFetch<Warehouse[]>('/api/warehouses').then(r => setWarehouses(r.data || [])).catch(() => undefined);
        if (wantLedgers) authFetch<Ledger[]>('/api/ledger-accounts?pageSize=2000&sortBy=account_name&sortDir=asc').then(r => setLedgers(r.data || [])).catch(() => undefined);
    }, [authFetch, wantLedgers]);
    const unitName = (id: string | null | undefined) => units.find(u => u.id === id)?.unit_name || '';
    const unitsOf = (productId: string): Unit[] => {
        const p = products.find(x => x.id === productId);
        if (!p) return [];
        const ids = [p.base_unit_id, ...(p.product_unit_rates || []).map(r => r.unit_id)];
        return ids.filter((id, i) => id && ids.indexOf(id) === i).map(id => ({ id, unit_name: unitName(id) || 'Unit' }));
    };
    return { products, units, warehouses, ledgers, unitName, unitsOf };
}
