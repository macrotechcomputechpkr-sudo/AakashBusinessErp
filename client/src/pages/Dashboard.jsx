// =============================================
// Dashboard.jsx (FIXED)
// FIX 1: called `/api/tenant/:id/dashboard` which never existed on the
//        backend -> added in server/routes/dashboardRoutes.js.
// FIX 2: used `requiresCompanyCreation` from AuthContext, which is now
//        correctly derived from the API's `requires_company_creation`
//        field instead of a non-existent `user.tenant.is_company_created`.
// FIX 3: no direct Supabase client / tenant db keys in the browser - all
//        calls go through authFetch (our own API).
// FIX 4: now uses the shared <Layout> (with nav) instead of duplicating
//        its own header + tenant switcher, matching every other page.
// =============================================

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const Dashboard = () => {
    const { tenant, tenants, requiresCompanyCreation, authFetch } = useAuth();
    const navigate = useNavigate();
    const [dashboardData, setDashboardData] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (requiresCompanyCreation) {
            navigate('/company-creation');
            return;
        }
        if (tenant?.id) fetchDashboardData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenant, requiresCompanyCreation]);

    const fetchDashboardData = async () => {
        setLoading(true);
        try {
            const data = await authFetch(`/api/tenant/${tenant.id}/dashboard`);
            if (data.success) setDashboardData(data.data);
        } catch (error) {
            console.error('Error fetching dashboard:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout>
            <div className="max-w-6xl mx-auto p-6">
                <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <p className="text-sm text-gray-500">Tenant Code</p>
                            <p className="text-lg font-semibold text-gray-900">{tenant?.tenant_code}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Company</p>
                            <p className="text-lg font-semibold text-gray-900">{tenant?.company_name}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Companies you can access</p>
                            <p className="text-lg font-semibold text-gray-900">{tenants.length}</p>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-12">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                ) : dashboardData && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <p className="text-sm text-gray-500">Total Users</p>
                            <p className="text-2xl font-bold text-gray-900">{dashboardData.total_users || 0}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <p className="text-sm text-gray-500">Fiscal Years</p>
                            <p className="text-2xl font-bold text-gray-900">{dashboardData.total_fiscal_years || 0}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <p className="text-sm text-gray-500">Current FY</p>
                            <p className="text-lg font-semibold text-gray-900">{dashboardData.current_fiscal_year?.fiscal_year_code || 'N/A'}</p>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
};

export default Dashboard;
