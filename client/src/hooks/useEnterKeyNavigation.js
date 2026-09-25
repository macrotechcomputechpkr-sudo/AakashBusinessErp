// =============================================
// useEnterKeyNavigation.js (REFACTORED)
// Now exports `focusNextInForm(form, fromEl, onLastField)` as a standalone
// utility, not just a hook side-effect, so custom controls (like
// SearchablePopupSelect) can advance the form the exact same way plain
// inputs do after their own Enter handling (open popup -> select item ->
// advance) instead of each control re-implementing "what is the next
// field" logic.
//
// Behavior recap:
// - Enter on a plain input/select advances to the next visible, enabled
//   field, or submits the form once on the very last field.
// - A field can opt out of this generic handling by calling
//   e.stopPropagation() in its own onKeyDown (this is what
//   SearchablePopupSelect does while its popup is open, so it can run its
//   own open/highlight/select flow instead).
// - FEATURE: forms split into tabs (only the active tab's fields exist in
//   the DOM) can pass `onLastField` - called instead of submitting when
//   there are no more fields in the CURRENT tab. It should switch to the
//   next relevant tab and focus its first field, returning true if it did
//   so (Enter then does nothing further) or false/undefined to fall back
//   to the normal submit behavior (i.e. this really was the last tab).
// =============================================

import { useEffect, useRef } from 'react';

// FIX: elements marked data-enter-skip are excluded from the tab-order
// walk entirely - found via deep-check that SearchablePopupSelect's own
// internal chrome (its preset <select>, its column-panel checkboxes)
// would otherwise get miscounted as "the next form field" the instant
// selectItem() calls setOpen(false) then immediately calls
// focusNextInForm() in the same tick - React hasn't re-rendered yet, so
// the popup's now-supposed-to-be-gone elements are still in the DOM at
// that exact moment and would wrongly intercept focus.
const FOCUSABLE_SELECTOR = [
    'input:not([type="hidden"]):not([disabled]):not([readonly]):not([data-enter-skip])',
    'select:not([disabled]):not([data-enter-skip])',
    'textarea:not([disabled]):not([data-enter-skip])',
    '[data-enter-focusable="true"]:not([disabled])'
].join(', ');

export function getVisibleFocusable(form) {
    const all = Array.from(form.querySelectorAll(FOCUSABLE_SELECTOR));
    return all.filter(el => el.offsetParent !== null);
}

// Moves focus from `fromEl` to the next focusable field in `form`, or
// submits the form if `fromEl` is the last one. Returns true if it moved
// focus (within the tab, or to a new tab via onLastField), false if it
// submitted instead.
export function focusNextInForm(form, fromEl, onLastField) {
    const visible = getVisibleFocusable(form);
    const currentIndex = visible.indexOf(fromEl);
    if (currentIndex === -1) return false;

    if (currentIndex < visible.length - 1) {
        const next = visible[currentIndex + 1];
        next.focus();
        if (typeof next.select === 'function' && next.tagName === 'INPUT') next.select();
        return true;
    }

    if (onLastField && onLastField()) return true;

    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return false;
}

export function useEnterKeyNavigation(formRef, options = {}) {
    // FIX: this used to attach ONCE on mount (useEffect(..., [formRef])).
    // Almost every entry page renders its <form> only after "New"/"Open"
    // ({showForm && <form ref={formRef}>}), so at mount formRef.current was
    // null, the effect bailed out, and - the ref object never changing -
    // it never ran again: Enter navigation silently did nothing on those
    // forms. Now it re-checks after every render and (re)attaches to
    // whatever form element currently sits in the ref. The listener stays
    // on the form element (same bubble order as before, so field-level
    // stopPropagation keeps working) and always sees the latest onLastField.
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const attachedRef = useRef(null);
    const listenerRef = useRef(null);
    if (!listenerRef.current) {
        listenerRef.current = (e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            const target = e.target;
            if (target.tagName === 'TEXTAREA') return; // allow multi-line input
            if (target.tagName === 'BUTTON') return;    // let native button behavior run
            const form = attachedRef.current;
            if (!form) return;
            const visible = getVisibleFocusable(form);
            if (visible.indexOf(target) === -1) return;
            e.preventDefault();
            focusNextInForm(form, target, optionsRef.current.onLastField);
        };
    }

    // Runs after every render: cheap identity check, re-attach only on change.
    useEffect(() => {
        const form = formRef.current || null;
        if (attachedRef.current === form) return;
        if (attachedRef.current) attachedRef.current.removeEventListener('keydown', listenerRef.current);
        if (form) form.addEventListener('keydown', listenerRef.current);
        attachedRef.current = form;
    });

    // Detach on unmount.
    useEffect(() => () => {
        if (attachedRef.current) attachedRef.current.removeEventListener('keydown', listenerRef.current);
        attachedRef.current = null;
    }, []);
}
