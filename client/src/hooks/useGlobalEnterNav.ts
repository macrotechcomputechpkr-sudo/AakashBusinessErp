// =============================================
// useGlobalEnterNav.ts
// Enter = next field on EVERY screen inside <Layout>, not only the entry
// forms that call useEnterKeyNavigation: report filter bars, dashboards,
// settings pages. Enter on the last field of a report card runs its
// Show / Search button.
// Skipped when a field already handled Enter (its own handler called
// preventDefault / stopPropagation - entry forms, popup pickers, grid
// cells), inside [data-enter-nav="off"] (grids, popups), and on
// textareas / buttons.
// =============================================
import { RefObject, useEffect } from 'react';
import { focusNextInScope, enterScopeOf } from './useEnterKeyNavigation';

export default function useGlobalEnterNav(ref: RefObject<HTMLElement>): void {
    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
            const t = e.target as HTMLElement | null;
            if (!t || !(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
            if (t.closest('[data-enter-nav="off"]')) return;
            if (t instanceof HTMLInputElement && ['button', 'submit', 'reset', 'file'].includes(t.type)) return;
            const scope = enterScopeOf(t) as HTMLElement | null;
            if (!scope) return;
            e.preventDefault();
            focusNextInScope(scope, t);
        };
        root.addEventListener('keydown', onKey);
        return () => root.removeEventListener('keydown', onKey);
    }, [ref]);
}
