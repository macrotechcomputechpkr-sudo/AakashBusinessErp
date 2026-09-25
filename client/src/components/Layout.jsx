// =============================================
// Layout.jsx
// Was listed in the original file structure (components/Layout.jsx) but
// never actually implemented - every page duplicated its own header
// instead. This provides one shared shell with navigation so new pages
// (Fiscal Years, Branches & Warehouses, Business Units, Users) are all
// reachable instead of only being accessible by typing the URL directly.
// =============================================

import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
    { to: '/dashboard', label: '🏠 Dashboard' },
    { to: '/fiscal-years', label: '📅 Fiscal Years' },
    { to: '/chart-of-accounts', label: '📒 Chart of Accounts' },
    { to: '/ledger-mapping', label: '🔗 Ledger Mapping' },
    { to: '/cost-profit-centers', label: '🎯 Cost & Profit Centers' },
    { to: '/billing-terms', label: '🧾 Billing Terms' },
    { to: '/sub-ledgers', label: '📑 Sub Ledgers' },
    { to: '/system-control', label: '⚙️ System Control' },
    { to: '/entry-field-control', label: '🔒 Entry Field Control' },
    { to: '/product-units', label: '📏 Product Units' },
    { to: '/products', label: '🛒 Products' },
    { to: '/ledger-opening', label: '📖 Ledger Opening Balance' },
    { to: '/product-opening', label: '📦 Product Opening Stock' },
    { to: '/product-rate-change', label: '💲 Product Rate Change' },
    { to: '/product-offer-rate', label: '🏷️ Offer Rate' },
    { to: '/remarks-terms', label: '📝 Remarks & Terms' },
    { to: '/user-defined-fields', label: '🧩 User Defined Fields' },
    { to: '/transport-master', label: '🚚 Transport Master' },
    // INACTIVE (per request): keep the code, hide from navigation for now.
    { to: '/sales-quotation', label: '📝 Sales Quotation' },
    { to: '/sales-order', label: '🧾 Sales Order' },
    { to: '/sales-delivery', label: '🚚 Sales Delivery/Challan' },
    { to: '/sales-bill', label: '💵 Sales Bill/Invoice' },
    { to: '/sales-return', label: '↩️ Sales Return' },
    { to: '/sales-nonsaleable-return', label: '🗑️ Sales Non-saleable Return' },
    { to: '/sales-additional-entry', label: '➕ Sales Additional Entry' },
    // { to: '/purchase-requisition', label: '📋 Purchase Requisition' },
    { to: '/purchase-order', label: '🛒 Purchase Order' },
    { to: '/purchase-quotation', label: '📨 Purchase Quotation' },
    { to: '/purchase-grn', label: '📦 Purchase GRN' },
    { to: '/purchase-bill', label: '🧾 Purchase Bill' },
    { to: '/purchase-additional-expense', label: '🧮 Additional Expenses' },
    { to: '/purchase-return', label: '↩️ Purchase Return' },
    { to: '/purchase-nonsaleable-return', label: '🚫 Non-saleable Return' },
    { to: '/bill-wise-ageing-report', label: '📅 Bill-wise Ageing Report' },
    { to: '/journal-voucher', label: '📗 Journal Voucher' },
    { to: '/stock-transfer', label: '🔄 Stock Transfer' },
    { to: '/debit-note', label: '📤 Debit Note' },
    { to: '/credit-note', label: '📥 Credit Note' },
    { to: '/pdc-voucher', label: '🏦 PDC' },
    { to: '/bom-template', label: '📋 BOM Template' },
    { to: '/production-order', label: '🏭 Production Order' },
    { to: '/cash-bank-entry', label: '💵 Cash/Bank Entry' },
    { to: '/grn-outstanding-report', label: '📊 GRN Outstanding Report' },
    { to: '/purchase-register-report', label: '📈 Purchase Register Report (All)' },
    { to: '/document-numbering', label: '🔢 Document Numbering' },
    { to: '/route-sequencing', label: '🚚 Route Sequencing' },
    { to: '/product-groups', label: '📦 Product Groups' },
    { to: '/salesman-agents', label: '🧑‍💼 Salesman / Agent' },
    { to: '/security-groups', label: '🔐 Security Groups' },
    { to: '/product-rate-history', label: '📜 Rate & Discount History' },
    { to: '/bulk-cash-settlement', label: '💰 Bulk Cash Settlement' },
    { to: '/document-designer', label: '🎨 Document Designer' },
    { to: '/register', label: '📋 Universal Register' },
    { to: '/outstanding-report', label: '⏳ Outstanding Report' },
    { to: '/vat-reports', label: '🧾 VAT & Tax Reports' },
    { to: '/party-summary', label: '👥 Party Summary' },
    { to: '/financial-reports', label: '📊 Financial Reports' },
    { to: '/stock-movement', label: '📦 Stock Movement' },
    { to: '/stock-report', label: '📋 Stock Report' },
    { to: '/stock-in-out', label: '🔁 Stock In / Out (Qty)' },
    { to: '/stock-valuation', label: '💰 Stock Valuation' },
    { to: '/sales-purchase-analysis', label: '📈 Sales / Purchase Analysis' },
    { to: '/monthly-analysis', label: '🗓 Monthly Analysis' },
    { to: '/profitability', label: '💹 Profitability' },
    { to: '/rate-history', label: '🏷 Rate History' },
    { to: '/ledger-report', label: '📒 Ledger Report' },
    { to: '/lc-register', label: '🏦 LC Register & Mapping' },
    { to: '/categories', label: '🏷️ Category Management' },
    { to: '/pricing-masters', label: '💲 Rate Category & Discount Group' },
    { to: '/branches-warehouses', label: '🏢 Branches & Warehouses' },
    { to: '/business-units', label: '🏷️ Business Units' },
    { to: '/users', label: '👤 Users' }
];

export default function Layout({ children }) {
    const { user, tenant, tenants, isSuperAdmin, logout, switchTenant } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-gray-50 flex">
            <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex md:flex-col">
                <div className="p-4 border-b border-gray-200">
                    <p className="font-bold text-gray-900 truncate">{tenant?.company_name || 'Multi-Tenant System'}</p>
                    <p className="text-xs text-gray-400">{tenant?.tenant_code}</p>
                </div>
                <nav className="flex-1 p-2 space-y-1">
                    {navItems.map(item => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                `block px-3 py-2 rounded-lg text-sm font-medium ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`
                            }
                        >
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                {tenants.length > 1 && (
                    <div className="p-3 border-t border-gray-200">
                        <label className="text-xs text-gray-400">Switch company</label>
                        <select
                            className="w-full mt-1 border rounded-lg px-2 py-1.5 text-sm"
                            value={tenant?.id || ''}
                            onChange={(e) => switchTenant(e.target.value)}
                        >
                            {tenants.map(t => <option key={t.id} value={t.id}>{t.company_name}</option>)}
                        </select>
                    </div>
                )}

                <div className="p-3 border-t border-gray-200 flex items-center justify-between">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">{user?.full_name || user?.email}</p>
                        {isSuperAdmin && <span className="text-xs text-purple-600">Super Admin</span>}
                    </div>
                    <button onClick={handleLogout} className="text-xs text-red-600 font-medium">Logout</button>
                </div>
            </aside>

            <div className="flex-1 min-w-0">
                {children}
            </div>
        </div>
    );
}
