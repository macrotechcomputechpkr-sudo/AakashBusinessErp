// =============================================
// components/help/helpCatalog.js
// The in-system help (built by docs/tools/build_help.py into
// public/help/helpCatalog.json): per screen - purpose, steps, effect on
// accounts / stock / VAT, fields - and the caption glossary used for the
// tooltips on every form. Loaded once, on first use.
// =============================================
import { useEffect, useState } from 'react';

let cache = null;
let pending = null;

export function loadHelpCatalog() {
    if (cache) return Promise.resolve(cache);
    if (!pending) {
        pending = fetch('/help/helpCatalog.json')
            .then(r => (r.ok ? r.json() : { pages: {}, fields: {}, aliases: {} }))
            .catch(() => ({ pages: {}, fields: {}, aliases: {} }))
            .then(c => { cache = c; return c; });
    }
    return pending;
}

export function useHelpCatalog() {
    const [c, setC] = useState(cache);
    useEffect(() => { if (!cache) loadHelpCatalog().then(setC); }, []);
    return c;
}

/** caption text as on the screen -> the glossary key */
export function normCaption(text, aliases = {}) {
    const t = String(text || '').replace(/\s+/g, ' ').replace(/\*/g, '').replace(/\(.*?\)/g, '').trim();
    return aliases[t] || t;
}

/** help of the page at this pathname (longest matching base path) */
export function pageHelp(catalog, pathname) {
    if (!catalog) return null;
    const p = String(pathname || '').replace(/\/+$/, '') || '/';
    if (catalog.pages[p]) return catalog.pages[p];
    const keys = Object.keys(catalog.pages).filter(k => p.startsWith(k + '/')).sort((a, b) => b.length - a.length);
    return keys.length ? catalog.pages[keys[0]] : null;
}
