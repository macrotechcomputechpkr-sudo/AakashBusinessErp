// =============================================
// grid/gridRegistry.js
// Lets 📁 Views (components/ReportViews.jsx) save and bring back the full
// state of every ReportGrid on a screen - filters, search, sort levels,
// groups, footers, added columns, data bars, chart - not only the layout
// ReportGrid keeps in localStorage.
// Each mounted grid registers { get, set } under its storageKey (and sets
// data-rg-key on its root element). A state for a grid that is not on the
// screen yet (report still loading) waits in `pending` and is applied by
// the grid when it mounts.
// =============================================
const grids = new Map();
const pending = new Map();

export function registerGrid(key, api) {
    grids.set(key, api);
    return () => { if (grids.get(key) === api) grids.delete(key); };
}
/** a state saved for this grid, waiting for it to mount (read once) */
export function takePending(key) {
    const s = pending.get(key);
    pending.delete(key);
    return s;
}
/** { [storageKey]: state } of the grids inside root */
export function captureGrids(root) {
    const out = {};
    if (!root) return out;
    root.querySelectorAll('[data-rg-key]').forEach(el => {
        const key = el.getAttribute('data-rg-key');
        const api = grids.get(key);
        if (api) out[key] = api.get();
    });
    return out;
}
export function restoreGrids(states) {
    pending.clear();
    Object.entries(states || {}).forEach(([key, st]) => {
        const api = grids.get(key);
        if (api) api.set(st); else pending.set(key, st);
    });
}
export function resetGrids(root) {
    pending.clear();
    if (!root) return;
    root.querySelectorAll('[data-rg-key]').forEach(el => grids.get(el.getAttribute('data-rg-key'))?.set(null));
}
