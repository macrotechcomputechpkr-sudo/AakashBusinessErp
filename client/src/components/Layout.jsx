// =============================================
// Layout.jsx
// Was listed in the original file structure (components/Layout.jsx) but
// never actually implemented - every page duplicated its own header
// instead. This provides one shared shell with navigation so new pages
// (Fiscal Years, Branches & Warehouses, Business Units, Users) are all
// reachable instead of only being accessible by typing the URL directly.
// =============================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import useGlobalEnterNav from '../hooks/useGlobalEnterNav';
import useExcelTableFilters from '../hooks/useExcelTableFilters';
import { useNotifications, BellButton, NotificationOverlay } from './NotificationCenter';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { SECTIONS, REPORT_GROUPS } from './menu';
import { useAuth } from '../contexts/AuthContext';

export default function Layout({ children }) {
    const { user, tenant, tenants, isSuperAdmin, logout, switchTenant } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const location = useLocation();
    // Enter = next field on every screen; spreadsheet filter on every report table
    const contentRef = useRef(null);
    useGlobalEnterNav(contentRef);
    const excelMenu = useExcelTableFilters(contentRef);
    // 🔔 notifications (bell, list, popups) - polled once for both sidebars
    const notes = useNotifications();
    const [drawer, setDrawer] = useState(false);
    const [search, setSearch] = useState('');
    // open sections are remembered per browser
    const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('nav_open_sections') || 'null') || { home: true }; } catch { return { home: true }; } });
    useEffect(() => { try { localStorage.setItem('nav_open_sections', JSON.stringify(open)); } catch { /* private mode */ } }, [open]);
    useEffect(() => { setDrawer(false); }, [location.pathname, location.search]);
    const sections = useMemo(() => [...SECTIONS, { key: 'reports', title: 'Reports', items: REPORT_GROUPS.flatMap(g => g.items.map(([to, label]) => ({ to, label: `📊 ${label}`, group: g.title }))) }], []);
    const q = search.trim().toLowerCase();
    const current = location.pathname + location.search;

    const link = item => {
        const cls = active => `block px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`;
        // links with a query string reload the page so a report opens on the chosen view
        if (item.to.includes('?')) return <a key={item.to} href={item.to} className={cls(current === item.to)}>{item.label}</a>;
        return <NavLink key={item.to} to={item.to} className={({ isActive }) => cls(isActive)}>{item.label}</NavLink>;
    };
    const nav = (
        <>
            <div className="p-4 border-b border-gray-200">
                <div className="flex items-start justify-between gap-1">
                    <p className="font-bold text-gray-900 truncate">{tenant?.company_name || 'Multi-Tenant System'}</p>
                    <BellButton api={notes} className="-mt-1" />
                </div>
                <p className="text-xs text-gray-400">{tenant?.tenant_code}</p>
                <input className="mt-2 w-full border rounded-lg px-2 py-1 text-sm" placeholder="🔍 Find menu / report…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <nav className="flex-1 p-2 overflow-y-auto">
                {sections.map(sec => {
                    const items = q ? sec.items.filter(i => i.label.toLowerCase().includes(q) || (i.group || '').toLowerCase().includes(q)) : sec.items;
                    if (!items.length) return null;
                    const isOpen = q || open[sec.key] || sec.items.some(i => i.to === location.pathname);
                    return (
                        <div key={sec.key} className="mb-1">
                            <button type="button" className="w-full flex justify-between items-center px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800" onClick={() => setOpen(o => ({ ...o, [sec.key]: !isOpen }))}>
                                <span>{sec.title}{sec.key === 'reports' ? ` (${sec.items.length})` : ''}</span><span>{isOpen ? '▾' : '▸'}</span>
                            </button>
                            {isOpen && <div className="space-y-0.5">{items.map(link)}</div>}
                        </div>
                    );
                })}
            </nav>
            {tenants.length > 1 && (
                <div className="p-3 border-t border-gray-200">
                    <label className="text-xs text-gray-400">Switch company</label>
                    <select className="w-full mt-1 border rounded-lg px-2 py-1.5 text-sm" value={tenant?.id || ''} onChange={(e) => switchTenant(e.target.value)}>
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
        </>
    );

    return (
        <div className="min-h-screen bg-gray-50 md:flex">
            <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex md:flex-col md:sticky md:top-0 md:h-screen">{nav}</aside>
            {/* phones / tablets: top bar + drawer */}
            <div className="md:hidden sticky top-0 z-30 bg-white border-b flex items-center justify-between px-3 py-2 no-print">
                <button type="button" className="text-2xl leading-none px-2" onClick={() => setDrawer(true)} aria-label="Menu">☰</button>
                <p className="font-semibold text-sm truncate">{tenant?.company_name || ''}</p>
                <div className="flex items-center gap-1"><BellButton api={notes} /><a href="/mobile" className="text-xs text-blue-600">📱 Mobile</a></div>
            </div>
            {drawer && (
                <div className="md:hidden fixed inset-0 z-40 flex" onClick={() => setDrawer(false)}>
                    <aside className="w-72 max-w-[85%] bg-white h-full flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>{nav}</aside>
                    <div className="flex-1 bg-black/40" />
                </div>
            )}
            <div className="flex-1 min-w-0" ref={contentRef}>
                {children}
            </div>
            {excelMenu}
            <NotificationOverlay api={notes} />
        </div>
    );
}
