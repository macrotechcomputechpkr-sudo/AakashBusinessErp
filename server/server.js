// =============================================
// server.js (FIXED)
// - All route files now share one auth middleware, so the missing-jwt-import
//   crash in the old companyRoutes.js / fiscalYearRoutes.js is gone.
// - Added a global error handler so an uncaught error returns clean JSON
//   instead of an HTML stack trace / silent server crash.
// - CORS is restricted to configured origins in production.
// =============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    }
}));
// Purchase Bill Import sends a whole bill's text - parsed here first, with its own limit.
app.use('/api/purchase-bill-import', express.json({ limit: '5mb' }));
app.use('/api/udf-values/lookup', express.json({ limit: '5mb' }));
app.use('/api/bank-reco/statements', express.json({ limit: '15mb' }));
app.use(express.json());

const authRoutes = require('./routes/authRoutes');
const companyRoutes = require('./routes/companyRoutes');
const fiscalYearRoutes = require('./routes/fiscalYearRoutes');
const departmentRoutes = require('./routes/departmentRoutes');
const designationRoutes = require('./routes/designationRoutes');
const securityGroupRoutes = require('./routes/securityGroupRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const branchWarehouseRoutes = require('./routes/branchWarehouseRoutes');
const businessUnitRoutes = require('./routes/businessUnitRoutes');
const listPresetRoutes = require('./routes/listPresetRoutes');
const chartOfAccountsRoutes = require('./routes/chartOfAccountsRoutes');
const partyMasterRoutes = require('./routes/partyMasterRoutes');
const productGroupRoutes = require('./routes/productGroupRoutes');
const productCompanyRoutes = require('./routes/productCompanyRoutes');
const ledgerCategoryRoutes = require('./routes/ledgerCategoryRoutes');
const billingTermRoutes = require('./routes/billingTermRoutes');
const subLedgerRoutes = require('./routes/subLedgerRoutes');
const systemControlRoutes = require('./routes/systemControlRoutes');
const entryFieldControlRoutes = require('./routes/entryFieldControlRoutes');
const productUnitRoutes = require('./routes/productUnitRoutes');
const productCategoryRoutes = require('./routes/productCategoryRoutes');
const productRoutes = require('./routes/productRoutes');
const ledgerOpeningRoutes = require('./routes/ledgerOpeningRoutes');
const productOpeningRoutes = require('./routes/productOpeningRoutes');
const productOfferRateRoutes = require('./routes/productOfferRateRoutes');
const remarksTermsRoutes = require('./routes/remarksTermsRoutes');
const userDefinedFieldRoutes = require('./routes/userDefinedFieldRoutes');
const transportRoutes = require('./routes/transportRoutes');
const purchaseRequisitionRoutes = require('./routes/purchaseRequisitionRoutes');
const purchaseOrderRoutes = require('./routes/purchaseOrderRoutes');
const purchaseQuotationRoutes = require('./routes/purchaseQuotationRoutes');
const purchaseGrnRoutes = require('./routes/purchaseGrnRoutes');
const purchaseRegisterReportRoutes = require('./routes/purchaseRegisterReportRoutes');
const customsOfficeRoutes = require('./routes/customsOfficeRoutes');
const purchaseBillRoutes = require('./routes/purchaseBillRoutes');
const purchaseAdditionalExpenseRoutes = require('./routes/purchaseAdditionalExpenseRoutes');
const purchaseReturnRoutes = require('./routes/purchaseReturnRoutes');
const purchaseNonsaleableReturnRoutes = require('./routes/purchaseNonsaleableReturnRoutes');
const billWiseSettlementRoutes = require('./routes/billWiseSettlementRoutes');
const reportSavedViewsRoutes = require('./routes/reportSavedViewsRoutes');
const journalVoucherRoutes = require('./routes/journalVoucherRoutes');
const stockTransferRoutes = require('./routes/stockTransferRoutes');
const debitNoteRoutes = require('./routes/debitNoteRoutes');
const creditNoteRoutes = require('./routes/creditNoteRoutes');
const pdcRoutes = require('./routes/pdcRoutes');
const productionOrderRoutes = require('./routes/productionOrderRoutes');
const cashBankEntryRoutes = require('./routes/cashBankEntryRoutes');
const bulkSettlementRoutes = require('./routes/bulkSettlementRoutes');
const documentDesignerRoutes = require('./routes/documentDesignerRoutes');
const registerRoutes = require('./routes/registerRoutes');
const outstandingReportRoutes = require('./routes/outstandingReportRoutes');
const vatReportRoutes = require('./routes/vatReportRoutes');
const partySummaryRoutes = require('./routes/partySummaryRoutes');
const financialReportRoutes = require('./routes/financialReportRoutes');
const stockReportRoutes = require('./routes/stockReportRoutes');
const stockAdjustmentRoutes = require('./routes/stockAdjustmentRoutes');
const stockPostingRoutes = require('./routes/stockPostingRoutes');
const analysisReportRoutes = require('./routes/analysisReportRoutes');
const purchaseBillImportRoutes = require('./routes/purchaseBillImportRoutes');
const documentUdfPrintRoutes = require('./routes/documentUdfPrintRoutes');
const productionReportRoutes = require('./routes/productionReportRoutes');
const bankRecoRoutes = require('./routes/bankRecoRoutes');
const ledgerPurposeRoutes = require('./routes/ledgerPurposeRoutes');
const accountingToolsRoutes = require('./routes/accountingToolsRoutes');
const salesmanRoutes = require('./routes/salesmanRoutes');
const performanceRoutes = require('./routes/performanceRoutes');
const messagingRoutes = require('./routes/messagingRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const dataAccessRoutes = require('./routes/dataAccessRoutes');
const workRoutes = require('./routes/workRoutes');
const ledgerReportRoutes = require('./routes/ledgerReportRoutes');
const lcRoutes = require('./routes/lcRoutes');
const savedReportViewRoutes = require('./routes/savedReportViewRoutes');
const bomTemplateRoutes = require('./routes/bomTemplateRoutes');
const salesOrderRoutes = require('./routes/salesOrderRoutes');
const salesPricingRoutes = require('./routes/salesPricingRoutes');
const batchSerialStockRoutes = require('./routes/batchSerialStockRoutes');
const salesQuotationRoutes = require('./routes/salesQuotationRoutes');
const salesDeliveryRoutes = require('./routes/salesDeliveryRoutes');
const salesBillRoutes = require('./routes/salesBillRoutes');
const salesReturnRoutes = require('./routes/salesReturnRoutes');
const salesNonsaleableReturnRoutes = require('./routes/salesNonsaleableReturnRoutes');
const salesAdditionalEntryRoutes = require('./routes/salesAdditionalEntryRoutes');
const documentNumberingRoutes = require('./routes/documentNumberingRoutes');

app.use('/api/auth', authRoutes);
app.use('/api', companyRoutes);
app.use('/api', fiscalYearRoutes);
app.use('/api', departmentRoutes);
app.use('/api', designationRoutes);
app.use('/api', securityGroupRoutes);
app.use('/api', userRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', branchWarehouseRoutes);
app.use('/api', businessUnitRoutes);
app.use('/api', listPresetRoutes);
app.use('/api', chartOfAccountsRoutes);
app.use('/api', partyMasterRoutes);
app.use('/api', productGroupRoutes);
app.use('/api', productCompanyRoutes);
app.use('/api', ledgerCategoryRoutes);
app.use('/api', billingTermRoutes);
app.use('/api', subLedgerRoutes);
app.use('/api', systemControlRoutes);
app.use('/api', entryFieldControlRoutes);
app.use('/api', productUnitRoutes);
app.use('/api', productCategoryRoutes);
app.use('/api', productRoutes);
app.use('/api', ledgerOpeningRoutes);
app.use('/api', productOpeningRoutes);
app.use('/api', productOfferRateRoutes);
app.use('/api', remarksTermsRoutes);
app.use('/api', userDefinedFieldRoutes);
app.use('/api', transportRoutes);
app.use('/api', purchaseRequisitionRoutes);
app.use('/api', purchaseOrderRoutes);
app.use('/api', purchaseQuotationRoutes);
app.use('/api', purchaseGrnRoutes);
app.use('/api', purchaseRegisterReportRoutes);
app.use('/api', customsOfficeRoutes);
app.use('/api', purchaseBillRoutes);
app.use('/api', purchaseAdditionalExpenseRoutes);
app.use('/api', purchaseReturnRoutes);
app.use('/api', purchaseNonsaleableReturnRoutes);
app.use('/api', billWiseSettlementRoutes);
app.use('/api', reportSavedViewsRoutes);
app.use('/api', journalVoucherRoutes);
app.use('/api', stockTransferRoutes);
app.use('/api', debitNoteRoutes);
app.use('/api', creditNoteRoutes);
app.use('/api', pdcRoutes);
app.use('/api', productionOrderRoutes);
app.use('/api', cashBankEntryRoutes);
app.use('/api', bulkSettlementRoutes);
app.use('/api', documentDesignerRoutes);
app.use('/api', registerRoutes);
app.use('/api', outstandingReportRoutes);
app.use('/api', vatReportRoutes);
app.use('/api', partySummaryRoutes);
app.use('/api', financialReportRoutes);
app.use('/api', stockReportRoutes);
app.use('/api', stockAdjustmentRoutes);
app.use('/api', stockPostingRoutes);
app.use('/api', analysisReportRoutes);
app.use('/api', purchaseBillImportRoutes);
app.use('/api', documentUdfPrintRoutes);
app.use('/api', productionReportRoutes);
app.use('/api', bankRecoRoutes);
app.use('/api', ledgerPurposeRoutes);
app.use('/api', accountingToolsRoutes);
app.use('/api', salesmanRoutes);
app.use('/api', performanceRoutes);
app.use('/api', messagingRoutes);
app.use('/api', auditLogRoutes);
app.use('/api', dataAccessRoutes);
app.use('/api', workRoutes);
app.use('/api', ledgerReportRoutes);
app.use('/api', lcRoutes);
app.use('/api', savedReportViewRoutes);
app.use('/api', bomTemplateRoutes);
app.use('/api', salesOrderRoutes);
app.use('/api', salesPricingRoutes);
app.use('/api', batchSerialStockRoutes);
app.use('/api', salesQuotationRoutes);
app.use('/api', salesDeliveryRoutes);
app.use('/api', salesBillRoutes);
app.use('/api', salesReturnRoutes);
app.use('/api', salesNonsaleableReturnRoutes);
app.use('/api', salesAdditionalEntryRoutes);
app.use('/api', documentNumberingRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// 404 for unmatched API routes
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
});

// FIX: global error handler - previously an uncaught throw inside any route
// (e.g. the missing `jwt` reference) resulted in an unhandled exception
// with no clean client response. Express 5-style async errors still land
// here because every route wraps its logic in try/catch and calls next()
// is not even required, but this remains a safety net for anything else.
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
});
