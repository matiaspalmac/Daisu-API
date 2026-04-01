// src/modules/analytics/analytics.routes.js
import express from 'express';
import { auth, adminOnly } from '../../middleware/auth.js';
import { AnalyticsService } from './analytics.service.js';

const router = express.Router();

router.get('/analytics/top-users', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.getTopUsers()); } catch (err) { next(err); }
});
router.get('/analytics/messages-per-room', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.getMessagesPerRoom()); } catch (err) { next(err); }
});
router.get('/analytics/active-users-timeline', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.getActiveUsersTimeline()); } catch (err) { next(err); }
});
router.get('/analytics/languages', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.getLanguageStats()); } catch (err) { next(err); }
});
router.get('/analytics/flood-detection', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.getFloodDetection()); } catch (err) { next(err); }
});
router.get('/analytics/audit-log', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.getAuditLog(req.query.limit)); } catch (err) { next(err); }
});
router.get('/analytics/banned-words', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.getBannedWords()); } catch (err) { next(err); }
});
router.post('/analytics/banned-words', auth, adminOnly, async (req, res, next) => {
  try { res.json(await AnalyticsService.addBannedWord(req.user.id, req.body?.word)); } catch (err) { next(err); }
});

export default router;
