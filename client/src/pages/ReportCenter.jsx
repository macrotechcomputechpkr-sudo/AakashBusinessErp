// =============================================
// ReportCenter.jsx  (/reports)
// Every report of the system in one place, grouped, searchable; each card
// opens the report on the right tab / view (components/menu.js).
// =============================================
import React, { useState } from 'react';
import Layout from '../components/Layout';
import { REPORT_GROUPS, REPORT_COUNT } from '../components/menu';

export default function ReportCenter() {
    const [q, setQ] = useState('');
    const s = q.trim().toLowerCase();
    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">📚 Report Center · {REPORT_COUNT} reports</span></div>
                    <div className="erp-tab-content">
                        <input className="erp-input mb-4" style={{ maxWidth: 420 }} placeholder="🔍 Search reports (e.g. VAT, route, budget, stock)…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {REPORT_GROUPS.map(g => {
                                const items = g.items.filter(([, label]) => !s || label.toLowerCase().includes(s) || g.title.toLowerCase().includes(s));
                                if (!items.length) return null;
                                return (
                                    <div key={g.title} className="border rounded-lg p-3 bg-white">
                                        <p className="font-semibold text-sm mb-2">{g.title} <span className="text-xs text-gray-400">({items.length})</span></p>
                                        <ul className="space-y-1">
                                            {items.map(([to, label]) => <li key={to}><a href={to} className="text-sm text-blue-700 hover:underline">📊 {label}</a></li>)}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
