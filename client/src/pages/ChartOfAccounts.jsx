// =============================================
// ChartOfAccounts.jsx
// FIXES applied vs. the pasted static demo:
//  - The demo's ledger-account save() never set `category_type` at all,
//    even though listing/filtering/badges all read it - accounts always
//    showed as "others". Category Type is now a real, required field.
//  - Category Type is placed BEFORE Account Group and drives which
//    groups are selectable (and auto-selects when there's exactly one
//    match or a group flagged is_default for that category) - the
//    "category choose garda group auto-select" behaviour.
//  - VAT/PAN Number+Type, Address, Area, Route, Sales Person are only
//    shown for party ledgers (category = sales/purchase/both). A plain
//    Cash or Bank ledger no longer asks for any of that.
//  - Area / Route / Sales Person are now real backend-backed pickers
//    (server/routes/partyMasterRoutes.js) instead of a hardcoded static
//    <select> list.
//  - Connected to the real backend the whole way through (the pasted
//    demo was in-memory only, same class of issue as the earlier static
//    User Management page).
// =============================================

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import SearchablePopupSelect from '../components/SearchablePopupSelect';

const CATEGORY_OPTIONS = [
    { value: 'sales', label: 'Sales (Customer)' },
    { value: 'purchase', label: 'Purchase (Supplier)' },
    { value: 'both', label: 'Both (Customer & Supplier)' },
    { value: 'cash', label: 'Cash' },
    { value: 'bank', label: 'Bank' },
    { value: 'others', label: 'Others (General Ledger)' }
];

function categoryMatches(groupCategory, requested) {
    if (!requested) return true;
    if (groupCategory === requested) return true;
    if (groupCategory === 'both' && ['sales', 'purchase', 'cash', 'bank'].includes(requested)) return true;
    return false;
}
const isPartyCategory = (c) => ['sales', 'purchase', 'both'].includes(c);

// FEATURE: Short Name (Alias) preview helper - mirrors the backend's
// exact initials algorithm (server/routes/chartOfAccountsRoutes.js) so
// the placeholder shown here always matches what would actually be
// generated. The 5-digit sequential number itself is never faked
// client-side (same reason Account Code isn't) - it comes from a real
// atomic sequence on save.
function nameInitials(name) {
    if (!name || !name.trim()) return 'LDG';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'LDG';
}

const LEDGER_TYPE_OPTIONS = [
    { value: 'general', label: 'General' },
    { value: 'vat', label: 'VAT' },
    { value: 'tds', label: 'TDS' },
    { value: 'commission', label: 'Commission' },
    { value: 'service_purchase_capital', label: 'Service Purchase Capital' },
    { value: 'service_purchase_other', label: 'Service Purchase Other' },
    { value: 'goods_purchase_capital', label: 'Goods Purchase Capital' },
    { value: 'goods_purchase_other', label: 'Goods Purchase Other' },
    { value: 'service_sales', label: 'Service Sales' },
    { value: 'goods_sales', label: 'Goods Sales' }
];

const emptyAccountForm = {
    account_name: '', short_name: '', tags: [], category_type: '', account_group_id: '',
    pan_number: '', vat_pan_type: 'Non Registered', billing_name: '',
    area_id: '', route_id: '', agent_id: '',
    street: '', city: '', state: '', zip_code: '', country: 'Nepal',
    shipping_address: '',
    contact_person: '', contact_person_mobile: '',
    opening_balance: 0, opening_balance_type: 'dr', currency: 'NPR',
    credit_limit: 0, credit_days: 0, interest_rate: 0, rate_category_id: '', discount_group_id: '',
    bank_name: '', bank_account_number: '', swift_code: '',
    email: '', contact_person_phone: '', is_active: true,
    // Ledger Category - separate, OPTIONAL, tenant-custom classification
    // (nothing to do with category_type above).
    ledger_category_ids: [],
    // Ledger Type - only offered for category_type = 'others'
    ledger_type: 'general',
    // Other Information (party ledgers)
    tin_number: '', excise_registration_no: '', cst_no: '', dl_no: '', business_category: '',
    voucher_adjustment_basis: '', schedule_reference: '', is_locked: false,
    excise_duty_rate: 0, excise_exemption_certificate: '',
    // Sub Ledger settings (party ledgers) - tri-state mode + allow-all toggle
    sub_ledger_mode: 'disable', allow_all_sub_ledger: true,
    credit_limit_control: 'system_default', credit_days_control: 'system_default', bill_wise_tracking_control: 'system_default',
    // LC / BG (party ledgers)
    lc_number: '', lc_bank_name: '', lc_amount: '', lc_issue_date: '', lc_expiry_date: '',
    bg_number: '', bg_bank_name: '', bg_amount: '', bg_issue_date: '', bg_expiry_date: '',
    // Personal details (party ledgers)
    customer_date_of_birth: '', customer_anniversary_date: '', customer_religion: ''
};

const emptyGroupForm = {
    group_name: '', nfrs_category: '', nfrs_classification: '', category_type: '', cash_flow_category: '',
    funds_flow_type: '', ratio_analysis_category: '', balance_sheet_side: '', profit_loss_type: '',
    is_balance_sheet: false, is_profit_loss: false,
    parent_group_id: '', display_order: 1, description: ''
};

