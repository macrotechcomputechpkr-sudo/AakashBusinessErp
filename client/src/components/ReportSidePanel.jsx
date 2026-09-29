// =============================================
// ReportSidePanel.jsx - a report's options and filters in a side panel
// Closed: only a thin tab on the left edge ("⚙ Options & Filters"), so the
// report itself uses the whole screen and shows only its own tools (grid
// filter, 📁 Views / Save As …).
// Open: a panel slides in from the left with the report's options; OK
// runs the report (the page closes the panel once the report is shown),
// Cancel / ✕ / Esc just hide it again.
// Usage:
//   <ReportSidePanel open={open} onOpen={..} onClose={..} onOk={run} loading={loading}
//       summary="2026-01-01 → 2026-09-29 · Summary">…options…</ReportSidePanel>
// The panel is position: fixed, so hooks/useCompactFilters leaves its boxes alone.
// =============================================
import React, { useEffect } from 'react';

export default function ReportSidePanel({ open, onOpen, onClose, onOk, loading, title = 'Options & Filters', okLabel = 'OK - Show Report', summary, children }) {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) {
        return (
            <button type="button" onClick={onOpen} className="rsp-tab no-print" title={`${title}${summary ? ` - ${summary}` : ''}`} data-enter-skip="1">
                <span>⚙ {title}</span>
            </button>
        );
    }
    return (
        <>
            <div className="rsp-backdrop no-print" onClick={onClose} />
            <aside className="rsp-panel no-print" role="dialog" aria-label={title}>
                <div className="rsp-head">
                    <b>⚙ {title}</b>
                    <button type="button" onClick={onClose} title="Hide (Esc)" className="rsp-x">◀ Hide</button>
                </div>
                <div className="rsp-body">{children}</div>
                <div className="rsp-foot">
                    <button type="button" className="erp-btn primary" disabled={loading} onClick={onOk}>{loading ? 'Loading…' : `✔ ${okLabel}`}</button>
                    <button type="button" className="erp-btn" onClick={onClose}>Cancel</button>
                </div>
            </aside>
        </>
    );
}
