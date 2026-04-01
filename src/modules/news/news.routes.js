// src/modules/news/news.routes.js
import express from 'express';
import { auth, adminOnly } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createNewsSchema } from './news.schemas.js';
import { NewsService } from './news.service.js';

const router = express.Router();

router.get('/news', async (req, res, next) => {
  try { res.json(await NewsService.list(req.query)); } catch (err) { next(err); }
});
router.get('/news/:slug', async (req, res, next) => {
  try { res.json(await NewsService.getBySlug(req.params.slug)); } catch (err) { next(err); }
});
router.post('/news', auth, adminOnly, validate(createNewsSchema), async (req, res, next) => {
  try { res.status(201).json(await NewsService.create(req.user.id, req.body)); } catch (err) { next(err); }
});
router.put('/news/:id', auth, adminOnly, async (req, res, next) => {
  try { res.json(await NewsService.update(req.params.id, req.body)); } catch (err) { next(err); }
});
router.delete('/news/:id', auth, adminOnly, async (req, res, next) => {
  try { res.json(await NewsService.remove(req.params.id)); } catch (err) { next(err); }
});

export default router;
