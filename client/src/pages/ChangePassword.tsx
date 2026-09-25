// =============================================
// ChangePassword.tsx  (/change-password)
// Set a new password. Users signing in with a default password
// (superadmin@businesserp.com.np, admin@businesserp.com.np) are sent here
// and cannot open anything else until they do.
// =============================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { AuthFetch } from '../types/erp';

export default function ChangePassword() {
    const { authFetch, user, passwordChanged, logout, requiresCompanyCreation } = useAuth() as {
        authFetch: AuthFetch; user: { email?: string; must_change_password?: boolean } | null; passwordChanged: () => void; logout: () => Promise<void>; requiresCompanyCreation: boolean
    };
    const navigate = useNavigate();
    const [f, setF] = useState({ current: '', next: '', again: '' });
    const [show, setShow] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const forced = !!user?.must_change_password;
    const strong = f.next.length >= 8 && /[A-Za-z]/.test(f.next) && /\d/.test(f.next);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!strong) return setError('At least 8 characters with letters and numbers');
        if (f.next !== f.again) return setError('The two new passwords are not the same');
        setBusy(true);
        try {
            await authFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: f.current, new_password: f.next }) });
            passwordChanged();
            navigate(requiresCompanyCreation ? '/company-creation' : '/dashboard', { replace: true });
        } catch (e2) { setError((e2 as Error).message); }
        finally { setBusy(false); }
    };
    const input = (k: keyof typeof f, label: string, auto: string) => (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input type={show ? 'text' : 'password'} autoComplete={auto} required value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
        </div>
    );
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 space-y-4">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">🔑 Set your password</h1>
                    <p className="text-sm text-gray-600 mt-1">{forced ? `${user?.email} is signed in with a default password. Choose your own password to continue.` : 'Change the password you sign in with.'}</p>
                </div>
                {input('current', 'Current password', 'current-password')}
                {input('next', 'New password', 'new-password')}
                {input('again', 'New password again', 'new-password')}
                <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show passwords</label>
                <p className={`text-xs ${f.next && !strong ? 'text-red-600' : 'text-gray-500'}`}>At least 8 characters, with letters and numbers.</p>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button type="submit" disabled={busy} className="w-full py-2 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-60">{busy ? 'Saving…' : 'Save password'}</button>
                <div className="flex justify-between text-sm">
                    {!forced && <button type="button" className="text-gray-600 hover:underline" onClick={() => navigate(-1)}>Cancel</button>}
                    <button type="button" className="text-red-600 hover:underline ml-auto" onClick={async () => { await logout(); navigate('/login'); }}>Sign out</button>
                </div>
            </form>
        </div>
    );
}
