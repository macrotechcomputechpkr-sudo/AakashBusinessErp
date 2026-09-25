// =============================================
// App.js (FIXED + COMPLETE)
// FIX: routing now checks `user` from context (populated on load from
// localStorage) instead of only checking raw token presence. Adds routes
// for every page that now actually exists and is wired to the backend:
// Users, Fiscal Years, Branches & Warehouses, Business Units.
// =============================================

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import CompanyCreation from './pages/CompanyCreation';
import UserManagement from './pages/UserManagement';
import FiscalYearManagement from './pages/FiscalYearManagement';
import BranchWarehouseManagement from './pages/BranchWarehouseManagement';
import BusinessUnitManagement from './pages/BusinessUnitManagement';
import ChartOfAccounts from './pages/ChartOfAccounts';
import RouteSequencing from './pages/RouteSequencing';
import ProductGroupManagement from './pages/ProductGroupManagement';
import SalesmanAgentManagement from './pages/SalesmanAgentManagement';
import SecurityGroupManagement from './pages/SecurityGroupManagement';
import ProductRateHistory from './pages/ProductRateHistory';
import BulkCashSettlement from './pages/BulkCashSettlement';
import DocumentDesigner from './pages/DocumentDesigner';
import PrintPreview from './pages/PrintPreview';
import UniversalRegister from './pages/UniversalRegister';
import CategoryManagement from './pages/CategoryManagement';
import OutstandingReport from './pages/OutstandingReport';
import VatReports from './pages/VatReports';
import PartySummaryReport from './pages/PartySummaryReport';
import FinancialReports from './pages/FinancialReports';
import StockMovementReport from './pages/StockMovementReport';
import StockReport from './pages/StockReport';
import StockInOutReport from './pages/StockInOutReport';
import StockValuationReport from './pages/StockValuationReport';
import SalesPurchaseAnalysis from './pages/SalesPurchaseAnalysis';
import RateHistoryReport from './pages/RateHistoryReport';
import LoadingSheet from './pages/LoadingSheet';
import AgeingReport from './pages/AgeingReport';
import PricingMasters from './pages/PricingMasters';
import LedgerReport from './pages/LedgerReport';
import LcRegister from './pages/LcRegister';
import LedgerMapping from './pages/LedgerMapping';
import CostProfitCenters from './pages/CostProfitCenters';
import BillingTermManagement from './pages/BillingTermManagement';
import SubLedgerManagement from './pages/SubLedgerManagement';
import SystemControlSettings from './pages/SystemControlSettings';
import EntryFieldControl from './pages/EntryFieldControl';
import ProductUnitManagement from './pages/ProductUnitManagement';
import ProductMaster from './pages/ProductMaster';
import LedgerOpeningEntry from './pages/LedgerOpeningEntry';
import ProductOpeningEntry from './pages/ProductOpeningEntry';
import ProductRateChange from './pages/ProductRateChange';
import ProductOfferRate from './pages/ProductOfferRate';
import RemarksTermsManagement from './pages/RemarksTermsManagement';
import UserDefinedFieldBuilder from './pages/UserDefinedFieldBuilder';
import TransportManagement from './pages/TransportManagement';
import PurchaseRequisition from './pages/PurchaseRequisition';
import PurchaseOrder from './pages/PurchaseOrder';
import PurchaseQuotation from './pages/PurchaseQuotation';
import PurchaseGrn from './pages/PurchaseGrn';
import PurchaseBill from './pages/PurchaseBill';
import PurchaseAdditionalExpense from './pages/PurchaseAdditionalExpense';
import PurchaseReturn from './pages/PurchaseReturn';
import PurchaseNonsaleableReturn from './pages/PurchaseNonsaleableReturn';
import BillWiseAgeingReport from './pages/BillWiseAgeingReport';
import JournalVoucher from './pages/JournalVoucher';
import StockTransfer from './pages/StockTransfer';
import DebitNote from './pages/DebitNote';
import CreditNote from './pages/CreditNote';
import PdcVoucher from './pages/PdcVoucher';
import ProductionOrder from './pages/ProductionOrder';
import CashBankEntry from './pages/CashBankEntry';
import BomTemplate from './pages/BomTemplate';
import SalesOrder from './pages/SalesOrder';
import SalesQuotation from './pages/SalesQuotation';
import SalesDelivery from './pages/SalesDelivery';
import SalesBill from './pages/SalesBill';
import SalesReturn from './pages/SalesReturn';
import SalesNonsaleableReturn from './pages/SalesNonsaleableReturn';
import SalesAdditionalEntry from './pages/SalesAdditionalEntry';
import GrnOutstandingReport from './pages/GrnOutstandingReport';
import PurchaseRegisterReport from './pages/PurchaseRegisterReport';
import DocumentNumberingManagement from './pages/DocumentNumberingManagement';

