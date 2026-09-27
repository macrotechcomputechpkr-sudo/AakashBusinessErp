// =============================================
// Layout.jsx
// The application window, in the classic Microsoft Dynamics NAV style:
//   * blue title bar (screen name - company, bell, user, company switch)
//   * beige menu bar on top: Master Data, Data Entry (Sales / Purchase /
//     Production / Inventory / Accounts ... each its own sub-menu),
//     Accounts Report, Sales/Purchase, Analysis, Setup, Office, Tools and
//     Poultry (only when System Control turns it on) - components/menu.ts
//   * menu finder (type part of a screen / report name)
//   * status bar (ready, user, company, date / time)
// Phones and tablets get the same menus in a slide-in drawer.
// =============================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import useGlobalEnterNav from '../hooks/useGlobalEnterNav';
import useExcelTableFilters from '../hooks/useExcelTableFilters';
import useAppFeatures from '../hooks/useAppFeatures';
import { useNotifications, BellButton, NotificationOverlay } from './NotificationCenter';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { TOP_MENUS, featureOn } from './menu';
import { useAuth } from '../contexts/AuthContext';

// links with a query string reload the page so a report / tab opens on the chosen view
function MenuLink({ item, className, onClick }) {
    if (item.to.includes('?')) return <a href={item.to} className={className} onClick={onClick}>{item.label}</a>;
    return <Link to={item.to} className={className} onClick={onClick}>{item.label}</Link>;
}

function useClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
    return now;
}

