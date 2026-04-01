// src/modules/admin/admin.routes.js
import express from 'express';
import { auth, adminOnly } from '../../middleware/auth.js';
import { AdminService } from './admin.service.js';

const router = express.Router();

router.post('/admin/bulk/ban-users', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AdminService.bulkBanUsers(req.user.id, req.body || {})); } catch (err) { next(err); }
});
router.post('/admin/bulk/unban-users', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AdminService.bulkUnbanUsers(req.body?.userIds)); } catch (err) { next(err); }
});
router.post('/admin/bulk/delete-messages', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AdminService.bulkDeleteMessages(req.user.id, req.body || {})); } catch (err) { next(err); }
});
router.post('/admin/bulk/send-notification', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AdminService.bulkSendNotification(req.body || {})); } catch (err) { next(err); }
});
router.get('/admin/dashboard', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AdminService.getDashboard()); } catch (err) { next(err); }
});
router.post('/admin/system-announcement', auth, adminOnly, async (req, res, next) => {
  try { res.json(AdminService.setAnnouncement(req.user.id, req.body || {})); } catch (err) { next(err); }
});
router.get('/admin/system-announcement', (req, res) => {
  res.json(AdminService.getAnnouncement());
});

export default router;
