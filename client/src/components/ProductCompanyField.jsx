// =============================================
// ProductCompanyField.jsx
// Header "Product Company" for customer / vendor transactions.
//   * Compulsory when System Control says so for that side
//     (product_company_compulsory_sales / _purchase) - the server enforces
//     the same rule (utils/productCompanyRules.js).
//   * Changing it drops lines whose product belongs to another company,
//     after asking - one transaction holds one company's products only.
// Pair with filterProductsByCompany() for the line product picker.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from './SearchablePopupSelect';

export function filterProductsByCompany(products, companyId) {
    return companyId ? (products || []).filter(p => p.product_company_id === companyId) : (products || []);
}

export default function ProductCompanyField({ side, form, setForm, products, emptyRow, listKey }) {
    const { authFetch } = useAuth();
    const [companies, setCompanies] = useState([]);
    const [compulsory, setCompulsory] = useState(false);

    useEffect(() => {
        let alive = true;
        Promise.all([authFetch('/api/product-companies'), authFetch('/api/system-control')])
            .then(([c, sc]) => {
                if (!alive) return;
                setCompanies((c.data || []).filter(x => x.is_active !== false));
                setCompulsory(!!sc.data?.[side === 'sales' ? 'product_company_compulsory_sales' : 'product_company_compulsory_purchase']);
            })
            .catch(() => {});
        return () => { alive = false; };
    }, [authFetch, side]);

    const onChange = (companyId) => {
        const companyOf = id => (products || []).find(p => p.id === id)?.product_company_id;
        const mismatched = companyId ? (form.details || []).filter(d => d.product_id && companyOf(d.product_id) !== companyId) : [];
        if (mismatched.length && !window.confirm(`${mismatched.length} line(s) have products of another company and will be removed. Continue?`)) return;
        setForm(f => {
            const kept = companyId ? (f.details || []).filter(d => !d.product_id || companyOf(d.product_id) === companyId) : (f.details || []);
            return { ...f, product_company_id: companyId || '', details: kept.length ? kept : (emptyRow ? [emptyRow()] : []) };
        });
    };

    if (!compulsory && companies.length === 0) return null;
    return (
        <div className="erp-field">
            <label className="erp-label">Product Company {compulsory && <span className="req">*</span>}</label>
            <SearchablePopupSelect
                listKey={listKey || `${side}_product_company_picker`}
                columns={[{ key: 'company_code', label: 'Code' }, { key: 'company_name', label: 'Name' }]}
                defaultVisibleKeys={['company_name']}
                items={companies} getId={c => c.id} getLabel={c => c.company_name}
                searchKeys={['company_name', 'company_code']}
                value={form.product_company_id || ''} onChange={onChange}
                placeholder={compulsory ? 'Select Product Company' : 'All companies'}
            />
        </div>
    );
}