const PrivateRoute = ({ children }) => {
    const { user, initializing } = useAuth();
    const token = localStorage.getItem('auth_token');
    if (initializing) return null; // avoid a flash-redirect while localStorage loads
    return user || token ? children : <Navigate to="/login" replace />;
};

function AppRoutes() {
    const { user, initializing } = useAuth();
    const token = localStorage.getItem('auth_token');
    if (initializing) return null;

    return (
        <Routes>
            <Route path="/login" element={user || token ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
            <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/company-creation" element={<PrivateRoute><CompanyCreation /></PrivateRoute>} />
            <Route path="/users" element={<PrivateRoute><UserManagement /></PrivateRoute>} />
            <Route path="/fiscal-years" element={<PrivateRoute><FiscalYearManagement /></PrivateRoute>} />
            <Route path="/branches-warehouses" element={<PrivateRoute><BranchWarehouseManagement /></PrivateRoute>} />
            <Route path="/business-units" element={<PrivateRoute><BusinessUnitManagement /></PrivateRoute>} />
            <Route path="/chart-of-accounts" element={<PrivateRoute><ChartOfAccounts /></PrivateRoute>} />
            <Route path="/route-sequencing" element={<PrivateRoute><RouteSequencing /></PrivateRoute>} />
            <Route path="/product-groups" element={<PrivateRoute><ProductGroupManagement /></PrivateRoute>} />
            <Route path="/salesman-agents" element={<PrivateRoute><SalesmanAgentManagement /></PrivateRoute>} />
            <Route path="/security-groups" element={<PrivateRoute><SecurityGroupManagement /></PrivateRoute>} />
            <Route path="/product-rate-history" element={<PrivateRoute><ProductRateHistory /></PrivateRoute>} />
            <Route path="/bulk-cash-settlement" element={<PrivateRoute><BulkCashSettlement /></PrivateRoute>} />
            <Route path="/document-designer" element={<PrivateRoute><DocumentDesigner /></PrivateRoute>} />
            <Route path="/print/:documentType/:documentId" element={<PrivateRoute><PrintPreview /></PrivateRoute>} />
            <Route path="/register" element={<PrivateRoute><UniversalRegister /></PrivateRoute>} />
            <Route path="/categories" element={<PrivateRoute><CategoryManagement /></PrivateRoute>} />
            <Route path="/outstanding-report" element={<PrivateRoute><OutstandingReport /></PrivateRoute>} />
            <Route path="/vat-reports" element={<PrivateRoute><VatReports /></PrivateRoute>} />
            <Route path="/party-summary" element={<PrivateRoute><PartySummaryReport /></PrivateRoute>} />
            <Route path="/financial-reports" element={<PrivateRoute><FinancialReports /></PrivateRoute>} />
            <Route path="/stock-movement" element={<PrivateRoute><StockMovementReport /></PrivateRoute>} />
            <Route path="/stock-report" element={<PrivateRoute><StockReport /></PrivateRoute>} />
            <Route path="/stock-in-out" element={<PrivateRoute><StockInOutReport /></PrivateRoute>} />
            <Route path="/stock-valuation" element={<PrivateRoute><StockValuationReport /></PrivateRoute>} />
            <Route path="/sales-purchase-analysis" element={<PrivateRoute><SalesPurchaseAnalysis mode="analysis" /></PrivateRoute>} />
            <Route path="/monthly-analysis" element={<PrivateRoute><SalesPurchaseAnalysis mode="monthly" /></PrivateRoute>} />
            <Route path="/profitability" element={<PrivateRoute><SalesPurchaseAnalysis mode="profit" /></PrivateRoute>} />
            <Route path="/rate-history" element={<PrivateRoute><RateHistoryReport /></PrivateRoute>} />
            <Route path="/loading-sheet" element={<PrivateRoute><LoadingSheet /></PrivateRoute>} />
            <Route path="/ageing" element={<PrivateRoute><AgeingReport /></PrivateRoute>} />
            <Route path="/pricing-masters" element={<PrivateRoute><PricingMasters /></PrivateRoute>} />
            <Route path="/ledger-report" element={<PrivateRoute><LedgerReport /></PrivateRoute>} />
            <Route path="/lc-register" element={<PrivateRoute><LcRegister /></PrivateRoute>} />
            <Route path="/ledger-mapping" element={<PrivateRoute><LedgerMapping /></PrivateRoute>} />
            <Route path="/cost-profit-centers" element={<PrivateRoute><CostProfitCenters /></PrivateRoute>} />
            <Route path="/billing-terms" element={<PrivateRoute><BillingTermManagement /></PrivateRoute>} />
            <Route path="/sub-ledgers" element={<PrivateRoute><SubLedgerManagement /></PrivateRoute>} />
            <Route path="/system-control" element={<PrivateRoute><SystemControlSettings /></PrivateRoute>} />
            <Route path="/entry-field-control" element={<PrivateRoute><EntryFieldControl /></PrivateRoute>} />
            <Route path="/product-units" element={<PrivateRoute><ProductUnitManagement /></PrivateRoute>} />
            <Route path="/products" element={<PrivateRoute><ProductMaster /></PrivateRoute>} />
            <Route path="/ledger-opening" element={<PrivateRoute><LedgerOpeningEntry /></PrivateRoute>} />
            <Route path="/product-opening" element={<PrivateRoute><ProductOpeningEntry /></PrivateRoute>} />
            <Route path="/product-rate-change" element={<PrivateRoute><ProductRateChange /></PrivateRoute>} />
            <Route path="/product-offer-rate" element={<PrivateRoute><ProductOfferRate /></PrivateRoute>} />
            <Route path="/remarks-terms" element={<PrivateRoute><RemarksTermsManagement /></PrivateRoute>} />
            <Route path="/user-defined-fields" element={<PrivateRoute><UserDefinedFieldBuilder /></PrivateRoute>} />
            <Route path="/transport-master" element={<PrivateRoute><TransportManagement /></PrivateRoute>} />
            {/* INACTIVE (per request): kept in code, route disabled for now. */}
            {/* <Route path="/purchase-requisition" element={<PrivateRoute><PurchaseRequisition /></PrivateRoute>} /> */}
            <Route path="/purchase-order" element={<PrivateRoute><PurchaseOrder /></PrivateRoute>} />
            <Route path="/purchase-quotation" element={<PrivateRoute><PurchaseQuotation /></PrivateRoute>} />
            <Route path="/purchase-grn" element={<PrivateRoute><PurchaseGrn /></PrivateRoute>} />
            <Route path="/purchase-bill" element={<PrivateRoute><PurchaseBill /></PrivateRoute>} />
            <Route path="/purchase-additional-expense" element={<PrivateRoute><PurchaseAdditionalExpense /></PrivateRoute>} />
            <Route path="/purchase-return" element={<PrivateRoute><PurchaseReturn /></PrivateRoute>} />
            <Route path="/purchase-nonsaleable-return" element={<PrivateRoute><PurchaseNonsaleableReturn /></PrivateRoute>} />
            <Route path="/bill-wise-ageing-report" element={<PrivateRoute><BillWiseAgeingReport /></PrivateRoute>} />
            <Route path="/journal-voucher" element={<PrivateRoute><JournalVoucher /></PrivateRoute>} />
            <Route path="/stock-transfer" element={<PrivateRoute><StockTransfer /></PrivateRoute>} />
            <Route path="/debit-note" element={<PrivateRoute><DebitNote /></PrivateRoute>} />
            <Route path="/credit-note" element={<PrivateRoute><CreditNote /></PrivateRoute>} />
            <Route path="/pdc-voucher" element={<PrivateRoute><PdcVoucher /></PrivateRoute>} />
            <Route path="/production-order" element={<PrivateRoute><ProductionOrder /></PrivateRoute>} />
            <Route path="/cash-bank-entry" element={<PrivateRoute><CashBankEntry /></PrivateRoute>} />
            <Route path="/bom-template" element={<PrivateRoute><BomTemplate /></PrivateRoute>} />
            <Route path="/sales-order" element={<PrivateRoute><SalesOrder /></PrivateRoute>} />
            <Route path="/sales-quotation" element={<PrivateRoute><SalesQuotation /></PrivateRoute>} />
            <Route path="/sales-delivery" element={<PrivateRoute><SalesDelivery /></PrivateRoute>} />
            <Route path="/sales-bill" element={<PrivateRoute><SalesBill /></PrivateRoute>} />
            <Route path="/sales-return" element={<PrivateRoute><SalesReturn /></PrivateRoute>} />
            <Route path="/sales-nonsaleable-return" element={<PrivateRoute><SalesNonsaleableReturn /></PrivateRoute>} />
            <Route path="/sales-additional-entry" element={<PrivateRoute><SalesAdditionalEntry /></PrivateRoute>} />
            <Route path="/grn-outstanding-report" element={<PrivateRoute><GrnOutstandingReport /></PrivateRoute>} />
            <Route path="/purchase-register-report" element={<PrivateRoute><PurchaseRegisterReport /></PrivateRoute>} />
            <Route path="/document-numbering" element={<PrivateRoute><DocumentNumberingManagement /></PrivateRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
    );
}

function App() {
    return (
        <AuthProvider>
            <Router>
                <AppRoutes />
            </Router>
        </AuthProvider>
    );
}

export default App;