export default function ChartOfAccounts() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState('accounts');
    const [alert, setAlert] = useState(null);
    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const [groups, setGroups] = useState([]);
    const [areas, setAreas] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [agents, setAgents] = useState([]);
    const [rateCategories, setRateCategories] = useState([]);
    const [discountGroups, setDiscountGroups] = useState([]);
    const [ledgerCategories, setLedgerCategories] = useState([]);
    const [ledgerCategoryEnabled, setLedgerCategoryEnabled] = useState(false);
    const [currentFyPrefix, setCurrentFyPrefix] = useState('');
    const [ledgerCategoryLabel, setLedgerCategoryLabel] = useState('Ledger Category');
    const [labelDraft, setLabelDraft] = useState('Ledger Category');
    const [newCategoryName, setNewCategoryName] = useState('');
    const [renamingCategory, setRenamingCategory] = useState(null);

    const [rows, setRows] = useState([]);

    const [showAccountForm, setShowAccountForm] = useState(false);
    const [accountForm, setAccountForm] = useState(emptyAccountForm);
    const [editingAccountId, setEditingAccountId] = useState(null);
    const [ledgerFormTab, setLedgerFormTab] = useState('basic');
    const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true);
    const accountFormRef = useRef(null);

    const [showGroupForm, setShowGroupForm] = useState(false);
    const [groupForm, setGroupForm] = useState(emptyGroupForm);
    const groupFormRef = useRef(null);
    // Account Groups tree view + edit support.
    const [editingGroupId, setEditingGroupId] = useState(null);
    const [groupView, setGroupView] = useState('tree');
    const [expandedGroups, setExpandedGroups] = useState({});
    const [groupSearch, setGroupSearch] = useState('');
    useEnterKeyNavigation(groupFormRef);

    const [modal, setModal] = useState(null); // 'area' | 'route' | 'agent'
    const masterModalFormRef = useRef(null);
    useEnterKeyNavigation(masterModalFormRef);
    const [modalForm, setModalForm] = useState({ name: '', parent_area_id: '', area_id: '', allow_rate_change_on_mobile_order: false });

    const loadMasters = useCallback(async () => {
        try {
            const [g, a, r, s, setting, fy] = await Promise.all([
                authFetch('/api/account-groups'),
                authFetch('/api/areas'),
                authFetch('/api/routes'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/company/ledger-category-setting'),
                authFetch('/api/fiscal-years')
            ]);
            setGroups(g.data || []);
            setAreas(a.data || []);
            setRoutes(r.data || []);
            setAgents(s.data || []);
            setLedgerCategoryEnabled(!!setting.data?.enabled);
            setLedgerCategoryLabel(setting.data?.label || 'Ledger Category');
            setLabelDraft(setting.data?.label || 'Ledger Category');
            const currentFy = (fy.data || []).find(f => f.is_current);
            setCurrentFyPrefix(currentFy ? currentFy.fiscal_year_name.replace(/[^0-9]/g, '') : '');
            const [rc, dg] = await Promise.all([authFetch('/api/rate-categories'), authFetch('/api/discount-groups')]);
            setRateCategories(rc.data || []);
            setDiscountGroups(dg.data || []);
            if (setting.data?.enabled) {
                const cats = await authFetch('/api/ledger-categories');
                setLedgerCategories(cats.data || []);
            }
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);

    // FIX: ReportGrid does its own client-side search/sort/filter/group, so
    // this now fetches the full ledger list once (large pageSize) instead
    // of paging server-side - fine for master-data volumes.
    const loadAccounts = useCallback(async () => {
        try {
            const res = await authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc');
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);

    useEffect(() => { loadMasters(); }, [loadMasters]);
    useEffect(() => { loadAccounts(); }, [loadAccounts]);

    // FEATURE: summary bar totals - Dr/Cr opening balances across ALL
    // currently loaded ledgers, not just the ones visible after ReportGrid's
    // own search/filter (those are for browsing, this is a true total).
    const ledgerSummary = useMemo(() => {
        let totalDebit = 0, totalCredit = 0;
        rows.forEach(r => {
            const amt = Number(r.opening_balance) || 0;
            if ((r.opening_balance_type || 'dr') === 'dr') totalDebit += amt;
            else totalCredit += amt;
        });
        return { totalDebit, totalCredit, balance: totalDebit - totalCredit };
    }, [rows]);

    // FIX: this is the "choose category -> group filters/auto-selects" logic.
    const filteredGroups = useMemo(
        () => groups.filter(g => categoryMatches(g.category_type, accountForm.category_type)),
        [groups, accountForm.category_type]
    );

    useEffect(() => {
        if (!accountForm.category_type) return;
        const stillValid = filteredGroups.some(g => g.id === accountForm.account_group_id);
        if (stillValid) return;

        if (filteredGroups.length === 1) {
            setAccountForm(f => ({ ...f, account_group_id: filteredGroups[0].id }));
        } else if (filteredGroups.length > 1) {
            // FIX: "Others" is a broad catch-all category with several
            // equally-valid default groups (Tax Payable, Share Capital,
            // Other Income, Salary, Interest Expense) - auto-picking
            // whichever one happened to come first would be an arbitrary,
            // potentially misleading guess. Only auto-select when there is
            // exactly ONE is_default candidate for the chosen category;
            // otherwise leave it for manual selection (still fully
            // changeable either way via the picker below).
            const defaults = filteredGroups.filter(g => g.is_default);
            const preferred = defaults.length === 1 ? defaults[0] : null;
            setAccountForm(f => ({ ...f, account_group_id: preferred ? preferred.id : '' }));
        } else {
            setAccountForm(f => ({ ...f, account_group_id: '' }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountForm.category_type, filteredGroups]);

    const resetAccountForm = () => { setAccountForm(emptyAccountForm); setEditingAccountId(null); setLedgerFormTab('basic'); setShippingSameAsBilling(true); };

    const handleAccountSubmit = async (e) => {
        e.preventDefault();
        if (!accountForm.account_name.trim()) return showAlert('Account name is required', 'danger');
        if (!accountForm.category_type) return showAlert('Category type is required', 'danger');
        if (!accountForm.account_group_id) return showAlert('Account group is required', 'danger');

        try {
            if (editingAccountId) {
                await authFetch(`/api/ledger-accounts/${editingAccountId}`, { method: 'PUT', body: JSON.stringify(accountForm) });
                showAlert('Ledger account updated', 'success');
            } else {
                await authFetch('/api/ledger-accounts', { method: 'POST', body: JSON.stringify(accountForm) });
                showAlert('Ledger account created', 'success');
            }
            resetAccountForm();
            setShowAccountForm(false);
            loadAccounts();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEditAccount = (row) => {
        setEditingAccountId(row.id);
        setAccountForm({ ...emptyAccountForm, ...row });
        setLedgerFormTab('basic');
        setShippingSameAsBilling(!row.shipping_address);
        setShowAccountForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteAccount = async (row) => {
        if (!window.confirm(`Deactivate "${row.account_name}"?`)) return;
        try {
            await authFetch(`/api/ledger-accounts/${row.id}`, { method: 'DELETE' });
            showAlert('Ledger account deactivated', 'warning');
            loadAccounts();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: "Remove" - genuinely permanent, distinct from Deactivate,
    // blocked with a clear message if any document already uses this
    // ledger (the backend checks every transaction table it knows about).
    const handleRemoveAccount = async (row) => {
        if (!window.confirm(`Permanently delete "${row.account_name}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/ledger-accounts/${row.id}/permanent`, { method: 'DELETE' });
            showAlert('Ledger account permanently deleted', 'warning');
            loadAccounts();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FIX: the group form previously never captured nfrs_classification or
    // funds_flow_type at all - meaning the backend's NFRS-driven auto-
    // suggestion could never work correctly (Current vs Non-Current was
    // always unknown) and funds_flow_type was set blind, never shown to
    // the user. This calls the same suggestion endpoint live, whenever
    // NFRS Category or Classification changes, so the dependent fields
    // are visibly pre-filled (and still fully editable before saving).
    const suggestGroupClassification = async (nfrsCategory, nfrsClassification) => {
        if (!nfrsCategory) return;
        try {
            const params = new URLSearchParams({ nfrs_category: nfrsCategory, nfrs_classification: nfrsClassification || '' });
            const res = await authFetch(`/api/account-groups/suggest-classification?${params.toString()}`);
            const s = res.data || {};
            setGroupForm(f => ({
                ...f,
                cash_flow_category: s.cash_flow_category || '',
                funds_flow_type: s.funds_flow_type || '',
                ratio_analysis_category: s.ratio_analysis_category || '',
                balance_sheet_side: s.balance_sheet_side || '',
                is_balance_sheet: !!s.is_balance_sheet,
                profit_loss_type: s.profit_loss_type || '',
                is_profit_loss: !!s.is_profit_loss
            }));
        } catch { /* suggestion is a convenience only - ignore failures */ }
    };

    // Build the group hierarchy client-side from the flat list. A group
    // whose parent is missing/inactive becomes a root instead of
    // vanishing, and a visited-set guards against any legacy cycle.
    const groupTree = useMemo(() => {
        const byId = Object.fromEntries(groups.map(g => [g.id, g]));
        const kids = {};
        groups.forEach(g => {
            const pid = g.parent_group_id && byId[g.parent_group_id] ? g.parent_group_id : '__root';
            (kids[pid] = kids[pid] || []).push(g);
        });
        Object.values(kids).forEach(list => list.sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || String(a.group_name).localeCompare(String(b.group_name))));
        const seen = new Set();
        const build = (pid) => (kids[pid] || []).filter(g => !seen.has(g.id) && seen.add(g.id)).map(g => ({ ...g, children: build(g.id) }));
        const roots = build('__root');
        // anything never reached (a cycle) is surfaced as a root, not lost
        groups.filter(g => !seen.has(g.id)).forEach(g => { seen.add(g.id); roots.push({ ...g, children: [] }); });
        return roots;
    }, [groups]);

    const descendantIdsOf = (id) => {
        const out = new Set(); const stack = [id];
        while (stack.length) { const cur = stack.pop(); groups.forEach(g => { if (g.parent_group_id === cur && !out.has(g.id)) { out.add(g.id); stack.push(g.id); } }); }
        return out;
    };

    const handleEditGroup = (g) => {
        setEditingGroupId(g.id);
        setGroupForm({ ...emptyGroupForm, ...Object.fromEntries(Object.keys(emptyGroupForm).map(k => [k, g[k] ?? emptyGroupForm[k]])), parent_group_id: g.parent_group_id || '' });
        setShowGroupForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const handleDeleteGroup = async (g) => {
        if (!window.confirm(`Remove group "${g.group_name}"? (Only possible when it has no sub-groups and no ledgers.)`)) return;
        try {
            await authFetch(`/api/account-groups/${g.id}`, { method: 'DELETE' });
            showAlert('Account group removed', 'warning');
            loadMasters();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleGroupSubmit = async (e) => {
        e.preventDefault();
        if (!groupForm.group_name.trim()) return showAlert('Group name is required', 'danger');
        if (!groupForm.nfrs_category) return showAlert('NFRS category is required', 'danger');
        if (!groupForm.category_type) return showAlert('Category type is required', 'danger');
        try {
            const payload = { ...groupForm, parent_group_id: groupForm.parent_group_id || null };
            if (editingGroupId) {
                await authFetch(`/api/account-groups/${editingGroupId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Account group updated', 'success');
            } else {
                await authFetch('/api/account-groups', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Account group created', 'success');
            }
            setGroupForm(emptyGroupForm);
            setEditingGroupId(null);
            setShowGroupForm(false);
            loadMasters();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const openMasterModal = (type) => { setModal(type); setModalForm({ name: '', parent_area_id: '', area_id: '', allow_rate_change_on_mobile_order: false }); };
    const saveMasterModal = async () => {
        if (!modalForm.name.trim()) return showAlert('Name is required', 'danger');
        try {
            if (modal === 'area') {
                // FIX: "main area" (parent) is optional, not compulsory.
                const res = await authFetch('/api/areas', {
                    method: 'POST',
                    body: JSON.stringify({ area_name: modalForm.name, parent_area_id: modalForm.parent_area_id || undefined })
                });
                await loadMasters();
                setAccountForm(f => ({ ...f, area_id: res.data.id }));
            } else if (modal === 'route') {
                // FIX: Area is now required to create a Route.
                if (!modalForm.area_id) return showAlert('Please choose an Area for this route', 'danger');
                const res = await authFetch('/api/routes', {
                    method: 'POST',
                    body: JSON.stringify({ route_name: modalForm.name, area_id: modalForm.area_id })
                });
                await loadMasters();
                setAccountForm(f => ({ ...f, route_id: res.data.id }));
            } else if (modal === 'agent') {
                const res = await authFetch('/api/salesman-agents', { method: 'POST', body: JSON.stringify({ agent_name: modalForm.name, allow_rate_change_on_mobile_order: modalForm.allow_rate_change_on_mobile_order }) });
                await loadMasters();
                setAccountForm(f => ({ ...f, agent_id: res.data.id }));
            }
            setModal(null);
            showAlert('Added', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const isParty = isPartyCategory(accountForm.category_type);
    const isBank = accountForm.category_type === 'bank';
    const isOthersLedger = accountForm.category_type === 'others';

    // FEATURE: the ledger form is split into tabs (Basic / Party Details /
    // Financial) since it grew too long as one long scroll. Party Details
    // only exists as a tab at all when the category is a party type.
    const ledgerFormTabs = [
        { key: 'basic', label: '🧾 Basic Information' },
        ...(isParty ? [{ key: 'party', label: '📍 Party Details' }] : []),
        { key: 'financial', label: '💰 Financial & Other' }
    ];

    // FEATURE: Enter on the last field of a tab moves to the NEXT TAB
    // (focusing its first field) instead of submitting - submit only
    // happens once you're on the last field of the last relevant tab.
    // Passed into useEnterKeyNavigation and every SearchablePopupSelect in
    // this form as `onLastField`.
    const handleLedgerLastField = () => {
        const idx = ledgerFormTabs.findIndex(t => t.key === ledgerFormTab);
        if (idx < ledgerFormTabs.length - 1) {
            const nextTab = ledgerFormTabs[idx + 1].key;
            setLedgerFormTab(nextTab);
            setTimeout(() => {
                const first = accountFormRef.current?.querySelector(
                    'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])'
                );
                first?.focus();
            }, 0);
            return true;
        }
        return false;
    };
    useEnterKeyNavigation(accountFormRef, { onLastField: handleLedgerLastField });

    // FEATURE: 9-digit PAN auto-detects VAT/PAN Type from the category -
    // vendor ledgers get PAN, customer ledgers get VAT, "both" gets Both.
    // Below 9 digits it's forced back to Non Registered (mirrors the
    // reference behaviour, adapted to our category_type values).
    const handlePanChange = (raw) => {
        const cleaned = raw.replace(/\D/g, '').slice(0, 9);
        let vatType = accountForm.vat_pan_type;
        if (cleaned.length < 9) {
            vatType = 'Non Registered';
        } else if (accountForm.category_type === 'purchase') {
            vatType = 'PAN';
        } else if (accountForm.category_type === 'sales') {
            vatType = 'VAT';
        } else if (accountForm.category_type === 'both') {
            vatType = 'Both';
        }
        setAccountForm(f => ({ ...f, pan_number: cleaned, vat_pan_type: vatType }));
    };

    // FEATURE: "Same as Billing" one-time-copy into the shipping_address
    // free-text field, rather than a live binding - the user can still
    // uncheck and edit it separately for a genuinely different address.
    const applySameAsBilling = (checked) => {
        setShippingSameAsBilling(checked);
        if (checked) {
            const combined = [accountForm.street, accountForm.city, accountForm.state, accountForm.zip_code, accountForm.country]
                .filter(Boolean).join(', ');
            setAccountForm(f => ({ ...f, shipping_address: combined }));
        }
    };

    // ---------------- Ledger Category (separate, optional feature) ----------------
    const toggleLedgerCategoryFeature = async (enabled) => {
        try {
            await authFetch('/api/company/ledger-category-setting', { method: 'PUT', body: JSON.stringify({ enabled, label: ledgerCategoryLabel }) });
            setLedgerCategoryEnabled(enabled);
            if (enabled) {
                const cats = await authFetch('/api/ledger-categories');
                setLedgerCategories(cats.data || []);
            }
            showAlert(`Ledger Category feature ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: the feature's own LABEL is renameable too (e.g. a tenant
    // may want to call this "Customer Segment" instead of the generic
    // "Ledger Category") - saved separately from the individual category
    // values, and reflected live on the Ledger Create form's field label.
    const saveLedgerCategoryLabel = async () => {
        if (!labelDraft.trim()) return showAlert('Label cannot be empty', 'danger');
        try {
            await authFetch('/api/company/ledger-category-setting', { method: 'PUT', body: JSON.stringify({ enabled: ledgerCategoryEnabled, label: labelDraft.trim() }) });
            setLedgerCategoryLabel(labelDraft.trim());
            showAlert('Label updated', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const addLedgerCategory = async () => {
        if (!newCategoryName.trim()) return;
        try {
            const res = await authFetch('/api/ledger-categories', { method: 'POST', body: JSON.stringify({ category_name: newCategoryName.trim() }) });
            setLedgerCategories(c => [...c, res.data]);
            setNewCategoryName('');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const renameLedgerCategory = async (id, name) => {
        if (!name.trim()) return;
        try {
            const res = await authFetch(`/api/ledger-categories/${id}`, { method: 'PUT', body: JSON.stringify({ category_name: name.trim() }) });
            setLedgerCategories(cats => cats.map(c => c.id === id ? res.data : c));
            setRenamingCategory(null);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const accountColumns = [
        { key: 'account_code', label: 'Code', type: 'text' },
        { key: 'account_name', label: 'Name', type: 'text' },
        { key: 'group_name', label: 'Group', type: 'text' },
        {
            key: 'category_type', label: 'Category', type: 'text',
            render: (r) => <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">{r.category_type}</span>
        },
        { key: 'pan_number', label: 'PAN', type: 'text', render: (r) => r.pan_number || '—' },
        {
            key: 'opening_balance', label: 'Opening Bal.', type: 'number',
            render: (r) => `${r.opening_balance || 0} ${(r.opening_balance_type || 'dr').toUpperCase()}`
        }
    ];

    return (
        <Layout>
        <div className="max-w-6xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Chart of Accounts (Ledger Master)</h1>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="flex gap-2 mb-4 border-b">
                <button onClick={() => setTab('accounts')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'accounts' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Ledger Accounts</button>
                <button onClick={() => setTab('groups')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'groups' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Account Groups</button>
                <button onClick={() => setTab('ledgerCategories')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'ledgerCategories' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Ledger Categories</button>
            </div>

            {tab === 'accounts' && (
                <>
                    {/* FEATURE: always-visible KPI summary bar (Total Debit / Total
                        Credit / Balance / Entries), computed from the opening
                        balances of the ledgers currently loaded. Kept here rather
                        than baked into ReportGrid since "Debit/Credit/Balance" is
                        ledger-specific accounting terminology, not something every
                        listing (Users, Product Groups, etc.) should carry. */}
                    <div className="flex flex-wrap gap-6 bg-white border rounded-xl px-4 py-3 mb-3 text-sm">
                        <div><span className="text-gray-500">Total Debit: </span><span className="font-semibold">{ledgerSummary.totalDebit.toFixed(2)}</span></div>
                        <div><span className="text-gray-500">Total Credit: </span><span className="font-semibold">{ledgerSummary.totalCredit.toFixed(2)}</span></div>
                        <div><span className="text-gray-500">Balance: </span><span className="font-semibold">{Math.abs(ledgerSummary.balance).toFixed(2)} {ledgerSummary.balance >= 0 ? 'DR' : 'CR'}</span></div>
                        <div><span className="text-gray-500">Entries: </span><span className="font-semibold">{rows.length}</span></div>
                    </div>

                    <div className="flex justify-end mb-3">
                        <button onClick={() => { resetAccountForm(); setShowAccountForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showAccountForm ? 'Close' : '➕ New Ledger Account'}
                        </button>
                    </div>

                    {showAccountForm && (
                        <form ref={accountFormRef} onSubmit={handleAccountSubmit} className="bg-white border rounded-xl p-6 mb-6 space-y-4">

                            {/* FEATURE: form split into tabs since it grew too long as one
                                scroll. Enter on the last field of a tab jumps to the next
                                tab automatically (see handleLedgerLastField) - only submits
                                once you're on the last field of the last relevant tab. */}
                            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                                {ledgerFormTabs.map(t => (
                                    <button key={t.key} type="button" onClick={() => setLedgerFormTab(t.key)}
                                        className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${ledgerFormTab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            {/* ==================== BASIC INFORMATION ==================== */}
                            <div className={ledgerFormTab === 'basic' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
                                <div>
                                    <label className="erp-label">Code {!editingAccountId && <span className="text-xs text-gray-400">(preview only)</span>}</label>
                                    <input
                                        className="erp-input"
                                        disabled
                                        value={
                                            editingAccountId
                                                ? (accountForm.account_code || '')
                                                : accountForm.account_group_id
                                                    ? `${currentFyPrefix ? currentFyPrefix + '-' : ''}${groups.find(g => g.id === accountForm.account_group_id)?.group_code || '...'}-#### (auto-generated on save)`
                                                    : 'Pick an Account Group to preview'
                                        }
                                    />
                                </div>

                                <div>
                                    <label className="erp-label">Account Name *</label>
                                    <input className="erp-input" value={accountForm.account_name}
                                        onChange={e => setAccountForm({ ...accountForm, account_name: e.target.value })} required />
                                </div>

                                <div>
                                    <label className="erp-label">Short Name (Alias) <span className="text-xs text-gray-400">{editingAccountId ? '(editable)' : `(leave blank to auto-generate ${nameInitials(accountForm.account_name)}##### on save)`}</span></label>
                                    <input className="erp-input" value={accountForm.short_name}
                                        onChange={e => setAccountForm({ ...accountForm, short_name: e.target.value })}
                                        placeholder={!editingAccountId ? `e.g. ${nameInitials(accountForm.account_name)}00001` : ''} />
                                </div>

                                <div>
                                    <label className="erp-label">Category Type * <span className="text-xs text-gray-400">(chooses which groups you can pick)</span></label>
                                    <select className="erp-input" value={accountForm.category_type}
                                        onChange={e => setAccountForm({ ...accountForm, category_type: e.target.value })} required>
                                        <option value="">Select category</option>
                                        {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="erp-label">Account Group * <span className="text-xs text-gray-400">(auto-filtered/selected by category)</span></label>
                                    <SearchablePopupSelect
                                        listKey="account_group_picker"
                                        columns={[
                                            { key: 'group_code', label: 'Code' },
                                            { key: 'group_name', label: 'Name' },
                                            { key: 'nfrs_category', label: 'NFRS' },
                                            { key: 'category_type', label: 'Category' }
                                        ]}
                                        defaultVisibleKeys={['group_code', 'group_name', 'nfrs_category']}
                                        items={filteredGroups}
                                        getId={(g) => g.id}
                                        getLabel={(g) => `${g.group_name} (${g.group_code})`}
                                        searchKeys={['group_name', 'group_code']}
                                        value={accountForm.account_group_id}
                                        onChange={(id) => setAccountForm({ ...accountForm, account_group_id: id })}
                                        placeholder={accountForm.category_type ? 'Select account group' : 'Pick a category first'}
                                        disabled={!accountForm.category_type}
                                        onLastField={handleLedgerLastField}
                                        required
                                    />
                                </div>

                                {/* FIX: Ledger Type is only offered for non-customer/vendor/cash/bank
                                    ledgers ("others"), per requirement - never mixed with category_type. */}
                                {isOthersLedger && (
                                    <div>
                                        <label className="erp-label">Ledger Type</label>
                                        <select className="erp-input" value={accountForm.ledger_type}
                                            onChange={e => setAccountForm({ ...accountForm, ledger_type: e.target.value })}>
                                            {LEDGER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                )}

                                {/* FEATURE: Ledger Category - a completely separate, OPTIONAL,
                                    tenant-renameable classification, and now MULTI-SELECT (a
                                    ledger can belong to more than one). Not shown at all unless
                                    the tenant has explicitly turned the feature on (managed from
                                    its own "Ledger Categories" tab, not from inside this form). */}
                                {ledgerCategoryEnabled && (
                                    <div className="md:col-span-2">
                                        <label className="erp-label">
                                            {ledgerCategoryLabel} <span className="text-xs text-gray-400">(optional, multi-select, your own custom grouping)</span>
                                        </label>
                                        {ledgerCategories.length === 0 ? (
                                            <p className="text-xs text-gray-400 border rounded-lg px-3 py-2">No categories defined yet - add some from the "Ledger Categories" tab.</p>
                                        ) : (
                                            <div className="flex flex-wrap gap-3 border rounded-lg px-3 py-2">
                                                {ledgerCategories.map(c => (
                                                    <label key={c.id} className="flex items-center gap-1.5 text-sm">
                                                        <input
                                                            type="checkbox"
                                                            data-enter-skip="true"
                                                            checked={accountForm.ledger_category_ids.includes(c.id)}
                                                            onChange={e => setAccountForm(f => ({
                                                                ...f,
                                                                ledger_category_ids: e.target.checked
                                                                    ? [...f.ledger_category_ids, c.id]
                                                                    : f.ledger_category_ids.filter(id => id !== c.id)
                                                            }))}
                                                        />
                                                        {c.category_name}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* FEATURE: Tags kept last in this Master Entry form, per
                                    request - a general/meta attribute that reads naturally
                                    as the final thing you add once everything else is set. */}
                                <div className="md:col-span-2">
                                    <label className="erp-label">Tags <span className="text-xs text-gray-400">(free-form labels, type and press Enter)</span></label>
                                    <div className="flex flex-wrap gap-1.5 border rounded-lg px-2 py-1.5">
                                        {accountForm.tags.map((t, i) => (
                                            <span key={i} className="flex items-center gap-1 bg-gray-800 text-white text-xs px-2 py-1 rounded-full">
                                                {t}
                                                <span onClick={() => setAccountForm({ ...accountForm, tags: accountForm.tags.filter((_, idx) => idx !== i) })} className="cursor-pointer text-red-300 hover:text-red-100 font-bold">✕</span>
                                            </span>
                                        ))}
                                        <input
                                            className="flex-1 min-w-[100px] border-none outline-none text-sm px-1 py-1"
                                            placeholder={accountForm.tags.length === 0 ? 'e.g. vip, seasonal' : ''}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && e.target.value.trim()) {
                                                    e.preventDefault();
                                                    if (!accountForm.tags.includes(e.target.value.trim())) {
                                                        setAccountForm({ ...accountForm, tags: [...accountForm.tags, e.target.value.trim()] });
                                                    }
                                                    e.target.value = '';
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* ==================== PARTY DETAILS ==================== */}
                            {isParty && (
                                <div className={ledgerFormTab === 'party' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
                                    <div className="md:col-span-2">
                                        <label className="erp-label">Billing Name <span className="hint">(printed on bills / confirmation letters; leave blank to use the ledger name)</span></label>
                                        <input className="erp-input" value={accountForm.billing_name || ''} onChange={e => setAccountForm({ ...accountForm, billing_name: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="erp-label">VAT/PAN Number</label>
                                        <input className="erp-input" maxLength={9} value={accountForm.pan_number}
                                            onChange={e => handlePanChange(e.target.value)} />
                                        <p className="text-xs text-gray-400 mt-1">9 digits auto-detects VAT/PAN Type below</p>
                                    </div>
                                    <div>
                                        <label className="erp-label">VAT/PAN Type</label>
                                        <select className="erp-input" value={accountForm.vat_pan_type}
                                            onChange={e => setAccountForm({ ...accountForm, vat_pan_type: e.target.value })}>
                                            <option value="Non Registered">Non Registered</option>
                                            <option value="VAT">VAT</option>
                                            <option value="PAN">PAN</option>
                                            <option value="Both">Both</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="erp-label">Area</label>
                                        <SearchablePopupSelect
                                            listKey="area_picker"
                                            columns={[{ key: 'area_code', label: 'Code' }, { key: 'area_name', label: 'Name' }]}
                                            defaultVisibleKeys={['area_name']}
                                            items={areas} getId={(a) => a.id} getLabel={(a) => a.area_name}
                                            searchKeys={['area_name', 'area_code']}
                                            value={accountForm.area_id}
                                            onChange={(id) => setAccountForm({ ...accountForm, area_id: id })}
                                            placeholder="Select Area" onAddNew={() => openMasterModal('area')}
                                            onLastField={handleLedgerLastField}
                                        />
                                    </div>
                                    <div>
                                        <label className="erp-label">Route</label>
                                        <SearchablePopupSelect
                                            listKey="route_picker"
                                            columns={[{ key: 'route_code', label: 'Code' }, { key: 'route_name', label: 'Name' }]}
                                            defaultVisibleKeys={['route_name']}
                                            items={routes} getId={(r) => r.id} getLabel={(r) => r.route_name}
                                            searchKeys={['route_name', 'route_code']}
                                            value={accountForm.route_id}
                                            onChange={(id) => setAccountForm({ ...accountForm, route_id: id })}
                                            placeholder="Select Route" onAddNew={() => openMasterModal('route')}
                                            onLastField={handleLedgerLastField}
                                        />
                                    </div>
                                    <div>
                                        <label className="erp-label">Sales Person / Agent</label>
                                        <SearchablePopupSelect
                                            listKey="salesman_picker"
                                            columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }, { key: 'phone', label: 'Phone' }]}
                                            defaultVisibleKeys={['agent_name']}
                                            items={agents} getId={(a) => a.id} getLabel={(a) => a.agent_name}
                                            searchKeys={['agent_name', 'agent_code']}
                                            value={accountForm.agent_id}
                                            onChange={(id) => setAccountForm({ ...accountForm, agent_id: id })}
                                            placeholder="Select Sales Person" onAddNew={() => openMasterModal('agent')}
                                            onLastField={handleLedgerLastField}
                                        />
                                    </div>

                                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                                        <div>
                                            <label className="erp-label">Billing: Street / City / State / Zip</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <input className="border rounded-lg px-2 py-2" placeholder="Street" value={accountForm.street} onChange={e => setAccountForm({ ...accountForm, street: e.target.value })} />
                                                <input className="border rounded-lg px-2 py-2" placeholder="City" value={accountForm.city} onChange={e => setAccountForm({ ...accountForm, city: e.target.value })} />
                                                <input className="border rounded-lg px-2 py-2" placeholder="State" value={accountForm.state} onChange={e => setAccountForm({ ...accountForm, state: e.target.value })} />
                                                <input className="border rounded-lg px-2 py-2" placeholder="Zip Code" value={accountForm.zip_code} onChange={e => setAccountForm({ ...accountForm, zip_code: e.target.value })} />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="block text-sm font-medium">Shipping Address</label>
                                                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                                                    <input type="checkbox" checked={shippingSameAsBilling} onChange={e => applySameAsBilling(e.target.checked)} />
                                                    Same as billing
                                                </label>
                                            </div>
                                            <textarea className="w-full border rounded-lg px-2 py-2" rows={2} disabled={shippingSameAsBilling}
                                                value={accountForm.shipping_address} onChange={e => setAccountForm({ ...accountForm, shipping_address: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="erp-label">Contact Person</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <input className="border rounded-lg px-2 py-2 col-span-2" placeholder="Contact Person Name" value={accountForm.contact_person} onChange={e => setAccountForm({ ...accountForm, contact_person: e.target.value })} />
                                                <input className="border rounded-lg px-2 py-2" placeholder="Phone" value={accountForm.contact_person_phone} onChange={e => setAccountForm({ ...accountForm, contact_person_phone: e.target.value })} />
                                                <input className="border rounded-lg px-2 py-2" placeholder="Mobile" value={accountForm.contact_person_mobile} onChange={e => setAccountForm({ ...accountForm, contact_person_mobile: e.target.value })} />
                                                <input type="email" className="border rounded-lg px-2 py-2 col-span-2" placeholder="Email" value={accountForm.email} onChange={e => setAccountForm({ ...accountForm, email: e.target.value })} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="erp-label">Credit Limit / Days</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <input type="number" className="border rounded-lg px-2 py-2" value={accountForm.credit_limit} onChange={e => setAccountForm({ ...accountForm, credit_limit: e.target.value })} />
                                                <input type="number" className="border rounded-lg px-2 py-2" value={accountForm.credit_days} onChange={e => setAccountForm({ ...accountForm, credit_days: e.target.value })} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="erp-label">Interest % p.a. <span className="hint">(charged on bills overdue past their due date / credit days - Interest Posting)</span></label>
                                            <input type="number" step="0.01" min="0" className="erp-input" value={accountForm.interest_rate ?? 0} onChange={e => setAccountForm({ ...accountForm, interest_rate: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="erp-label">Rate Category <span className="hint">(which sales rate tier this customer sees)</span></label>
                                            <select className="border rounded-lg px-2 py-2 w-full" value={accountForm.rate_category_id} onChange={e => setAccountForm({ ...accountForm, rate_category_id: e.target.value })}>
                                                <option value="">— None —</option>
                                                {rateCategories.map(rc => <option key={rc.id} value={rc.id}>{rc.category_name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="erp-label">Discount Group <span className="hint">(for company-wise auto-discount)</span></label>
                                            <select className="border rounded-lg px-2 py-2 w-full" value={accountForm.discount_group_id} onChange={e => setAccountForm({ ...accountForm, discount_group_id: e.target.value })}>
                                                <option value="">— None —</option>
                                                {discountGroups.map(dg => <option key={dg.id} value={dg.id}>{dg.group_name}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Other Information */}
                                    <div className="md:col-span-2 border-t pt-4">
                                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Other Information</p>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                            <input className="border rounded-lg px-3 py-2" placeholder="TIN No." value={accountForm.tin_number || ''} onChange={e => setAccountForm({ ...accountForm, tin_number: e.target.value })} />
                                            <input className="border rounded-lg px-3 py-2" placeholder="Excise Reg. No." value={accountForm.excise_registration_no} onChange={e => setAccountForm({ ...accountForm, excise_registration_no: e.target.value })} />
                                            <input className="border rounded-lg px-3 py-2" placeholder="CST No." value={accountForm.cst_no} onChange={e => setAccountForm({ ...accountForm, cst_no: e.target.value })} />
                                            <input className="border rounded-lg px-3 py-2" placeholder="DL No." value={accountForm.dl_no} onChange={e => setAccountForm({ ...accountForm, dl_no: e.target.value })} />
                                            <input className="border rounded-lg px-3 py-2" placeholder="Business Category" value={accountForm.business_category} onChange={e => setAccountForm({ ...accountForm, business_category: e.target.value })} />
                                            <input className="border rounded-lg px-3 py-2" placeholder="Voucher Adjustment Basis" value={accountForm.voucher_adjustment_basis} onChange={e => setAccountForm({ ...accountForm, voucher_adjustment_basis: e.target.value })} />
                                            <input className="border rounded-lg px-3 py-2" placeholder="Schedule Reference" value={accountForm.schedule_reference} onChange={e => setAccountForm({ ...accountForm, schedule_reference: e.target.value })} />
                                            <input type="number" step="0.01" className="border rounded-lg px-3 py-2" placeholder="Excise Duty Rate %" value={accountForm.excise_duty_rate} onChange={e => setAccountForm({ ...accountForm, excise_duty_rate: e.target.value })} />
                                            <input className="border rounded-lg px-3 py-2" placeholder="Excise Exemption Certificate" value={accountForm.excise_exemption_certificate} onChange={e => setAccountForm({ ...accountForm, excise_exemption_certificate: e.target.value })} />
                                        </div>
                                    </div>

                                    {/* FEATURE: Sub Ledger restructured to a tri-state Mode
                                        (Disable/Enable/Compulsory) + a separate Allow All Sub
                                        Ledger yes/no, replacing the earlier two-checkbox design. */}
                                    <div className="md:col-span-2 border-t pt-4">
                                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Sub Ledger</p>
                                        <div className="flex flex-wrap gap-4 items-end mb-2">
                                            <div>
                                                <label className="erp-label">Sub Ledger Mode</label>
                                                <select className="border rounded-lg px-2 py-1.5 text-sm" value={accountForm.sub_ledger_mode}
                                                    onChange={e => setAccountForm({ ...accountForm, sub_ledger_mode: e.target.value })}>
                                                    <option value="disable">Disable</option>
                                                    <option value="enable">Enable</option>
                                                    <option value="compulsory">Compulsory</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="erp-label">Allow All Sub Ledger</label>
                                                <select className="border rounded-lg px-2 py-1.5 text-sm" disabled={accountForm.sub_ledger_mode === 'disable'}
                                                    value={accountForm.allow_all_sub_ledger ? 'yes' : 'no'}
                                                    onChange={e => setAccountForm({ ...accountForm, allow_all_sub_ledger: e.target.value === 'yes' })}>
                                                    <option value="yes">Yes</option>
                                                    <option value="no">No</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="erp-label">Credit Limit Control</label>
                                                <select className="border rounded-lg px-2 py-1.5 text-sm" value={accountForm.credit_limit_control} onChange={e => setAccountForm({ ...accountForm, credit_limit_control: e.target.value })}>
                                                    <option value="system_default">Default (As Per System Control)</option>
                                                    <option value="warn">Warn</option>
                                                    <option value="block">Block</option>
                                                    <option value="no_action">No Action</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="erp-label">Credit Days Control</label>
                                                <select className="border rounded-lg px-2 py-1.5 text-sm" value={accountForm.credit_days_control} onChange={e => setAccountForm({ ...accountForm, credit_days_control: e.target.value })}>
                                                    <option value="system_default">Default (As Per System Control)</option>
                                                    <option value="warn">Warn</option>
                                                    <option value="block">Block</option>
                                                    <option value="no_action">No Action</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="erp-label">Bill-wise Tracking <span className="hint">(FIFO settlement against vouchers)</span></label>
                                                <select className="border rounded-lg px-2 py-1.5 text-sm" value={accountForm.bill_wise_tracking_control} onChange={e => setAccountForm({ ...accountForm, bill_wise_tracking_control: e.target.value })}>
                                                    <option value="system_default">Default (As Per System Control)</option>
                                                    <option value="enabled">Enabled</option>
                                                    <option value="disabled">Disabled</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ==================== FINANCIAL & OTHER ==================== */}
                            <div className={ledgerFormTab === 'financial' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
                                {isParty && (
                                    <>
                                        <div className="md:col-span-2">
                                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">LC / BG Details</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input className="border rounded-lg px-2 py-2 col-span-2" placeholder="LC Number" value={accountForm.lc_number} onChange={e => setAccountForm({ ...accountForm, lc_number: e.target.value })} />
                                                    <input className="border rounded-lg px-2 py-2 col-span-2" placeholder="LC Bank Name" value={accountForm.lc_bank_name} onChange={e => setAccountForm({ ...accountForm, lc_bank_name: e.target.value })} />
                                                    <input type="number" className="border rounded-lg px-2 py-2" placeholder="LC Amount" value={accountForm.lc_amount} onChange={e => setAccountForm({ ...accountForm, lc_amount: e.target.value })} />
                                                    <input type="date" className="border rounded-lg px-2 py-2" title="LC Issue Date" value={accountForm.lc_issue_date} onChange={e => setAccountForm({ ...accountForm, lc_issue_date: e.target.value })} />
                                                    <input type="date" className="border rounded-lg px-2 py-2 col-span-2" title="LC Expiry Date" value={accountForm.lc_expiry_date} onChange={e => setAccountForm({ ...accountForm, lc_expiry_date: e.target.value })} />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input className="border rounded-lg px-2 py-2 col-span-2" placeholder="BG Number" value={accountForm.bg_number} onChange={e => setAccountForm({ ...accountForm, bg_number: e.target.value })} />
                                                    <input className="border rounded-lg px-2 py-2 col-span-2" placeholder="BG Bank Name" value={accountForm.bg_bank_name} onChange={e => setAccountForm({ ...accountForm, bg_bank_name: e.target.value })} />
                                                    <input type="number" className="border rounded-lg px-2 py-2" placeholder="BG Amount" value={accountForm.bg_amount} onChange={e => setAccountForm({ ...accountForm, bg_amount: e.target.value })} />
                                                    <input type="date" className="border rounded-lg px-2 py-2" title="BG Issue Date" value={accountForm.bg_issue_date} onChange={e => setAccountForm({ ...accountForm, bg_issue_date: e.target.value })} />
                                                    <input type="date" className="border rounded-lg px-2 py-2 col-span-2" title="BG Expiry Date" value={accountForm.bg_expiry_date} onChange={e => setAccountForm({ ...accountForm, bg_expiry_date: e.target.value })} />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="md:col-span-2 border-t pt-4">
                                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Personal Details (for individual customers)</p>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                <div>
                                                    <label className="erp-label">Birthday</label>
                                                    <input type="date" className="w-full border rounded-lg px-2 py-2" value={accountForm.customer_date_of_birth} onChange={e => setAccountForm({ ...accountForm, customer_date_of_birth: e.target.value })} />
                                                </div>
                                                <div>
                                                    <label className="erp-label">Anniversary</label>
                                                    <input type="date" className="w-full border rounded-lg px-2 py-2" value={accountForm.customer_anniversary_date} onChange={e => setAccountForm({ ...accountForm, customer_anniversary_date: e.target.value })} />
                                                </div>
                                                <div>
                                                    <label className="erp-label">Religion</label>
                                                    <input className="w-full border rounded-lg px-2 py-2" value={accountForm.customer_religion} onChange={e => setAccountForm({ ...accountForm, customer_religion: e.target.value })} />
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {isBank && (
                                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-2 border-t pt-4">
                                        <input className="border rounded-lg px-3 py-2" placeholder="Bank Name" value={accountForm.bank_name} onChange={e => setAccountForm({ ...accountForm, bank_name: e.target.value })} />
                                        <input className="border rounded-lg px-3 py-2" placeholder="Account Number" value={accountForm.bank_account_number} onChange={e => setAccountForm({ ...accountForm, bank_account_number: e.target.value })} />
                                        <input className="border rounded-lg px-3 py-2" placeholder="SWIFT Code" value={accountForm.swift_code} onChange={e => setAccountForm({ ...accountForm, swift_code: e.target.value })} />
                                    </div>
                                )}

                                <div className="border-t pt-4">
                                    <label className="erp-label">Opening Balance</label>
                                    <div className="flex gap-2">
                                        <input type="number" className="flex-1 border rounded-lg px-3 py-2" value={accountForm.opening_balance}
                                            onChange={e => setAccountForm({ ...accountForm, opening_balance: e.target.value })} />
                                        <select className="border rounded-lg px-3 py-2" value={accountForm.opening_balance_type}
                                            onChange={e => setAccountForm({ ...accountForm, opening_balance_type: e.target.value })}>
                                            <option value="dr">Dr</option>
                                            <option value="cr">Cr</option>
                                        </select>
                                    </div>
                                </div>

                                {/* FIX: Lock is not party-restricted (a Cash/Bank/Others ledger
                                    can be locked too) - moved here so it's always reachable,
                                    instead of only existing inside the party-only Other
                                    Information section. */}
                                <div className="border-t pt-4 flex items-end">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={accountForm.is_locked} onChange={e => setAccountForm({ ...accountForm, is_locked: e.target.checked })} />
                                        Lock this ledger (prevent further edits)
                                    </label>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 border-t pt-4">
                                <button type="button" onClick={() => { resetAccountForm(); setShowAccountForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                                    {editingAccountId ? 'Update Ledger Account' : 'Create Ledger Account'}
                                </button>
                            </div>
                        </form>
                    )}

                    <ReportGrid
                        columns={accountColumns}
                        rows={rows}
                        getId={(r) => r.id}
                        storageKey="ledger_accounts_grid"
                        rowActions={(row) => (
                            <div className="flex gap-2 justify-center">
                                <button onClick={() => handleEditAccount(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                <button onClick={() => handleDeleteAccount(row)} className="px-2 py-1 bg-yellow-600 text-white rounded text-xs">Deactivate</button>
                                <button onClick={() => handleRemoveAccount(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                            </div>
                        )}
                    />
                </>
            )}

            {tab === 'groups' && (
                <>
                    <div className="flex justify-end mb-3">
                        <button onClick={() => { setEditingGroupId(null); setGroupForm(emptyGroupForm); setShowGroupForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showGroupForm ? 'Close' : '➕ New Account Group'}
                        </button>
                    </div>
                    {showGroupForm && (
                        <form ref={groupFormRef} onSubmit={handleGroupSubmit} className="bg-white border rounded-xl p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input className="border rounded-lg px-3 py-2" placeholder="Group Name *" value={groupForm.group_name} onChange={e => setGroupForm({ ...groupForm, group_name: e.target.value })} required />
                            <select className="border rounded-lg px-3 py-2" value={groupForm.nfrs_category}
                                onChange={e => { setGroupForm({ ...groupForm, nfrs_category: e.target.value }); suggestGroupClassification(e.target.value, groupForm.nfrs_classification); }} required>
                                <option value="">NFRS Category *</option>
                                <option value="Assets">Assets</option>
                                <option value="Liabilities">Liabilities</option>
                                <option value="Equity">Equity</option>
                                <option value="Income">Income</option>
                                <option value="Expenses">Expenses</option>
                            </select>
                            <select className="border rounded-lg px-3 py-2" value={groupForm.nfrs_classification}
                                onChange={e => { setGroupForm({ ...groupForm, nfrs_classification: e.target.value }); suggestGroupClassification(groupForm.nfrs_category, e.target.value); }}>
                                <option value="">NFRS Classification</option>
                                <option value="Current">Current</option>
                                <option value="Non-Current">Non-Current</option>
                                <option value="Operating">Operating</option>
                                <option value="Non-Operating">Non-Operating</option>
                            </select>
                            <select className="border rounded-lg px-3 py-2" value={groupForm.category_type} onChange={e => setGroupForm({ ...groupForm, category_type: e.target.value })} required>
                                <option value="">Category Type *</option>
                                {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                            <div>
                                <label className="erp-label">Cash Flow Category <span className="text-gray-400">(auto-suggested)</span></label>
                                <select className="erp-input" value={groupForm.cash_flow_category} onChange={e => setGroupForm({ ...groupForm, cash_flow_category: e.target.value })}>
                                    <option value="">Cash Flow Category</option>
                                    <option value="Operating">Operating</option>
                                    <option value="Investing">Investing</option>
                                    <option value="Financing">Financing</option>
                                </select>
                            </div>
                            <div>
                                <label className="erp-label">Funds Flow Type <span className="text-gray-400">(auto-suggested)</span></label>
                                <select className="erp-input" value={groupForm.funds_flow_type} onChange={e => setGroupForm({ ...groupForm, funds_flow_type: e.target.value })}>
                                    <option value="">Funds Flow Type</option>
                                    <option value="Source">Source</option>
                                    <option value="Application">Application</option>
                                    <option value="Both">Both</option>
                                </select>
                            </div>
                            <div>
                                <label className="erp-label">Ratio Analysis Category <span className="text-gray-400">(auto-suggested)</span></label>
                                <select className="erp-input" value={groupForm.ratio_analysis_category} onChange={e => setGroupForm({ ...groupForm, ratio_analysis_category: e.target.value })}>
                                    <option value="">Ratio Analysis Category</option>
                                    <option value="Liquidity">Liquidity</option>
                                    <option value="Solvency">Solvency</option>
                                    <option value="Profitability">Profitability</option>
                                    <option value="Efficiency">Efficiency</option>
                                </select>
                            </div>
                            <input className="border rounded-lg px-3 py-2" placeholder="Description" value={groupForm.description} onChange={e => setGroupForm({ ...groupForm, description: e.target.value })} />
                            <div>
                                <label className="erp-label">Parent Group (optional, for sub-groups)</label>
                                <select className="erp-input" value={groupForm.parent_group_id} onChange={e => setGroupForm({ ...groupForm, parent_group_id: e.target.value })}>
                                    <option value="">None (top-level group)</option>
                                    {(() => { const blocked = editingGroupId ? descendantIdsOf(editingGroupId).add(editingGroupId) : new Set();
                                        return groups.filter(g => !blocked.has(g.id)).map(g => <option key={g.id} value={g.id}>{g.group_name}</option>); })()}
                                </select>
                            </div>
                            <div>
                                <label className="erp-label">Display Order</label>
                                <input type="number" min="1" className="erp-input" value={groupForm.display_order} onChange={e => setGroupForm({ ...groupForm, display_order: e.target.value })} />
                            </div>
                            <div className="md:col-span-3 flex justify-end">
                                {editingGroupId && <button type="button" onClick={() => { setEditingGroupId(null); setGroupForm(emptyGroupForm); setShowGroupForm(false); }} className="px-4 py-2 border rounded-lg mr-2">Cancel Edit</button>}
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">{editingGroupId ? 'Update Group' : 'Save Group'}</button>
                            </div>
                        </form>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mb-3">
                        <div className="flex border rounded-lg overflow-hidden text-sm">
                            <button type="button" onClick={() => setGroupView('tree')} className={`px-3 py-1.5 ${groupView === 'tree' ? 'bg-blue-600 text-white' : 'bg-white'}`}>🌳 Tree</button>
                            <button type="button" onClick={() => setGroupView('table')} className={`px-3 py-1.5 ${groupView === 'table' ? 'bg-blue-600 text-white' : 'bg-white'}`}>☰ Table</button>
                        </div>
                        {groupView === 'tree' && (
                            <>
                                <input className="border rounded-lg px-3 py-1.5 text-sm" placeholder="Search group…" value={groupSearch} onChange={e => setGroupSearch(e.target.value)} />
                                <button type="button" onClick={() => setExpandedGroups(Object.fromEntries(groups.map(g => [g.id, true])))} className="text-xs text-blue-600 underline">Expand all</button>
                                <button type="button" onClick={() => setExpandedGroups({})} className="text-xs text-blue-600 underline">Collapse all</button>
                            </>
                        )}
                    </div>

                    {groupView === 'tree' && (() => {
                        const term = groupSearch.trim().toLowerCase();
                        // With a search term: show matches plus their ancestors, all expanded.
                        const matchesOrHasMatch = (n) => !term || String(n.group_name).toLowerCase().includes(term) || String(n.group_code || '').toLowerCase().includes(term) || n.children.some(matchesOrHasMatch);
                        const renderNode = (n, depth) => {
                            if (!matchesOrHasMatch(n)) return null;
                            const open = term ? true : !!expandedGroups[n.id];
                            const hasKids = n.children.length > 0;
                            return (
                                <div key={n.id}>
                                    <div className="flex items-center gap-2 py-1.5 px-2 border-b hover:bg-slate-50" style={{ paddingLeft: 8 + depth * 22 }}>
                                        <button type="button" disabled={!hasKids} onClick={() => setExpandedGroups(e => ({ ...e, [n.id]: !e[n.id] }))} className="w-5 text-gray-500">{hasKids ? (open ? '▾' : '▸') : '·'}</button>
                                        <span className="text-xs text-gray-400 w-16 shrink-0">{n.group_code}</span>
                                        <span className={`flex-1 text-sm ${depth === 0 ? 'font-semibold' : ''}`}>{n.group_name}{hasKids && <span className="text-xs text-gray-400"> ({n.children.length})</span>}</span>
                                        <span className="text-xs text-gray-500 w-24">{n.nfrs_category}</span>
                                        <span className="text-xs text-gray-500 w-20">{n.category_type}</span>
                                        {n.is_system
                                            ? <span className="text-[10px] text-gray-400 w-28 text-right">system</span>
                                            : <span className="w-28 flex gap-1 justify-end">
                                                <button type="button" onClick={() => handleEditGroup(n)} className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs">Edit</button>
                                                <button type="button" onClick={() => handleDeleteGroup(n)} className="px-2 py-0.5 bg-red-600 text-white rounded text-xs">Remove</button>
                                              </span>}
                                    </div>
                                    {open && n.children.map(c => renderNode(c, depth + 1))}
                                </div>
                            );
                        };
                        return <div className="bg-white border rounded-xl overflow-hidden">{groupTree.map(n => renderNode(n, 0))}{groupTree.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No account groups yet.</p>}</div>;
                    })()}

                    {groupView === 'table' && (
                    <div className="bg-white border rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Code</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">NFRS</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Cash Flow</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map(g => (
                                    <tr key={g.id} className="border-t">
                                        <td className="px-3 py-2">{g.group_code}</td>
                                        <td className="px-3 py-2">{g.group_name}</td>
                                        <td className="px-3 py-2">{g.nfrs_category}</td>
                                        <td className="px-3 py-2">{g.cash_flow_category || '—'}</td>
                                        <td className="px-3 py-2">{g.category_type}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    )}
                </>
            )}

            {tab === 'ledgerCategories' && (
                <div className="bg-white border rounded-xl p-6 max-w-2xl">
                    <h3 className="font-semibold text-lg mb-2">Ledger Categories</h3>
                    <p className="text-xs text-gray-400 mb-4">
                        Separate from the Customer/Supplier/Cash/Bank category on each ledger -
                        a completely optional, your-own-naming classification. Off by default;
                        turning it on here is what makes the (multi-select) Ledger Category box
                        appear on the ledger create/edit form.
                    </p>

                    <label className="flex items-center gap-2 text-sm mb-4 border-b pb-4">
                        <input type="checkbox" checked={ledgerCategoryEnabled} onChange={e => toggleLedgerCategoryFeature(e.target.checked)} />
                        Enable custom Ledger Category on the ledger form
                    </label>

                    {ledgerCategoryEnabled && (
                        <div className="mb-4 border-b pb-4">
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Field label on the Ledger Create form</label>
                            <p className="text-xs text-gray-400 mb-2">
                                Rename the whole feature itself - e.g. call it "Customer Segment" or
                                "Business Type" instead of the generic "Ledger Category". This is
                                different from renaming the individual category values below.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    value={labelDraft}
                                    onChange={e => setLabelDraft(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveLedgerCategoryLabel(); } }}
                                    className="flex-1 border rounded-lg px-3 py-2 text-sm"
                                />
                                <button onClick={saveLedgerCategoryLabel} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Save Label</button>
                            </div>
                        </div>
                    )}

                    {ledgerCategoryEnabled && (
                        <>
                            <div className="space-y-2 max-h-64 overflow-y-auto mb-3">
                                {ledgerCategories.length === 0 && <p className="text-xs text-gray-400">No categories yet - add one below.</p>}
                                {ledgerCategories.map(c => (
                                    <div key={c.id} className="flex items-center gap-2">
                                        {renamingCategory === c.id ? (
                                            <input
                                                autoFocus
                                                defaultValue={c.category_name}
                                                onKeyDown={e => { if (e.key === 'Enter') renameLedgerCategory(c.id, e.target.value); if (e.key === 'Escape') setRenamingCategory(null); }}
                                                onBlur={e => renameLedgerCategory(c.id, e.target.value)}
                                                className="flex-1 border rounded px-2 py-1 text-sm"
                                            />
                                        ) : (
                                            <span className="flex-1 text-sm">{c.category_name} <span className="text-xs text-gray-400">({c.category_code})</span></span>
                                        )}
                                        <button onClick={() => setRenamingCategory(c.id)} className="text-xs text-blue-600">Rename</button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    value={newCategoryName}
                                    onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLedgerCategory(); } }}
                                    placeholder="New category name"
                                    className="flex-1 border rounded-lg px-3 py-2 text-sm"
                                />
                                <button onClick={addLedgerCategory} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Add</button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {modal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <form ref={masterModalFormRef} onSubmit={e => { e.preventDefault(); saveMasterModal(); }} className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h3 className="font-semibold text-lg mb-4">Add New {modal === 'area' ? 'Area' : modal === 'route' ? 'Route' : 'Sales Person / Agent'}</h3>
                        <input className="w-full border rounded-lg px-3 py-2 mb-3" placeholder="Name *" value={modalForm.name} onChange={e => setModalForm({ ...modalForm, name: e.target.value })} />

                        {modal === 'area' && (
                            <div className="mb-3">
                                <label className="erp-label">Main Area (optional - leave blank for a top-level area)</label>
                                <select className="erp-input" value={modalForm.parent_area_id}
                                    onChange={e => setModalForm({ ...modalForm, parent_area_id: e.target.value })}>
                                    <option value="">None (top-level)</option>
                                    {areas.map(a => <option key={a.id} value={a.id}>{a.area_name}</option>)}
                                </select>
                            </div>
                        )}

                        {modal === 'route' && (
                            <div className="mb-3">
                                <label className="erp-label">Area * <span className="text-red-500">(required)</span></label>
                                <select className="erp-input" value={modalForm.area_id}
                                    onChange={e => setModalForm({ ...modalForm, area_id: e.target.value })} required>
                                    <option value="">Select Area</option>
                                    {areas.map(a => <option key={a.id} value={a.id}>{a.area_name}</option>)}
                                </select>
                            </div>
                        )}

                        {modal === 'agent' && (
                            <label className="flex items-center gap-2 text-sm mb-3">
                                <input type="checkbox" checked={modalForm.allow_rate_change_on_mobile_order}
                                    onChange={e => setModalForm({ ...modalForm, allow_rate_change_on_mobile_order: e.target.checked })} />
                                Allow Rate Change While Mobile Order
                            </label>
                        )}

                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
        </Layout>
    );
}
