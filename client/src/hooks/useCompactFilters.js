// =============================================
// useCompactFilters.js - only dates (and the report's own choices) up top
// On a report screen (one with a Show / Run button, not an entry screen)
// the filter boxes for product group / company / category, item, party,
// area, route, agent, branch, warehouse, cost centre, search … are folded
// away while they are empty ("All"): those are filtered in the report grid
// instead (📋 Columns → Filters / Rows / Columns, ▾ in a header; the grid
// knows each item's and party's attributes - components/grid/dimensions.js).
// A "⚙ More filters (n)" button next to Show opens them again (kept per
// browser); a box that already has a value always stays in sight.
// Dates, report / view / rows-by choices and tick boxes are never folded.
// Folded boxes carry data-sg-dim; index.css hides them unless the screen
// has data-sg-dims="open".
// =============================================
import { useEffect } from 'react';

const DIM_RE = /product\s*(group|company|category|categor)|^item\b|^product\b|^items?\s*$|customer|supplier|vendor|\bparty\b|^area|\broute\b|salesman|\bagent\b|branch|warehouse|cost\s*cent|profit\s*cent|business\s*unit|\bbrand\b|categor|sub-?ledger|account\s*group|^search|bill\s*no|^pan\b|^company$|amount\s*[≥≤<>]|doc(ument)?\s*class|^unit$/i;
const KEEP_RE = /date|from|^to$|period|month|year|as\s*on|report|view|rows?\s*(by|-)|columns?|type|show|sort|compare|module|ledger$|^ledger|account$|basis|method|include|language|level|top\s*n/i;
const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').replace(/[*▾]/g, '').trim();
const KEY = 'sg_dims_open';

function runButton(root) {
    const btns = Array.from(root.querySelectorAll('button')).filter(b => !b.disabled && !b.closest('table, .sg-mount, [data-no-view], form')
        && /(^|\s|🔍|▶)(show|run|generate|load|view report|refresh report)\b/i.test(txt(b)));
    return btns.find(b => b.classList.contains('primary')) || btns[0] || null;
}
/** a filter box with nothing chosen ("All", empty, none ticked) */
function isEmpty(field) {
    const ctl = Array.from(field.querySelectorAll('select, input:not([type=checkbox]):not([type=radio]), button.erp-select'));
    if (!ctl.length) return false;
    return ctl.every(c => {
        if (c.tagName === 'SELECT') { const o = c.options[c.selectedIndex]; return !c.value || /^(all|any|-+|— ?all.*)$/i.test(txt(o)); }
        if (c.tagName === 'BUTTON') return /^(all|any|select…?|)$/i.test(txt(c));
        return !c.value || /^all\b/i.test(c.value);
    });
}

export default function useCompactFilters(ref, path) {
    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        let timer = null;
        const open = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
        const scan = () => {
            const btn = runButton(root);
            const entry = root.querySelector('.ent-fillbar');
            let n = 0;
            root.querySelectorAll('.erp-field').forEach(f => {
                const label = txt(f.querySelector('.erp-label, label'));
                const fold = !!btn && !entry && !f.closest('table, form, .sg-mount, [data-no-view], [data-no-fold], .fixed, [role="dialog"]')
                    && DIM_RE.test(label) && !KEEP_RE.test(label) && isEmpty(f);
                if (fold) { n += 1; if (!f.hasAttribute('data-sg-dim')) f.setAttribute('data-sg-dim', '1'); }
                else if (f.hasAttribute('data-sg-dim')) f.removeAttribute('data-sg-dim');
            });
            let t = root.querySelector('[data-sg-dimbtn]');
            if (!btn || !n) { if (t) t.remove(); root.removeAttribute('data-sg-dims'); return; }
            if (!t) {
                t = document.createElement('button');
                t.type = 'button';
                t.setAttribute('data-sg-dimbtn', '1');
                t.setAttribute('data-enter-skip', '1');
                t.className = 'erp-btn no-print';
                t.title = 'Product group, company, party, area … - or filter them in the grid below (📋 Columns → Filters / Rows)';
                t.addEventListener('click', () => {
                    const o = root.getAttribute('data-sg-dims') !== 'open';
                    try { localStorage.setItem(KEY, o ? '1' : '0'); } catch { /* blocked */ }
                    scan();
                });
            }
            if (t.previousElementSibling !== btn) btn.insertAdjacentElement('afterend', t);
            const isOpen = open();
            root.setAttribute('data-sg-dims', isOpen ? 'open' : 'closed');
            const label = `⚙ ${isOpen ? 'Fewer' : 'More'} filters (${n})`;
            if (t.textContent !== label) t.textContent = label;
        };
        const observer = new MutationObserver(list => {
            if (list.every(m => { const el = m.target.nodeType === 1 ? m.target : m.target.parentElement; return !!el?.closest('.sg-mount, [data-sg-dimbtn]'); })) return;
            clearTimeout(timer);
            timer = setTimeout(scan, 150);
        });
        observer.observe(root, { childList: true, subtree: true });
        // a value chosen in a box keeps it in sight
        const onChange = () => { clearTimeout(timer); timer = setTimeout(scan, 150); };
        root.addEventListener('change', onChange);
        scan();
        return () => {
            observer.disconnect(); clearTimeout(timer); root.removeEventListener('change', onChange);
            root.querySelectorAll('[data-sg-dim]').forEach(f => f.removeAttribute('data-sg-dim'));
            root.querySelector('[data-sg-dimbtn]')?.remove();
            root.removeAttribute('data-sg-dims');
        };
    }, [ref, path]);
}
