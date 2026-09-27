// =============================================
// routes/automobileRoutes.js
// Automobile dealership - showroom (enquiry, vehicles, PDI, delivery) and
// workshop (job cards, parts issue, outside work, service reminders).
// Only when System Control > Business Nature is "Automobile".
// Rights: security group module "automobile". Logic: utils/automobile.js.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const A = require('../utils/automobile');

const can = a => [requireAuth, loadUserPermissions, requirePermission('automobile', a)];
const send = fn => async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
        await A.requireOn(c, t);
        res.json({ success: true, data: await fn(c, t, req, req.auth.userId, req.body || {}) });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message, warnings: error.warnings }); }
};

router.get('/auto/settings', ...can('view'), send((c, t) => A.getSettings(c, t)));
router.put('/auto/settings', ...can('edit'), send((c, t, req, u, b) => A.saveSettings(c, t, u, b)));
router.get('/auto/dashboard', ...can('view'), send((c, t) => A.dashboard(c, t)));
router.get('/auto/reports/:view', ...can('view'), send((c, t, req) => A.report(c, t, req.params.view, req.query)));

router.get('/auto/vehicles', ...can('view'), send((c, t, req) => A.listVehicles(c, t, req.query)));
router.get('/auto/vehicles/:id', ...can('view'), send((c, t, req) => A.vehicleDetail(c, t, req.params.id)));
router.post('/auto/vehicles', ...can('create'), send((c, t, req, u, b) => A.saveVehicle(c, t, u, b)));
router.put('/auto/vehicles/:id', ...can('edit'), send((c, t, req, u, b) => A.saveVehicle(c, t, u, b, req.params.id)));
router.post('/auto/vehicles/:id/pdi', ...can('create'), send((c, t, req, u, b) => A.savePdi(c, t, u, req.params.id, b)));
router.post('/auto/vehicles/:id/deliver', ...can('create'), send((c, t, req, u, b) => A.deliverVehicle(c, t, u, req.params.id, b)));
router.post('/auto/deliveries/:id/cancel', ...can('delete'), send((c, t, req, u, b) => A.cancelDelivery(c, t, u, req.params.id, b)));

router.get('/auto/enquiries', ...can('view'), send((c, t, req) => A.listEnquiries(c, t, req.query)));
router.get('/auto/enquiries/:id', ...can('view'), send((c, t, req) => A.enquiryDetail(c, t, req.params.id)));
router.post('/auto/enquiries', ...can('create'), send((c, t, req, u, b) => A.saveEnquiry(c, t, u, b)));
router.put('/auto/enquiries/:id', ...can('edit'), send((c, t, req, u, b) => A.saveEnquiry(c, t, u, b, req.params.id)));
router.post('/auto/enquiries/:id/followups', ...can('create'), send((c, t, req, u, b) => A.addFollowup(c, t, u, req.params.id, b)));
router.put('/auto/enquiries/:id/status', ...can('edit'), send((c, t, req, u, b) => A.setEnquiryStatus(c, t, u, req.params.id, b)));

router.get('/auto/job-cards', ...can('view'), send((c, t, req) => A.listJobs(c, t, req.query)));
router.get('/auto/job-cards/:id', ...can('view'), send((c, t, req) => A.jobDetail(c, t, req.params.id)));
router.post('/auto/job-cards', ...can('create'), send((c, t, req, u, b) => A.createJob(c, t, u, b)));
router.put('/auto/job-cards/:id', ...can('edit'), send((c, t, req, u, b) => A.updateJob(c, t, u, req.params.id, b)));
router.put('/auto/job-cards/:id/status', ...can('edit'), send((c, t, req, u, b) => A.setJobStatus(c, t, u, req.params.id, b)));
router.post('/auto/job-cards/:id/parts', ...can('create'), send((c, t, req, u, b) => A.issueParts(c, t, u, req.params.id, b)));
router.delete('/auto/job-parts/:id', ...can('delete'), send((c, t, req, u) => A.deletePartIssue(c, t, u, req.params.id)));
router.post('/auto/job-cards/:id/outside-works', ...can('create'), send((c, t, req, u, b) => A.addOutsideWork(c, t, u, req.params.id, b)));
router.put('/auto/outside-works/:id/receive', ...can('edit'), send((c, t, req, u, b) => A.receiveOutsideWork(c, t, u, req.params.id, b)));
router.delete('/auto/outside-works/:id', ...can('delete'), send((c, t, req) => A.deleteOutsideWork(c, t, req.params.id)));

router.get('/auto/reminders', ...can('view'), send((c, t, req) => A.listReminders(c, t, req.query)));
router.post('/auto/reminders', ...can('create'), send((c, t, req, u, b) => A.addReminder(c, t, b)));
router.put('/auto/reminders/:id', ...can('edit'), send((c, t, req, u, b) => A.updateReminder(c, t, req.params.id, b)));

module.exports = router;
