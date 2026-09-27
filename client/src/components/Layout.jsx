// =============================================
// Layout.jsx
// The application window, in the classic Microsoft Dynamics NAV style:
//   * blue title bar (company, bell, user, company switch)
//   * beige menu bar on top: Master Data, Data Entry, Accounts Report,
//     Sales/Purchase, Analysis, Setup, Office, Tools and the Business Nature
//     menus - components/menu.ts. A menu drops down one panel with each
//     sub-menu as a column (no side fly-outs, so nothing overlaps).
//   * menu finder (type part of a screen / report name)
//   * every screen sits in a NAV window: title bar with the screen name and
//     minimise / maximise / close, ribbon (Home, Related screens of the same
//     menu group, Reports for that area) and a tool bar
//   * status bar (ready, user, company, date / time)
// Phones and tablets get the same menus in a slide-in drawer.
// =============================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import useGlobalEnterNav from '../hooks/useGlobalEnterNav';
import useExcelTableFilters from '../hooks/useExcelTableFilters';
import useAppFeatures from '../hooks/useAppFeatures';
import { useNotifications, BellButton, NotificationOverlay } from './NotificationCenter';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { TOP_MENUS, featureOn, visibleReportGroups } from './menu';
import { useAuth } from '../contexts/AuthContext';

// links with a query string reload the page so a report / tab opens on the chosen view
function MenuLink({ item, className, onClick }) {
    if (item.to.includes('?')) return <a href={item.to} className={className} onClick={onClick}>{item.label}</a>;
    return <Link to={item.to} className={className} onClick={onClick}>{item.label}</Link>;
}

