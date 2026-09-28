// =============================================
// components/help/useFieldTips.js
// Field help right on the form: every caption (.erp-label) and grid column
// header in the page body that the glossary knows gets a tooltip with what
// the field does and where its effect goes (dotted underline, help cursor).
// Works on every screen without touching the screens: a MutationObserver
// picks up forms and popups as they open.
// =============================================
import { useEffect } from 'react';
import { loadHelpCatalog, normCaption } from './helpCatalog';

const SELECTOR = '.erp-label, .erp-grid-table th, table th';

export default function useFieldTips(rootRef, deps = []) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        let catalog = null, timer = null, stopped = false;
        const apply = () => {
            if (!catalog || stopped) return;
            root.querySelectorAll(SELECTOR).forEach(el => {
                if (el.dataset.helpDone) return;
                el.dataset.helpDone = '1';
                // caption text without the hint / required star children
                const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
                const key = normCaption(own || el.textContent, catalog.aliases);
                const text = catalog.fields[key];
                if (!text) return;
                if (!el.getAttribute('title')) el.setAttribute('title', `${key}: ${text}`);
                el.classList.add('has-help');
            });
        };
        loadHelpCatalog().then(c => { catalog = c; apply(); });
        const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 200); });
        obs.observe(root, { childList: true, subtree: true });
        return () => { stopped = true; obs.disconnect(); clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
