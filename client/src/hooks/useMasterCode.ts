// =============================================
// hooks/useMasterCode.ts
// Create forms of masters: the code the record will get (read-only,
// e.g. 8182LDG000001) and a suggested short name from the name (TPA00001)
// that the user may change. Server: routes/masterCodeRoutes.js.
// =============================================
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { AuthFetch } from '../types/erp';

interface Next { code: string; short_name: string }

/**
 * const { code, shortName } = useMasterCode('ledger', form.account_name, !editingId);
 * Pass creating=false while editing an existing record (nothing is fetched).
 * refreshKey: bump after a save so the next form shows the next number.
 */
export default function useMasterCode(master: string, name: string, creating: boolean, refreshKey: unknown = 0): { code: string; shortName: string } {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [code, setCode] = useState('');
    const [shortName, setShortName] = useState('');
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => {
        if (!creating) { setCode(''); return undefined; }
        let live = true;
        authFetch<Next>(`/api/master-codes/next?master=${master}`).then(r => { if (live) setCode(r.data.code); }).catch(() => undefined);
        return () => { live = false; };
    }, [authFetch, master, creating, refreshKey]);
    useEffect(() => {
        if (!creating || !name || !name.trim()) { setShortName(''); return undefined; }
        clearTimeout(timer.current);
        let live = true;
        timer.current = setTimeout(() => {
            authFetch<Next>(`/api/master-codes/next?master=${master}&name=${encodeURIComponent(name.trim())}`).then(r => { if (live) setShortName(r.data.short_name); }).catch(() => undefined);
        }, 350);
        return () => { live = false; clearTimeout(timer.current); };
    }, [authFetch, master, name, creating]);
    return { code, shortName };
}
