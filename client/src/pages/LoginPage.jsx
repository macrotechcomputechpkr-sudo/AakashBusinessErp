// =============================================
// LoginPage.jsx (FIXED)
// FIX: the old page called login(email, password) only. The fixed backend
// can return 409 "email exists in multiple companies" and expects a
// tenant_code to disambiguate - this page now has that field (only shown
// when needed) and reads `requires_company_creation` from the response to
// route correctly, instead of the old always-wrong nested-tenant check.
// =============================================

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const LoginPage = () => {
    const { login, loading, error } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [tenantCode, setTenantCode] = useState('');
    const [needsTenantCode, setNeedsTenantCode] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState('');
    // FIX: this form had no Enter-key navigation at all, unlike every
    // other form in the app (Chart of Accounts, User Management, etc.) -
    // added for consistency, even though a 2-3 field login form mostly
    // relies on the browser's native Enter-submits-on-last-field behavior
    // anyway; this also makes the conditional "Company Code" field (shown
    // after a 409 multi-tenant response) advance correctly instead of
    // submitting early.
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLocalError('');
        try {
            const data = await login(email, password, tenantCode || undefined);
            if (data.requires_company_creation) {
                navigate('/company-creation');
            } else {
                navigate('/dashboard');
            }
        } catch (err) {
            // FIX: backend returns 409 when the same email exists under more
            // than one tenant - surface the tenant-code field instead of
            // just showing a generic failure.
            if (err.status === 409) {
                setNeedsTenantCode(true);
                setLocalError(err.message);
            } else {
                setLocalError(err.message);
            }
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Welcome Back</h1>
                    <p className="text-gray-500 mt-1">Sign in to your account</p>
                </div>

                {(error || localError) && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                        {localError || error}
                    </div>
                )}

                <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="you@company.com"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                                placeholder="Enter your password"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? '🙈' : '👁️'}
                            </button>
                        </div>
                    </div>

                    {needsTenantCode && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Code</label>
                            <input
                                type="text"
                                value={tenantCode}
                                onChange={(e) => setTenantCode(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="e.g. aakash_pkr"
                                required
                            />
                            <p className="text-xs text-gray-400 mt-1">Your email is registered under more than one company - enter the company code to continue.</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;
