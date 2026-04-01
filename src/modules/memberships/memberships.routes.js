// src/modules/memberships/memberships.routes.js
import express from 'express';
import { auth, adminOnly } from '../../middleware/auth.js';
import { MembershipsService } from './memberships.service.js';

const router = express.Router();

router.get('/memberships/plans', async (req, res, next) => {
  try { res.json(await MembershipsService.listPlans()); } catch (err) { next(err); }
});
router.get('/memberships/my', auth, async (req, res, next) => {
  try { res.json(await MembershipsService.getMyMembership(req.user.id)); } catch (err) { next(err); }
});
router.post('/memberships/subscribe', auth, async (req, res, next) => {
  try { res.json(await MembershipsService.subscribe(req.user.id, req.body)); } catch (err) { next(err); }
});
router.post('/memberships/cancel', auth, async (req, res, next) => {
  try { res.json(await MembershipsService.cancel(req.user.id)); } catch (err) { next(err); }
});
router.get('/memberships/history', auth, async (req, res, next) => {
  try { res.json(await MembershipsService.getHistory(req.user.id)); } catch (err) { next(err); }
});
router.get('/admin/memberships/stats', auth, adminOnly, async (req, res, next) => {
  try { res.json(await MembershipsService.getAdminStats()); } catch (err) { next(err); }
});

export default router;
