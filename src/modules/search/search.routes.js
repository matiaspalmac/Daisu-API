// src/modules/search/search.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { SearchService } from './search.service.js';

const router = express.Router();

router.get('/search', auth, async (req, res, next) => {
  try { res.json(await SearchService.globalSearch(req.query)); } catch (err) { next(err); }
});
router.get('/search/messages', auth, async (req, res, next) => {
  try { res.json(await SearchService.searchMessages(req.query)); } catch (err) { next(err); }
});
router.get('/search/users', auth, async (req, res, next) => {
  try { res.json(await SearchService.searchUsers(req.query)); } catch (err) { next(err); }
});

export default router;
