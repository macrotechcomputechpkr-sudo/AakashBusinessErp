// =============================================
// hooks/useAppFeatures.ts
// The company's Business Nature and the optional modules it switches on
// (System Control). Fetched once per company and shared by every screen;
// menus and pages use it to show Poultry / Hatchery only when turned on.
// Call refreshAppFeatures() after System Control is saved.
// =============================================
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { AuthFetch } from '../types/erp';
import type { AppFeatures } from '../components/menu';

let cache: { tenant: string; data: AppFeatures } | null = null;
let pending: Promise<AppFeatures | null> | null = null;
const listeners = new Set<(a: AppFeatures | null) => void>();

export function refreshAppFeatures(): void {
    cache = null;
    pending = null;
    listeners.forEach(fn => fn(null));
}

export default function useAppFeatures(): AppFeatures | null {
    const { authFetch, tenant } = useAuth() as { authFetch: AuthFetch; tenant: { id?: string } | null };
    const key = tenant?.id || '';
    const [data, setData] = useState<AppFeatures | null>(cache && cache.tenant === key ? cache.data : null);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const fn = () => setTick(t => t + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    useEffect(() => {
        let live = true;
        if (!key) { setData(null); return undefined; }
        if (cache && cache.tenant === key) { setData(cache.data); return undefined; }
        if (!pending) {
            pending = authFetch<AppFeatures>('/api/app-features')
                .then(r => { cache = { tenant: key, data: r.data }; return r.data; })
                .catch(() => null)
                .finally(() => { pending = null; });
        }
        pending.then(d => { if (live) setData(d); });
        return () => { live = false; };
    }, [authFetch, key, tick]);
    return data;
}