export default function Layout({ children }) {
    const { user, tenant, tenants, isSuperAdmin, logout, switchTenant } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const features = useAppFeatures();
    const now = useClock();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    // Enter = next field on every screen; spreadsheet filter on every report table
    const contentRef = useRef(null);
    useGlobalEnterNav(contentRef);
    const excelMenu = useExcelTableFilters(contentRef);
    // 🔔 notifications (bell, list, popups)
    const notes = useNotifications();

    const menus = useMemo(() => TOP_MENUS.filter(m => featureOn(m.feature, features)).map(m => ({
        ...m,
        groups: m.groups.filter(g => featureOn(g.feature, features)).map(g => ({ ...g, items: g.items.filter(it => featureOn(it.feature, features)) })).filter(g => g.items.length)
    })).filter(m => m.groups.length), [features]);
    const allItems = useMemo(() => {
        const seen = new Set();
        return menus.flatMap(m => m.groups.flatMap(g => g.items.map(it => ({ ...it, group: `${m.title} › ${g.title}` })))).filter(it => (seen.has(it.to) ? false : seen.add(it.to)));
    }, [menus]);

    const [openMenu, setOpenMenu] = useState(null);       // key of the open top menu
    const [openGroup, setOpenGroup] = useState(null);     // index of the open sub-menu
    const [flip, setFlip] = useState(false);              // open to the left near the right edge
    const [drawer, setDrawer] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState({});
    const [search, setSearch] = useState('');
    const barRef = useRef(null);

    useEffect(() => { setOpenMenu(null); setDrawer(false); setSearch(''); }, [location.pathname, location.search]);
    useEffect(() => {
        const close = e => { if (barRef.current && !barRef.current.contains(e.target)) { setOpenMenu(null); setSearch(''); } };
        const esc = e => { if (e.key === 'Escape') { setOpenMenu(null); setSearch(''); setDrawer(false); } };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, []);

    const current = location.pathname + location.search;
    const here = allItems.find(it => it.to === current) || allItems.find(it => it.to.split('?')[0] === location.pathname);
    const screenTitle = here ? here.label.replace(/^[^\w(]+\s*/u, '') : (location.pathname === '/dashboard' ? 'Dashboard' : 'Aakash Business ERP');
    useEffect(() => { document.title = `${screenTitle} - ${tenant?.company_name || 'Aakash Business ERP'}`; }, [screenTitle, tenant]);

    const q = search.trim().toLowerCase();
    const found = q ? allItems.filter(it => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)).slice(0, 40) : [];

    const toggleMenu = (key, e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setFlip(r.left > window.innerWidth * 0.55);
        setOpenGroup(null);
        setOpenMenu(o => (o === key ? null : key));
    };
    const hoverMenu = (key, e) => {
        if (!openMenu || openMenu === key) return;
        const r = e.currentTarget.getBoundingClientRect();
        setFlip(r.left > window.innerWidth * 0.55);
        setOpenGroup(null);
        setOpenMenu(key);
    };

    const dropdown = m => {
        const single = m.groups.length === 1;
        return (
            <div className={`nav-dropdown ${single ? '' : 'groups'} ${flip ? 'right' : ''}`} role="menu">
                {single ? m.groups[0].items.map(it => <MenuLink key={it.to} item={it} className="nav-dropdown-item" />)
                    : m.groups.map((g, gi) => (
                        <div key={g.title} className={`nav-dropdown-item has-sub ${openGroup === gi ? 'hot' : ''}`} onMouseEnter={() => setOpenGroup(gi)} onClick={() => setOpenGroup(gi)}>
                            <span>{g.title}</span><span className="nav-sub-arrow">▸</span>
                            {openGroup === gi && (
                                <div className={`nav-submenu ${flip ? 'left' : ''}`} role="menu">
                                    <div className="nav-submenu-title">{g.title}</div>
                                    {g.items.map(it => <MenuLink key={it.to} item={it} className="nav-dropdown-item" />)}
                                </div>
                            )}
                        </div>
                    ))}
            </div>
        );
    };

    const drawerNav = (
        <div className="nav-drawer-body">
            <input className="nav-input mb-2" placeholder="🔍 Find menu / report…" value={search} onChange={e => setSearch(e.target.value)} />
            {q ? found.map(it => <MenuLink key={it.to} item={it} className="nav-navitem" />)
                : menus.map(m => (
                    <div key={m.key}>
                        <button type="button" className="nav-leftpane-header w-full text-left" onClick={() => setDrawerOpen(o => ({ ...o, [m.key]: !o[m.key] }))}>{drawerOpen[m.key] ? '▾' : '▸'} {m.title}</button>
                        {drawerOpen[m.key] && m.groups.map(g => (
                            <div key={g.title}>
                                {m.groups.length > 1 && <div className="nav-drawer-group">{g.title}</div>}
                                {g.items.map(it => <MenuLink key={it.to} item={it} className={`nav-navitem ${current === it.to ? 'active' : ''}`} />)}
                            </div>
                        ))}
                    </div>
                ))}
            {tenants.length > 1 && (
                <div className="p-2">
                    <label className="nav-label">Switch company</label>
                    <select className="nav-select" value={tenant?.id || ''} onChange={e => switchTenant(e.target.value)}>{tenants.map(t => <option key={t.id} value={t.id}>{t.company_name}</option>)}</select>
                </div>
            )}
            <button type="button" className="nav-btn w-full mt-2" onClick={handleLogout}>Logout</button>
        </div>
    );

    return (
        <div className="nav-app">
            <div className="nav-titlebar no-print">
                <div className="nav-titlebar-left">
                    <div className="nav-titlebar-icon">A</div>
                    <span>{screenTitle} - {tenant?.company_name || 'Aakash Business ERP'}</span>
                </div>
                <div className="nav-titlebar-right">
                    <BellButton api={notes} className="nav-bell" />
                    <span className="hidden md:inline truncate max-w-[180px]" title={user?.email}>👤 {user?.full_name || user?.email}{isSuperAdmin ? ' (Super Admin)' : ''}</span>
                    {tenants.length > 1 && (
                        <select className="nav-title-select hidden md:block" value={tenant?.id || ''} onChange={e => switchTenant(e.target.value)} title="Switch company">
                            {tenants.map(t => <option key={t.id} value={t.id}>{t.company_name}</option>)}
                        </select>
                    )}
                    <button type="button" className="nav-wc-btn close hidden md:flex" title="Logout" onClick={handleLogout}>⏻</button>
                </div>
            </div>

            <div className="nav-menubar no-print" ref={barRef}>
                <button type="button" className="nav-menuitem md:hidden" onClick={() => setDrawer(true)} aria-label="Menu">☰ Menu</button>
                <Link to="/dashboard" className="nav-menuitem hidden md:block" title="Dashboard">🏠</Link>
                {menus.map(m => (
                    <div key={m.key} className={`nav-menuitem hidden md:block ${openMenu === m.key ? 'open' : ''}`} onMouseEnter={e => hoverMenu(m.key, e)}>
                        <button type="button" className="nav-menu-btn" onClick={e => toggleMenu(m.key, e)} aria-haspopup="menu" aria-expanded={openMenu === m.key}>{m.title}</button>
                        {openMenu === m.key && dropdown(m)}
                    </div>
                ))}
                <div className="nav-menu-search hidden md:block">
                    <input className="nav-input" placeholder="🔍 Find menu / report…" value={search} onChange={e => setSearch(e.target.value)} />
                    {q && (
                        <div className="nav-dropdown right" role="menu">
                            {found.length === 0 && <div className="nav-dropdown-note">Nothing found</div>}
                            {found.map(it => <MenuLink key={it.to} item={{ ...it, label: `${it.label}` }} className="nav-dropdown-item" />)}
                        </div>
                    )}
                </div>
            </div>

            {drawer && (
                <div className="md:hidden fixed inset-0 z-50 flex no-print" onClick={() => setDrawer(false)}>
                    <aside className="nav-drawer" onClick={e => e.stopPropagation()}>
                        <div className="nav-titlebar"><div className="nav-titlebar-left"><span>{tenant?.company_name || 'Menu'}</span></div>
                            <button type="button" className="nav-wc-btn close" onClick={() => setDrawer(false)}>✕</button></div>
                        {drawerNav}
                    </aside>
                    <div className="flex-1 bg-black/40" />
                </div>
            )}

            <main className="nav-workspace" ref={contentRef}>
                {children}
            </main>

            <div className="nav-statusbar no-print">
                <div className="nav-statusbar-left">
                    <span className="nav-status-indicator" />
                    <span>Ready</span>
                    <span className="hidden sm:inline">· {user?.full_name || user?.email}</span>
                    <span className="hidden sm:inline">· {tenant?.company_name}{tenant?.tenant_code ? ` (${tenant.tenant_code})` : ''}</span>
                    {features?.business_nature && <span className="hidden md:inline">· {features.business_nature.charAt(0).toUpperCase() + features.business_nature.slice(1)}</span>}
                </div>
                <div className="nav-statusbar-right">
                    <span>{now.toLocaleDateString()}</span>
                    <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>
            {excelMenu}
            <NotificationOverlay api={notes} />
        </div>
    );
}
