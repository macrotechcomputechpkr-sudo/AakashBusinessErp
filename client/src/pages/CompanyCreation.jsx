// =============================================
// CompanyCreation.jsx (FIXED)
// FIX 1: uses authFetch (context) instead of raw fetch + manually reading
//        localStorage token.
// FIX 2: a regular (non-super-admin) user's payload no longer sends
//        db_host/db_anon_key/db_service_key at all - the backend already
//        knows the tenant's DB connection server-side (see
//        companyRoutes.js), so the browser never needs to touch it. Only
//        the super-admin "provision a brand new tenant" path asks for
//        those fields, since that is a one-time admin/ops action.
// =============================================

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const nepalProvinces = ['Province 1', 'Province 2', 'Bagmati', 'Gandaki', 'Lumbini', 'Karnali', 'Sudurpashchim'];

const companyTypes = [
    { value: 'private', label: 'Private Limited Company' },
    { value: 'public', label: 'Public Limited Company' },
    { value: 'sole_proprietorship', label: 'Sole Proprietorship' },
    { value: 'partnership', label: 'Partnership Firm' },
    { value: 'non_profit', label: 'Non-Profit Organization' }
];

const emptyForm = {
    company_name: '', tenant_code: '', registration_number: '', pan_number: '', vat_number: '',
    cin_number: '', company_type: 'private', industry_type: '', business_category: '',
    province: '', district: '', municipality: '', ward_number: '', address_line1: '', address_line2: '',
    contact_person: '', contact_designation: '', contact_email: '', contact_phone: '', contact_mobile: '',
    tax_office: '', tax_payer_type: 'entity', fiscal_year_start_month: 7, fiscal_year_start_day: 16,
    accounting_standard: 'NFRS',
    // Only used for the super-admin "brand new tenant" path:
    db_host: '', db_name: '', db_anon_key: '', db_service_key: ''
};

