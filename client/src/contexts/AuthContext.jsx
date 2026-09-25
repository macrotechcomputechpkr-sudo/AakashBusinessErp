// =============================================
// AuthContext.jsx (FIXED + RESTORED)
// FIX 1: `requiresCompanyCreation` used to read `user?.tenant?.is_company_created`,
//        but the login API returns `tenant` as a SIBLING of `user`, never
//        nested inside it - so this was always `undefined` and the flag
//        never worked. Now `tenant` is stored in its own state and the flag
//        is read from the API's explicit `requires_company_creation` field.
// FIX 2: no Supabase client is created in the browser anymore, and no
//        db_host/db_anon_key/db_service_key ever reaches localStorage.
//        All tenant data access goes through our own API (authFetch
//        below), which is the only thing that should ever hold DB
//        credentials.
// FIX 3: switchTenant() now calls POST /api/auth/switch-tenant, which
//        re-checks the caller actually has access to the target tenant on
//        the server and returns a freshly-scoped JWT - instead of the old
//        approach of building a Supabase client in the browser with the
//        target tenant's own anon key.
// =============================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [tenant, setTenant] = useState(null);
    const [tenants, setTenants] = useState([]);
    const [requiresCompanyCreation, setRequiresCompanyCreation] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [initializing, setInitializing] = useState(true);

    useEffect(() => {
        const storedUser = localStorage.getItem('auth_user');
        const storedTenant = localStorage.getItem('auth_tenant');
        const storedTenants = localStorage.getItem('auth_tenants');
        const storedRequires = localStorage.getItem('auth_requires_company_creation');

        if (storedUser) setUser(JSON.parse(storedUser));
        if (storedTenant) setTenant(JSON.parse(storedTenant));
        if (storedTenants) setTenants(JSON.parse(storedTenants));
        if (storedRequires) setRequiresCompanyCreation(storedRequires === 'true');
        setInitializing(false);
    }, []);

    const persist = ({ token, user, tenant, tenants, requiresCompanyCreation }) => {
        if (token !== undefined) localStorage.setItem('auth_token', token);
        if (user !== undefined) { setUser(user); localStorage.setItem('auth_user', JSON.stringify(user)); }
        if (tenant !== undefined) { setTenant(tenant); localStorage.setItem('auth_tenant', JSON.stringify(tenant)); }
        if (tenants !== undefined) { setTenants(tenants); localStorage.setItem('auth_tenants', JSON.stringify(tenants)); }
        if (requiresCompanyCreation !== undefined) {
            setRequiresCompanyCreation(requiresCompanyCreation);
            localStorage.setItem('auth_requires_company_creation', String(!!requiresCompanyCreation));
        }
    };

    // Stable identity (reads the token at call time, uses no state), so the
    // many useEffect/useCallback deps on authFetch don't all re-fire whenever
    // this provider re-renders (login / tenant switch / loading flips).
    const authFetch = useCallback(async (path, options = {}) => {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(options.headers || {})
            }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.error || `Request failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return data;
    }, []);

    const login = async (email, password, tenant_code) => {
        setLoading(true);
        setError(null);
        try {
            const data = await authFetch('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password, tenant_code })
            });

            persist({
                token: data.token,
                user: data.user,
                tenant: data.tenant || null,
                tenants: data.tenants || [],
                requiresCompanyCreation: !!data.requires_company_creation
            });

            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        try {
            await authFetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {
            // ignore network/auth errors on logout - we still clear local state below
        } finally {
            setUser(null);
            setTenant(null);
            setTenants([]);
            setRequiresCompanyCreation(false);
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            localStorage.removeItem('auth_tenant');
            localStorage.removeItem('auth_tenants');
            localStorage.removeItem('auth_requires_company_creation');
        }
    };

    // FIX: real, secure tenant switching via the backend (see authRoutes.js
    // POST /switch-tenant), instead of instantiating a Supabase client in
    // the browser with the target tenant's anon key.
    const switchTenant = async (tenantId) => {
        setLoading(true);
        setError(null);
        try {
            const data = await authFetch('/api/auth/switch-tenant', {
                method: 'POST',
                body: JSON.stringify({ tenantId })
            });
            persist({
                token: data.token,
                tenant: data.tenant,
                requiresCompanyCreation: !!data.requires_company_creation
            });
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthContext.Provider value={{
            user, tenant, tenants, loading, error, initializing,
            login, logout, switchTenant, authFetch,
            isSuperAdmin: user?.is_global_admin || false,
            requiresCompanyCreation
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
