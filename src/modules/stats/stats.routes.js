// src/modules/stats/stats.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { StatsService } from './stats.service.js';

const router = express.Router();

router.get('/user/stats/:userId', auth, async (req, res, next) => {
  try { res.json(await StatsService.getUserStats(req.params.userId)); } catch (err) { next(err); }
});
router.get('/user/stats/:userId/heatmap', auth, async (req, res, next) => {
  try { res.json(await StatsService.getHeatmap(req.params.userId)); } catch (err) { next(err); }
});
router.get('/user/stats/:userId/progress', auth, async (req, res, next) => {
  try { res.json(await StatsService.getProgress(req.params.userId)); } catch (err) { next(err); }
});
router.get('/user/stats/:userId/digest', auth, async (req, res, next) => {
  try { res.json(await StatsService.getDigest(req.params.userId)); } catch (err) { next(err); }
});

export default router;