const CompanyCreation = () => {
    const { isSuperAdmin, tenants, authFetch } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedTenant, setSelectedTenant] = useState('');
    const [isNewTenant, setIsNewTenant] = useState(false);
    const [formData, setFormData] = useState(emptyForm);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // FIX: build the payload conditionally instead of always including
            // db_* fields (which used to be read from `user.tenant.db_host`
            // etc - fields that no longer exist on the client at all).
            const payload = { ...formData };
            if (!isSuperAdmin) {
                delete payload.db_host;
                delete payload.db_name;
                delete payload.db_anon_key;
                delete payload.db_service_key;
                delete payload.tenant_code; // regular user's own tenant is resolved from their JWT
            } else if (selectedTenant && !isNewTenant) {
                payload.tenant_code = selectedTenant;
                delete payload.db_host;
                delete payload.db_name;
                delete payload.db_anon_key;
                delete payload.db_service_key;
            } else {
                delete payload.tenant_code; // let backend generate a new tenant_code
            }

            const data = await authFetch('/api/company/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (!data.success) throw new Error(data.error || 'Company creation failed');

            navigate('/dashboard');
        } catch (err) {
            setError(err.message || 'Failed to create company');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-4xl mx-auto px-4">
                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4">
                        <h2 className="text-2xl font-bold text-white">
                            {isSuperAdmin ? 'Create Company for Tenant' : 'Complete Your Company Registration'}
                        </h2>
                        <p className="text-blue-100 text-sm mt-1">
                            {isSuperAdmin ? 'Super Admin: create a company profile for any tenant' : 'Fill in the company details as per Nepal taxation rules'}
                        </p>
                    </div>

                    {error && (
                        <div className="mx-6 mt-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
                    )}

                    <form ref={formRef} onSubmit={handleSubmit} className="p-6">
                        {isSuperAdmin && (
                            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg space-y-3">
                                <label className="flex items-center gap-2 text-sm font-medium text-yellow-800">
                                    <input type="checkbox" checked={isNewTenant} onChange={e => setIsNewTenant(e.target.checked)} />
                                    Provision a brand new tenant (needs a fresh Supabase project)
                                </label>

                                {!isNewTenant ? (
                                    <div>
                                        <label className="block text-sm font-medium text-yellow-800 mb-2">Select existing tenant</label>
                                        <select value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)} className="w-full px-3 py-2 border border-yellow-300 rounded-lg bg-white" required>
                                            <option value="">Select a tenant...</option>
                                            {tenants?.map(t => (
                                                <option key={t.id} value={t.tenant_code}>
                                                    {t.company_name || t.tenant_code}{t.is_company_created ? ' (Already Created)' : ' (Pending)'}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <input name="db_host" value={formData.db_host} onChange={handleChange} placeholder="https://xxxx.supabase.co" className="erp-input" required />
                                        <input name="db_name" value={formData.db_name} onChange={handleChange} placeholder="tenant DB name" className="erp-input" required />
                                        <input name="db_anon_key" value={formData.db_anon_key} onChange={handleChange} placeholder="anon key" className="erp-input" required />
                                        <input name="db_service_key" value={formData.db_service_key} onChange={handleChange} placeholder="service role key (kept server-side only)" className="erp-input" />
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="col-span-2"><h3 className="text-lg font-semibold text-gray-900 mb-3">Basic Information</h3></div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                                <input type="text" name="company_name" value={formData.company_name} onChange={handleChange} className="erp-input" required />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Company Type *</label>
                                <select name="company_type" value={formData.company_type} onChange={handleChange} className="erp-input" required>
                                    {companyTypes.map(type => (<option key={type.value} value={type.value}>{type.label}</option>))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Registration Number</label>
                                <input type="text" name="registration_number" value={formData.registration_number} onChange={handleChange} className="erp-input" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number *</label>
                                <input type="text" name="pan_number" value={formData.pan_number} onChange={handleChange} placeholder="e.g., 123456789" className="erp-input" required />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Industry Type</label>
                                <input type="text" name="industry_type" value={formData.industry_type} onChange={handleChange} placeholder="e.g., Retail, Manufacturing" className="erp-input" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Business Category</label>
                                <input type="text" name="business_category" value={formData.business_category} onChange={handleChange} className="erp-input" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Payer Type</label>
                                <select name="tax_payer_type" value={formData.tax_payer_type} onChange={handleChange} className="erp-input">
                                    <option value="entity">Entity</option>
                                    <option value="individual">Individual</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label>
                                <input type="text" name="vat_number" value={formData.vat_number} onChange={handleChange} className="erp-input" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">CIN Number</label>
                                <input type="text" name="cin_number" value={formData.cin_number} onChange={handleChange} className="erp-input" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Office</label>
                                <input type="text" name="tax_office" value={formData.tax_office} onChange={handleChange} className="erp-input" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Accounting Standard</label>
                                <select name="accounting_standard" value={formData.accounting_standard} onChange={handleChange} className="erp-input">
                                    <option value="NFRS">NFRS</option>
                                    <option value="IFRS">IFRS</option>
                                    <option value="Cash Basis">Cash Basis</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                            <div className="col-span-2"><h3 className="text-lg font-semibold text-gray-900 mb-3">Address (Nepal)</h3></div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Province *</label>
                                <select name="province" value={formData.province} onChange={handleChange} className="erp-input" required>
                                    <option value="">Select province...</option>
                                    {nepalProvinces.map(p => (<option key={p} value={p}>{p}</option>))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">District *</label>
                                <input type="text" name="district" value={formData.district} onChange={handleChange} className="erp-input" required />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Municipality</label>
                                <input type="text" name="municipality" value={formData.municipality} onChange={handleChange} className="erp-input" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Ward Number</label>
                                <input type="text" name="ward_number" value={formData.ward_number} onChange={handleChange} className="erp-input" />
                            </div>

                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1 *</label>
                                <input type="text" name="address_line1" value={formData.address_line1} onChange={handleChange} placeholder="e.g., Putalisadak, Kathmandu" className="erp-input" required />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
                                <input type="text" name="address_line2" value={formData.address_line2} onChange={handleChange} className="erp-input" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                            <div className="col-span-2"><h3 className="text-lg font-semibold text-gray-900 mb-3">Contact Information</h3></div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person *</label>
                                <input type="text" name="contact_person" value={formData.contact_person} onChange={handleChange} className="erp-input" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Designation</label>
                                <input type="text" name="contact_designation" value={formData.contact_designation} onChange={handleChange} className="erp-input" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email *</label>
                                <input type="email" name="contact_email" value={formData.contact_email} onChange={handleChange} className="erp-input" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                                <input type="text" name="contact_phone" value={formData.contact_phone} onChange={handleChange} className="erp-input" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number *</label>
                                <input type="text" name="contact_mobile" value={formData.contact_mobile} onChange={handleChange} placeholder="9841234567" className="erp-input" required />
                            </div>
                        </div>

                        <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-gray-200">
                            <button type="button" onClick={() => navigate('/dashboard')} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                            <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                {loading ? 'Creating...' : 'Create Company'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default CompanyCreation;
