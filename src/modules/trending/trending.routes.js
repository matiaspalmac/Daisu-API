// src/modules/trending/trending.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { TrendingService } from './trending.service.js';

const router = express.Router();

router.get('/trending/rooms', auth, async (req, res, next) => {
  try { res.json(await TrendingService.getRooms()); } catch (err) { next(err); }
});
router.get('/trending/users', auth, async (req, res, next) => {
  try { res.json(await TrendingService.getUsers()); } catch (err) { next(err); }
});
router.get('/trending/words', auth, async (req, res, next) => {
  try { res.json(await TrendingService.getWords(req.query.language)); } catch (err) { next(err); }
});
router.get('/trending/reactions', auth, async (req, res, next) => {
  try { res.json(await TrendingService.getReactions()); } catch (err) { next(err); }
});
router.get('/rooms/:roomId/activity', auth, async (req, res, next) => {
  try { res.json(await TrendingService.getRoomActivity(req.params.roomId)); } catch (err) { next(err); }
});

export default router;