// which report group a screen's "Reports" ribbon tab lists
const REPORT_FOR = [
    [/poultry|hatch|broiler/i, 'Poultry & Hatchery'], [/construction|site/i, 'Construction'], [/automobile|vehicle|job card|enquir/i, 'Automobile'],
    [/purchase|grn|lc register/i, 'Purchase'], [/sales|salesman|route|order|delivery|quotation/i, 'Sales, Salesman & Routes'],
    [/inventory|stock|production|product|bom/i, 'Inventory & Production'], [/vat|ird|tds/i, 'VAT, TDS & IRD'],
    [/account|ledger|journal|cash|bank|voucher|note|pdc|asset|interest|budget/i, 'Accounts & Finance'], [/task|darta|office/i, 'Office: Tasks & Darta / Chalani']
];

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
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 280 });
    const [drawer, setDrawer] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState({});
    const [search, setSearch] = useState('');
    const barRef = useRef(null);
    const panelRef = useRef(null);
    // page window: ribbon tab, minimised body, maximised (full width) or a centred window
    const [ribbon, setRibbon] = useState('home');
    const [collapsed, setCollapsed] = useState(false);
    const [maxed, setMaxed] = useState(() => { try { return localStorage.getItem('nav_window_max') !== '0'; } catch { return true; } });
    const toggleMax = () => setMaxed(v => { try { localStorage.setItem('nav_window_max', v ? '0' : '1'); } catch { /* private mode */ } return !v; });

    useEffect(() => { setOpenMenu(null); setDrawer(false); setSearch(''); setRibbon('home'); setCollapsed(false); }, [location.pathname, location.search]);
    useEffect(() => {
        const inside = t => (barRef.current && barRef.current.contains(t)) || (panelRef.current && panelRef.current.contains(t));
        const close = e => { if (!inside(e.target)) { setOpenMenu(null); setSearch(''); } };
        const esc = e => { if (e.key === 'Escape') { setOpenMenu(null); setSearch(''); setDrawer(false); } };
        const shut = () => setOpenMenu(null);
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        window.addEventListener('resize', shut);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', shut); };
    }, []);

    const current = location.pathname + location.search;
    const here = allItems.find(it => it.to === current) || allItems.find(it => it.to.split('?')[0] === location.pathname);
    const screenTitle = here ? here.label.replace(/^[^\w(]+\s*/u, '') : (location.pathname === '/dashboard' ? 'Dashboard' : 'Aakash Business ERP');
    const screenIcon = here ? (here.label.match(/^[^\w(]+/u)?.[0] || '').trim() || '📄' : '🏠';
    useEffect(() => { document.title = `${screenTitle} - ${tenant?.company_name || 'Aakash Business ERP'}`; }, [screenTitle, tenant]);

    // ribbon: Related = the other screens of this screen's menu group, Reports = the matching report group
    const hereGroup = useMemo(() => {
        const path = location.pathname;
        for (const m of menus) for (const g of m.groups) if (g.items.some(it => it.to === current || it.to.split('?')[0] === path)) return { menu: m, group: g };
        return null;
    }, [menus, current, location.pathname]);
    const related = hereGroup ? hereGroup.group.items.filter(it => it.to !== current) : [];
    const reports = useMemo(() => {
        if (!hereGroup) return [];
        const groups = visibleReportGroups(features);
        const own = groups.find(g => g.title === hereGroup.group.title);
        if (own) return own.items.map(([to, label]) => ({ to, label }));
        const text = `${hereGroup.menu.title} ${hereGroup.group.title} ${here?.label || ''}`;
        const hit = REPORT_FOR.find(([re]) => re.test(text));
        const g = hit && groups.find(x => x.title === hit[1]);
        return g ? g.items.map(([to, label]) => ({ to, label })) : [];
    }, [hereGroup, here, features]);

    const q = search.trim().toLowerCase();
    const found = q ? allItems.filter(it => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)).slice(0, 40) : [];

    // the drop-down is one panel under the menu title with every sub-menu as a column:
    // nothing flies out sideways, so nothing covers another list
    const placeMenu = (m, el) => {
        const r = el.getBoundingClientRect();
        const cols = Math.min(m.groups.length, window.innerWidth >= 1200 ? 4 : 3);
        const width = Math.min(cols * 250 + 8, window.innerWidth - 16);
        const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        setMenuPos({ top: r.bottom, left, width });
    };
    const toggleMenu = (m, el) => {
        placeMenu(m, el);
        setOpenMenu(o => (o === m.key ? null : m.key));
    };
    const hoverMenu = (m, el) => {
        if (!openMenu || openMenu === m.key) return;
        placeMenu(m, el);
        setOpenMenu(m.key);
    };
    const cols = Math.max(1, Math.round((menuPos.width - 8) / 250));
    const dropdown = m => (
        <div ref={panelRef} className="nav-mega no-print" role="menu" style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {m.groups.map(g => (
                <div key={g.title} className="nav-mega-group">
                    {m.groups.length > 1 && <div className="nav-submenu-title">{g.title}</div>}
                    {g.items.map(it => <MenuLink key={it.to} item={it} className={`nav-dropdown-item ${current === it.to ? 'hot' : ''}`} />)}
                </div>
            ))}
        </div>
    );

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
                    <span>Aakash Business ERP - {tenant?.company_name || ''}</span>
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
                    <div key={m.key} className={`nav-menuitem hidden md:block ${openMenu === m.key ? 'open' : ''}`} onMouseEnter={e => hoverMenu(m, e.currentTarget)}>
                        <button type="button" className="nav-menu-btn" onClick={e => toggleMenu(m, e.currentTarget.parentElement)} aria-haspopup="menu" aria-expanded={openMenu === m.key}>{m.title}</button>
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
                <div className={`nav-window nav-page ${maxed ? 'max' : ''}`}>
                    <div className="nav-titlebar nav-page-titlebar no-print">
                        <div className="nav-titlebar-left">
                            <div className="nav-titlebar-icon">{screenIcon}</div>
                            <span>{screenTitle}</span>
                        </div>
                        <div className="nav-window-controls">
                            <button type="button" className="nav-wc-btn" title={collapsed ? 'Restore' : 'Minimise'} onClick={() => setCollapsed(v => !v)}>—</button>
                            <button type="button" className="nav-wc-btn" title={maxed ? 'Window' : 'Maximise'} onClick={toggleMax}>{maxed ? '❐' : '□'}</button>
                            <button type="button" className="nav-wc-btn close" title="Close (back to Dashboard)" disabled={location.pathname === '/dashboard'} onClick={() => navigate('/dashboard')}>✕</button>
                        </div>
                    </div>
                    {!collapsed && (
                        <>
                            <div className="nav-ribbon no-print">
                                {[['home', 'Home'], ['related', 'Related'], ['reports', 'Reports']].map(([k, l]) => (
                                    (k === 'home' || (k === 'related' ? related.length : reports.length) > 0) && (
                                        <button type="button" key={k} className={`nav-ribbon-tab ${ribbon === k ? 'active' : ''}`} onClick={() => setRibbon(k)}>{l}</button>
                                    )
                                ))}
                                {hereGroup && <span className="nav-ribbon-path">{hereGroup.menu.title} › {hereGroup.group.title}</span>}
                            </div>
                            <div className="nav-toolbar nav-page-toolbar no-print">
                                {ribbon === 'home' && (
                                    <>
                                        <button type="button" className="nav-tool-btn" onClick={() => navigate(-1)}>◀ Back</button>
                                        <button type="button" className="nav-tool-btn" onClick={() => window.location.reload()}>🔄 Refresh</button>
                                        <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨 Print</button>
                                        <span className="nav-tool-sep" />
                                        <Link to="/dashboard" className="nav-tool-btn">🏠 Dashboard</Link>
                                        <Link to="/reports" className="nav-tool-btn">📚 Report Center</Link>
                                    </>
                                )}
                                {ribbon === 'related' && related.map(it => <MenuLink key={it.to} item={it} className="nav-tool-btn" />)}
                                {ribbon === 'reports' && reports.map(it => <MenuLink key={it.to} item={it} className="nav-tool-btn" />)}
                            </div>
                            <div className="nav-page-body">{children}</div>
                        </>
                    )}
                </div>
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
